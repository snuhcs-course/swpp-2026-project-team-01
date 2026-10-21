import { randomBytes, randomUUID } from "node:crypto";
import { GOOGLE_CALENDAR_SCOPES } from "../../../lib/contracts/google-scopes";
import { saveCalendarRolesCommand } from "../../../lib/server/calendar-roles";
import { runCommand } from "../../../lib/server/commands";
import type { Database } from "../../../lib/server/database";
import { setUpManuallyCommand } from "../../../lib/server/analysis";
import { sessionIdHash } from "../../../lib/server/model-limits";
import { recordGoogleGrant } from "../../../lib/server/provider-grants";
import type { SetupDependencies } from "../../../lib/server/setup";
import { updateDraftCommand } from "../../../lib/server/setup-commands";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { createGoogleUser } from "./auth";
import type { FakeCalendar, FakeGoogle } from "./fake-google";

// Hosts for the setup suites, seeded with SQL and the application's own grant
// writer, with the Calendar client pointed at the fake Google. Every host, email,
// handle and refresh token is unique, so suites can share the local database.

export const SETUP_ORIGIN = "https://findmeatime.test";

export const PRIMARY: FakeCalendar = { accessRole: "owner", id: "", primary: true, summary: "Me", timeZone: "Asia/Seoul" };

export function setupDependencies(db: Database, google: FakeGoogle): SetupDependencies & { tokenKey: ReturnType<typeof parseTokenKey> } {
  const tokenKey = parseTokenKey(randomBytes(32).toString("base64"));
  return {
    appOrigin: SETUP_ORIGIN,
    calendar: {
      config: { apiBaseUrl: google.apiBaseUrl, clientId: "client", clientSecret: "secret", timeoutMs: 5_000, tokenUrl: google.tokenUrl },
      db,
      tokenKeys: [tokenKey],
    },
    db,
    tokenKey,
  };
}

export type SeededHost = Awaited<ReturnType<typeof seedHost>>;

// An active host with a setup discussion and its live generation 1 session, and,
// unless `calendar` is false, a Calendar grant whose fake Google calendars are
// `calendars` (by default one owned primary and one read-only calendar).
export async function seedHost(
  db: Database,
  deps: ReturnType<typeof setupDependencies>,
  google: FakeGoogle,
  options: { calendar?: boolean; calendars?: FakeCalendar[]; displayName?: string | null } = {},
) {
  const local = `host${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const user = await createGoogleUser(db, `${local}@example.test`);
  const [account] = await db<{ id: string }[]>`
    insert into app.host_accounts (display_name) values (${options.displayName ?? null}) returning id
  `;
  const hostAccountId = account!.id;
  await db`
    insert into app.google_identities (google_subject, host_account_id, auth_user_id, email)
    values (${user.googleSubject}, ${hostAccountId}, ${user.userId}, ${user.email})
  `;
  const [discussion] = await db<{ id: string }[]>`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('host_account', ${hostAccountId}, 'host_setup') returning id
  `;
  const sessionId = `session-${randomUUID()}`;
  await db`
    insert into app.agent_sessions
      (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
    values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussion!.id}, 'host_account', ${hostAccountId}, 1, 'test')
  `;

  const refreshToken = `refresh-${randomUUID()}`;
  const primaryId = `${local}@example.test`;
  const calendars = options.calendars ?? [
    { ...PRIMARY, id: primaryId },
    { accessRole: "reader", id: `team-${local}@group.calendar.google.com`, summary: "Team" },
  ];

  if (options.calendar !== false) {
    await recordGoogleGrant(db, deps.tokenKey, { grantedScopes: [...GOOGLE_CALENDAR_SCOPES], hostAccountId, refreshToken });
    google.setFixture(refreshToken, { calendars, events: {} });
  }

  return {
    calendars,
    discussionId: discussion!.id,
    email: user.email,
    hostAccountId,
    local,
    primaryId,
    refreshToken,
    sessionId,
    userId: user.userId,
  };
}

export function hostCommandDeps(db: Database, hostAccountId: string) {
  return { authenticate: async () => ({ id: hostAccountId, kind: "host_account" as const }), db };
}

export async function draftRevision(db: Database, hostAccountId: string) {
  const [row] = await db<{ revision: number }[]>`select revision from app.setup_drafts where host_account_id = ${hostAccountId}`;
  return row?.revision ?? 0;
}

// Saves the host's roles (its primary as conflict and booking calendar), skips the
// scan and answers Online, which leaves every required value proposed.
export async function prepareReviewableHost(db: Database, host: SeededHost) {
  const live = host.calendars.map((calendar) => ({ ...calendar, timeZone: calendar.timeZone ?? null }));
  const deps = hostCommandDeps(db, host.hostAccountId);
  const roles = await runCommand(deps, saveCalendarRolesCommand(live), {
    expectedRevision: 0,
    input: { bookingCalendarId: host.primaryId, conflictCalendarIds: [host.primaryId] },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
  const manual = await runCommand(deps, setUpManuallyCommand, {
    input: {},
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
  const mode = await runCommand(deps, updateDraftCommand, {
    expectedRevision: await draftRevision(db, host.hostAccountId),
    input: { action: "choose_own", field: "meetingMode", value: "online" },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });

  if (!roles.ok || !manual.ok || !mode.ok) {
    throw new Error(`Preparing the host failed: ${JSON.stringify([roles, manual, mode])}`);
  }

  return live;
}
