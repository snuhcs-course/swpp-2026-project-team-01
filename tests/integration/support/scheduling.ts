import { randomBytes, randomUUID } from "node:crypto";
import type { ConfirmedSettings } from "../../../lib/contracts/setup";
import { hashBookingId, sealBookingLink } from "../../../lib/server/booking-links";
import { type Actor, type CommandDefinition, runCommand } from "../../../lib/server/commands";
import type { Database } from "../../../lib/server/database";
import { createEvaluationHandler, EVALUATION_JOB, type EvaluationDependencies } from "../../../lib/server/evaluation";
import { sessionIdHash } from "../../../lib/server/model-limits";
import type { SessionPrincipal } from "../../../lib/server/setup-tools";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { createCalendarHost, fakeGoogleConfig, runJob } from "./calendar-host";
import type { FakeEvent, FakeGoogle, FakeGoogleFixture } from "./fake-google";
import { testTokenKey } from "./requests";

// Requests ready for scheduling, for the requester review, tool and proposal
// suites: a host with confirmed settings and a Calendar grant against the fake
// Google, an open request with a hashed and sealed booking link and its
// requester discussion, an indexed requester session for tool fences, and a way
// to run one evaluation job through the real handler.

export const calendarKey = parseTokenKey(randomBytes(32).toString("base64"));

// A Monday in Asia/Seoul at least a week ahead, so every window is in the future.
export function futureMonday() {
  const day = new Date(Date.now() + 8 * 86_400_000);
  const shift = (8 - day.getUTCDay()) % 7;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + shift)).toISOString().slice(0, 10);
}

export const MONDAY = futureMonday();
export const seoul = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+09:00`).toISOString();

export function settingsFor(calendarId: string, overrides: Partial<ConfirmedSettings> = {}): ConfirmedSettings {
  return {
    bookingCalendar: { accessRole: "owner", id: calendarId, summary: "Work", verifiedAt: new Date().toISOString() },
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    conflictCalendars: [{ accessRole: "owner", id: calendarId, primary: true, summary: "Work" }],
    displayName: "Ada Lovelace",
    durationMinutes: 30,
    handle: `ada-${randomUUID().slice(0, 8)}`,
    location: { kind: "decide_per_meeting" },
    meetingMode: "either",
    noteExclusions: [],
    provenance: {},
    timezone: "Asia/Seoul",
    travelBufferMinutes: 0,
    travelMode: "transit",
    weeklyLimit: null,
    weeklyWindows: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({
      end: "17:00",
      start: "10:00",
      weekday,
    })),
    ...overrides,
  };
}

export const COMPLETE_DETAILS = {
  durationMinutes: 30,
  language: "en",
  linkPlan: null,
  location: null,
  mode: "online",
  purpose: "Talk about compilers",
  timezone: "Asia/Seoul",
  travelMode: null,
  windows: [{ end: seoul("11:00"), start: seoul("10:00") }],
};

export type SchedulingRequest = {
  readonly bookingId: string;
  readonly contactEmail: string;
  readonly hostAccountId: string;
  readonly requestId: string;
  // The host's grant and calendar on the fake Google, to change its fixture.
  readonly refreshToken: string;
  readonly calendarId: string;
  // Replaces the host's fixture: the same calendar with these events and extras.
  readonly setCalendar: (fixture: Partial<FakeGoogleFixture>) => void;
};

export async function seedSchedulingRequest(
  db: Database,
  google: FakeGoogle,
  options: {
    readonly details?: Record<string, unknown>;
    readonly events?: FakeEvent[];
    readonly settings?: Partial<ConfirmedSettings>;
    readonly conferenceSolutionTypes?: string[];
    readonly confirmed?: boolean;
  } = {},
): Promise<SchedulingRequest> {
  const host = await createCalendarHost(db, calendarKey);
  const calendarId = host.email;
  const calendars = [
    {
      accessRole: "owner",
      conferenceSolutionTypes: options.conferenceSolutionTypes ?? ["hangoutsMeet"],
      id: calendarId,
      primary: true,
      summary: "Work",
    },
  ];
  const setCalendar = (fixture: Partial<FakeGoogleFixture>) =>
    google.setFixture(host.refreshToken!, { calendars, events: { [calendarId]: options.events ?? [] }, ...fixture });
  setCalendar({});
  await db`
    insert into app.host_settings (host_account_id, settings, draft_revision)
    values (${host.hostAccountId}, ${db.json(settingsFor(calendarId, options.settings) as never)}, 1)
  `;

  const contactEmail = `grace-${randomUUID().slice(0, 12)}@example.test`;
  const bookingId = randomUUID();
  const details = { ...COMPLETE_DETAILS, ...options.details };
  const [request] = await db<{ id: string }[]>`
    insert into app.requests (host_account_id, details, requester_name, contact_email, contact_confirmed_email, expires_at)
    values (${host.hostAccountId}, ${db.json(details as never)}, 'Grace Hopper', ${contactEmail},
            ${options.confirmed ? contactEmail : null}, now() + interval '7 days')
    returning id
  `;
  const sealed = sealBookingLink(testTokenKey, request!.id, bookingId);
  await db`
    insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
    values (${request!.id}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;
  await db`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('requester_request', ${request!.id}, 'requester')
  `;

  return {
    bookingId,
    calendarId,
    contactEmail,
    hostAccountId: host.hostAccountId,
    refreshToken: host.refreshToken!,
    requestId: request!.id,
    setCalendar,
  };
}

// Indexes the requester discussion's next session generation, as the message
// route does, and returns the principal eve projects for it.
export async function indexRequesterSession(db: Database, requestId: string) {
  await db`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('requester_request', ${requestId}, 'requester')
    on conflict (principal_type, principal_id, audience, request_id) do nothing
  `;
  const [discussion] = await db<{ id: string }[]>`
    select id from app.discussions where principal_type = 'requester_request' and principal_id = ${requestId}
  `;
  const [latest] = await db<{ generation: number | null }[]>`
    select max(generation) as generation from app.agent_sessions where discussion_id = ${discussion!.id}
  `;
  const generation = (latest?.generation ?? 0) + 1;
  await db`update app.agent_sessions set state = 'retired' where discussion_id = ${discussion!.id}`;
  const sessionId = `wrun_${randomUUID()}`;
  await db`
    insert into app.agent_sessions
      (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
    values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussion!.id}, 'requester_request', ${requestId}, ${generation}, 'test')
  `;
  const auth: SessionPrincipal = {
    attributes: { audience: "requester", discussionId: discussion!.id, generation: String(generation), requestId },
    principalId: `request:${requestId}`,
    principalType: "user",
  };

  return { auth, discussionId: discussion!.id, generation, sessionId };
}

export function requesterActor(requestId: string): Actor {
  return { id: requestId, kind: "requester_request" };
}

export function asRequester<Input, Result>(
  db: Database,
  requestId: string,
  command: CommandDefinition<Input, Result>,
  input: unknown,
  options: { readonly expectedRevision?: number | null; readonly retryKey?: string } = {},
) {
  return runCommand({ authenticate: async () => requesterActor(requestId), db }, command, {
    expectedRevision: options.expectedRevision ?? null,
    input,
    resourceId: requestId,
    retryKey: options.retryKey ?? randomUUID(),
  });
}

export async function revisionOf(db: Database, requestId: string) {
  const [row] = await db<{ revision: number }[]>`select revision from app.requests where id = ${requestId}`;
  return row!.revision;
}

export function evaluationDeps(db: Database, google: FakeGoogle, overrides: Partial<EvaluationDependencies> = {}): EvaluationDependencies {
  return {
    calendar: fakeGoogleConfig(google),
    db,
    limits: { anonymousWindowUsd: "1000000.00", serviceWindowUsd: "1000000.00" },
    model: null,
    requesterCalendar: fakeGoogleConfig(google),
    routes: { apiKey: "unused", baseUrl: "http://127.0.0.1:9", timeoutMs: 1_000 },
    tokenKeys: [calendarKey],
    ...overrides,
  };
}

// Runs the evaluation job of one evaluation through the real handler.
export async function runEvaluation(db: Database, deps: EvaluationDependencies, evaluationId: string) {
  const [job] = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${EVALUATION_JOB} and payload ->> 'evaluationId' = ${evaluationId}
  `;
  return runJob(db, job!.id, createEvaluationHandler(() => deps));
}

// A busy event on the fake Calendar.
export function busy(start: string, end: string): FakeEvent {
  return { end: { dateTime: seoul(end) }, id: `event-${randomUUID()}`, start: { dateTime: seoul(start) }, status: "confirmed" };
}
