import { randomUUID } from "node:crypto";
import type { ConfirmedSettings } from "../../lib/contracts/setup";
import { hashBookingId, sealBookingLink } from "../../lib/server/booking-links";
import { changeBookingCommand } from "../../lib/server/booking-cancellation";
import { approveCommand, BOOKING_JOB, createBookingHandler } from "../../lib/server/bookings";
import { type Actor, type CommandDefinition, runCommand } from "../../lib/server/commands";
import { agreeCommand, changeAgreementCommand, chooseCandidateCommand, evaluateCommand, readCurrentEvaluation } from "../../lib/server/request-proposals";
import { type DraftReviewInput, draftReviewCommand } from "../../lib/server/request-reviews";
import { type SharedChanges, suggestChangesCommand } from "../../lib/server/shared-changes";
import { createCalendarHost, runJob } from "../../tests/integration/support/calendar-host";
import type { FakeEvent } from "../../tests/integration/support/fake-google";
import { settingsFor } from "../../tests/integration/support/scheduling";
import { settleEvaluations, storyRuntime } from "./runtime";

// Start states for the story evals, written the way the product's own commands
// leave them (the "시작 상태" codes of the case sheet). A host has confirmed
// settings and a Calendar grant on the fake Google, sealed with the key the dev
// server reads; a request has a sealed booking link and its requester
// discussion. Every request is registered with the runtime, so its evaluation
// jobs run. Dates are relative to the run: "next week" is the Asia/Seoul week
// after the current one, as the assistant reads it.

export type SeededHost = { readonly hostAccountId: string; readonly calendarId: string; readonly refreshToken: string };
export type SeededRequest = SeededHost & { readonly requestId: string; readonly bookingId: string };

const ZONE = "Asia/Seoul";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// Next week's dates in Asia/Seoul, for fixtures, messages and checks.
export function nextWeek(now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: ZONE }));
  const daysToMonday = ((8 - local.getDay()) % 7) || 7;
  const monday = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate() + daysToMonday));
  return Object.fromEntries(
    WEEKDAYS.map((day, index) => {
      const date = new Date(monday.getTime() + index * 86_400_000);
      const iso = date.toISOString().slice(0, 10);
      return [day, { en: date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }), iso, ko: `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일` }];
    }),
  ) as Record<Weekday, { readonly iso: string; readonly ko: string; readonly en: string }>;
}

// An instant in Asia/Seoul on a day of next week, such as at("tue", "10:00").
export function at(day: Weekday, clock: string) {
  return new Date(`${nextWeek()[day].iso}T${clock}:00+09:00`).toISOString();
}

export function window(day: Weekday, start: string, end: string) {
  return { end: at(day, end), start: at(day, start) };
}

const requesterActor = (requestId: string): Actor => ({ id: requestId, kind: "requester_request" });
const hostActor = (hostAccountId: string): Actor => ({ id: hostAccountId, kind: "host_account" });

async function run<Input, Result>(actor: Actor, requestId: string, command: CommandDefinition<Input, Result>, input: unknown) {
  const { db } = storyRuntime();
  const [row] = await db<{ revision: number }[]>`select revision from app.requests where id = ${requestId}`;
  const outcome = await runCommand({ authenticate: async () => actor, db }, command, {
    expectedRevision: row!.revision,
    input,
    resourceId: requestId,
    retryKey: randomUUID(),
  });
  if (!outcome.ok) throw new Error(`fixture command failed: ${outcome.error.category}`);
  return outcome.result;
}

export async function seedHost(
  options: { readonly settings?: Partial<ConfirmedSettings>; readonly events?: FakeEvent[]; readonly displayName?: string } = {},
): Promise<SeededHost> {
  const { db, google, tokenKey } = storyRuntime();
  const host = await createCalendarHost(db, tokenKey);
  const calendarId = host.email;
  google.setFixture(host.refreshToken!, {
    calendars: [{ accessRole: "owner", conferenceSolutionTypes: ["hangoutsMeet"], id: calendarId, primary: true, summary: "Work" } as never],
    events: { [calendarId]: options.events ?? [] },
  });
  const settings = settingsFor(calendarId, { displayName: options.displayName ?? "지원", ...options.settings });
  await db`
    insert into app.host_settings (host_account_id, settings, draft_revision)
    values (${host.hostAccountId}, ${db.json(settings as never)}, 1)
  `;
  return { calendarId, hostAccountId: host.hostAccountId, refreshToken: host.refreshToken! };
}

// The host offer most guest cases start from: 30 minutes, online or in person,
// in person near Seoul National University Station or Gangnam Station.
export const GUEST_OFFER: Partial<ConfirmedSettings> = {
  durationMinutes: 30,
  location: { areas: ["서울대입구역", "강남역"], kind: "places", venue: null },
  meetingMode: "either",
  weeklyWindows: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({ end: "18:00", start: "09:00", weekday })),
};

export async function seedRequest(
  host: SeededHost,
  options: { readonly details?: Record<string, unknown>; readonly requesterName?: string; readonly language?: "ko" | "en" } = {},
): Promise<SeededRequest> {
  const { db, owned, tokenKey } = storyRuntime();
  const email = `eval-${randomUUID().slice(0, 12)}@example.test`;
  const bookingId = randomUUID();
  const details = { language: options.language ?? "ko", linkPlan: null, location: null, timezone: ZONE, travelMode: null, windows: [], ...options.details };
  // A confirmed contact: graded on the model's replies, not cut off by the
  // anonymous allowance of an unconfirmed guest (run settings).
  const [request] = await db<{ id: string }[]>`
    insert into app.requests (host_account_id, details, requester_name, contact_email, contact_confirmed_email, expires_at)
    values (${host.hostAccountId}, ${db.json(details as never)}, ${options.requesterName ?? "Minji Kim"}, ${email}, ${email}, now() + interval '14 days')
    returning id
  `;
  const sealed = sealBookingLink(tokenKey, request!.id, bookingId);
  await db`
    insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
    values (${request!.id}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;
  await db`insert into app.discussions (principal_type, principal_id, audience) values ('requester_request', ${request!.id}, 'requester')`;
  owned.add(request!.id);
  return { ...host, bookingId, requestId: request!.id };
}

// ---------------------------------------------------------------------------
// Steps, each as the product's command leaves the request

export async function evaluate(request: SeededRequest) {
  await run(requesterActor(request.requestId), request.requestId, evaluateCommand, {});
  await settleEvaluations(request.requestId);
  const view = await readCurrentEvaluation(storyRuntime().db, request.requestId);
  if (!view || view.candidates.length === 0) throw new Error("fixture evaluation found no candidates");
  return view;
}

export async function choose(request: SeededRequest, index = 0) {
  const view = await readCurrentEvaluation(storyRuntime().db, request.requestId);
  const candidate = view?.candidates[index];
  if (!view || !candidate) throw new Error(`fixture has no candidate ${index}`);
  const result = await run(requesterActor(request.requestId), request.requestId, chooseCandidateCommand, { candidateId: candidate.id, evaluationId: view.id });
  if (result.outcome !== "proposed") throw new Error("fixture choose did not propose");
  return { candidate, version: result.version };
}

export async function agree(request: SeededRequest, version: number) {
  await run(requesterActor(request.requestId), request.requestId, agreeCommand(() => storyRuntime().evaluationDeps()), { version });
}

export async function changeAgreement(request: SeededRequest) {
  await run(requesterActor(request.requestId), request.requestId, changeAgreementCommand, {});
}

export async function approve(request: SeededRequest, version: number) {
  await run(hostActor(request.hostAccountId), request.requestId, approveCommand, { version });
}

// Runs the approved request's booking job against the fake Calendar only.
export async function book(request: SeededRequest) {
  const runtime = storyRuntime();
  const [job] = await runtime.db<{ id: string }[]>`
    select j.id from app.jobs j join app.bookings b on b.id = (j.payload ->> 'bookingId')::uuid
    where j.kind = ${BOOKING_JOB} and j.state = 'pending' and b.request_id = ${request.requestId}
  `;
  if (!job) throw new Error("fixture has no pending booking job");
  await runJob(runtime.db, job.id, createBookingHandler(() => runtime.bookingDeps()));
  const [row] = await runtime.db<{ state: string }[]>`select state from app.requests where id = ${request.requestId}`;
  if (row!.state !== "booked") throw new Error(`fixture booking left the request ${row!.state}`);
}

export async function changeBookingAsGuest(request: SeededRequest) {
  await run(requesterActor(request.requestId), request.requestId, changeBookingCommand, {});
}

export async function draftReview(request: SeededRequest, input: DraftReviewInput) {
  return run(requesterActor(request.requestId), request.requestId, draftReviewCommand(), input);
}

export async function suggestChanges(request: SeededRequest, changes: SharedChanges) {
  return run(hostActor(request.hostAccountId), request.requestId, suggestChangesCommand("host"), { changes });
}

// Moves a booked meeting into the past, for the case where it already started.
// Only the stored times change; no command can book a past time.
export async function startBookedMeeting(request: SeededRequest) {
  const { db } = storyRuntime();
  await db`
    update app.bookings
    set reserved_start = now() - interval '10 minutes', start_at = now() - interval '10 minutes',
        end_at = now() + interval '20 minutes', reserved_end = now() + interval '20 minutes'
    where request_id = ${request.requestId}
  `;
  await db`update app.proposals set start_at = now() - interval '10 minutes', end_at = now() + interval '20 minutes' where request_id = ${request.requestId}`;
}
