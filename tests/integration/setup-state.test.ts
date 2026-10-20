import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPES } from "../../lib/contracts/google-scopes";
import { runCommand } from "../../lib/server/commands";
import { recordGoogleGrant } from "../../lib/server/provider-grants";
import { readReadiness } from "../../lib/server/readiness";
import { readSetupState } from "../../lib/server/setup";
import { confirmSettingsCommand } from "../../lib/server/setup-commands";
import {
  createHandleCheckHandler,
  createSetupCommandHandler,
  createSetupStateHandler,
  type SetupRouteDependencies,
} from "../../lib/server/setup-routes";
import { localAuthConfig, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import {
  draftRevision,
  hostCommandDeps,
  PRIMARY,
  prepareReviewableHost,
  type SeededHost,
  seedHost,
  SETUP_ORIGIN,
  setupDependencies,
} from "./support/setup-host";

// The derived setup state (host-setup: server-derived setup progress) against the
// local stack and the fake Google.

const db = testDatabase();
let google: FakeGoogle;
let deps: ReturnType<typeof setupDependencies>;

beforeAll(async () => {
  google = await startFakeGoogle();
  deps = setupDependencies(db, google);
});

afterAll(async () => {
  await google.close();
  await db.end();
});

describe("setup state", () => {
  it("starts a host without Calendar access at Connect Google Calendar, with draft values still proposed", async () => {
    const host = await seedHost(db, deps, google, { calendar: false, displayName: "Alice Kim" });

    const state = await readSetupState(deps, host.hostAccountId, { browserTimeZone: "Asia/Seoul" });

    expect(state).toMatchObject({
      account: { googleEmail: host.email },
      calendar: { calendars: null, connected: false, destinationLost: false, invalid: false },
      // The first read stored the browser zone as the timezone starter default.
      draft: { revision: 1 },
      links: null,
      missingFields: ["meetingMode"],
      nextAction: "connect_calendar",
      readiness: { ready: false },
    });
    expect(state!.fields.timezone.proposed).toMatchObject({
      accepted: false,
      reason: "From this browser.",
      source: "starter_default",
      value: "Asia/Seoul",
    });
    expect(state!.fields.displayName.proposed).toMatchObject({ source: "inferred", value: "Alice Kim" });
    expect(state!.fields.handle.proposed).toMatchObject({ source: "starter_default", value: host.local });
    expect(state!.fields.meetingMode.proposed).toBeNull();
  });

  it("stores the browser zone once when two first reads race, and both return the revision after it", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });

    const [one, two] = await Promise.all([
      readSetupState(deps, host.hostAccountId, { browserTimeZone: "Asia/Seoul" }),
      readSetupState(deps, host.hostAccountId, { browserTimeZone: "Europe/Paris" }),
    ]);

    expect(await draftRevision(db, host.hostAccountId)).toBe(1);
    expect(one!.draft.revision).toBe(1);
    expect(two!.draft.revision).toBe(1);
    expect(one!.fields.timezone.proposed!.value).toBe(two!.fields.timezone.proposed!.value);
  });

  it("lists the live calendars with recommendations while choosing calendars", async () => {
    const host = await seedHost(db, deps, google);

    const state = await readSetupState(deps, host.hostAccountId);

    expect(state!.nextAction).toBe("choose_calendars");
    expect(state!.calendar.calendars?.map((calendar) => calendar.id)).toEqual(host.calendars.map((calendar) => calendar.id));
    expect(state!.calendar.recommendations?.booking?.id).toBe(host.primaryId);
  });

  it("reports a revoked grant instead of an empty calendar list", async () => {
    const host = await seedHost(db, deps, google);
    google.setFixture(host.refreshToken, { calendars: host.calendars, events: {}, revoked: true });

    const first = await readSetupState(deps, host.hostAccountId);
    const second = await readSetupState(deps, host.hostAccountId);

    expect(first!.calendar).toMatchObject({ calendars: null, error: "calendar_access_revoked" });
    expect(second).toMatchObject({ calendar: { connected: false, invalid: true }, nextAction: "connect_calendar" });
  });

  it("waits on a pending scan unless the host chose manual setup", async () => {
    const host = await seedHost(db, deps, google);
    const ref = { accessRole: "owner", id: host.primaryId, summary: "Me" };
    await db`
      insert into app.calendar_roles (host_account_id, conflict_calendars, booking_calendar, destination_verified_at)
      values (${host.hostAccountId}, ${db.json([ref])}, ${db.json(ref)}, now())
    `;
    await db`
      insert into app.calendar_analyses (id, host_account_id, roles_revision, range_start, range_end, calendars)
      values (${randomUUID()}, ${host.hostAccountId}, 1, now() - interval '28 days', now() + interval '28 days',
              ${db.json([{ id: host.primaryId, ok: null, summary: "Me" }])})
    `;

    const pending = await readSetupState(deps, host.hostAccountId);
    expect(pending).toMatchObject({ analysis: { completedAt: null, state: "pending" }, nextAction: "analyzing" });
    // The roles' save time places the calendars receipt in the conversation.
    expect(pending!.roles!.savedAt).toEqual(expect.any(String));

    await db`insert into app.setup_drafts (host_account_id, analysis_skipped) values (${host.hostAccountId}, true)`;
    expect((await readSetupState(deps, host.hostAccountId))!.nextAction).toBe("review_suggestions");
  });

  it("moves to confirmation once the host answers the mode, and writes on read only the first browser zone", async () => {
    const host = await seedHost(db, deps, google);
    await prepareReviewableHost(db, host);
    const revision = await draftRevision(db, host.hostAccountId);

    const state = await readSetupState(deps, host.hostAccountId);
    expect(await draftRevision(db, host.hostAccountId)).toBe(revision);
    const zoned = await readSetupState(deps, host.hostAccountId, { browserTimeZone: "Europe/Paris", includeCalendars: true });
    const again = await readSetupState(deps, host.hostAccountId, { browserTimeZone: "America/New_York" });

    expect(state).toMatchObject({ calendar: { calendars: null }, missingFields: [], nextAction: "confirm_settings" });
    expect(state!.roles?.bookingCalendar.id).toBe(host.primaryId);
    expect(state!.fields.meetingMode.proposed).toMatchObject({ accepted: true, source: "stated", value: "online" });
    expect(state!.fields.timezone.proposed).toMatchObject({ source: "starter_default", value: "UTC" });
    expect(zoned).toMatchObject({ draft: { revision: revision + 1 }, fields: { timezone: { proposed: { value: "Europe/Paris" } } } });
    // Once stored, a request's zone changes nothing.
    expect(again).toMatchObject({ draft: { revision: revision + 1 }, fields: { timezone: { proposed: { value: "Europe/Paris" } } } });
    expect(await draftRevision(db, host.hostAccountId)).toBe(revision + 1);
  });
});

// Confirms a reviewable host and backdates its destination check past the hour,
// so the next state read rechecks the destination against the live list.
async function readyHostDueForRecheck(host: SeededHost) {
  const live = await prepareReviewableHost(db, host);
  const review = await readSetupState(deps, host.hostAccountId);
  const confirmed = await runCommand(hostCommandDeps(db, host.hostAccountId), confirmSettingsCommand(live, SETUP_ORIGIN), {
    expectedRevision: review!.draft.revision,
    input: { proposalHash: review!.proposalHash },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
  if (!confirmed.ok) throw new Error(`Confirming failed: ${confirmed.error.category}`);
  await db`
    update app.host_settings
    set settings = jsonb_set(settings, '{bookingCalendar,verifiedAt}', to_jsonb((now() - interval '2 hours')::text))
    where host_account_id = ${host.hostAccountId}
  `;
}

describe("ready host rechecks", () => {
  it("asks a ready host whose destination became read-only to choose calendars again", async () => {
    const host = await seedHost(db, deps, google);
    await readyHostDueForRecheck(host);
    google.setFixture(host.refreshToken, {
      calendars: host.calendars.map((calendar) => (calendar.primary ? { ...calendar, accessRole: "reader" } : calendar)),
      events: {},
    });

    const state = await readSetupState(deps, host.hostAccountId);

    expect(state).toMatchObject({
      calendar: { destinationLost: true },
      links: null,
      nextAction: "choose_calendars",
      readiness: { ready: false },
    });
    expect(state!.calendar.calendars?.find((calendar) => calendar.id === host.primaryId)?.accessRole).toBe("reader");
  });

  it("asks a ready host whose Google access was revoked to connect Calendar again", async () => {
    const host = await seedHost(db, deps, google);
    await readyHostDueForRecheck(host);
    google.setFixture(host.refreshToken, { calendars: host.calendars, events: {}, revoked: true });

    const state = await readSetupState(deps, host.hostAccountId);

    expect(state).toMatchObject({
      calendar: { connected: false, invalid: true },
      links: null,
      nextAction: "connect_calendar",
      readiness: { ready: false },
    });
  });

  it("treats a grant missing any Calendar scope as not ready and not connected alike", async () => {
    const host = await seedHost(db, deps, google);
    await readyHostDueForRecheck(host);
    await db`update app.host_settings set settings = jsonb_set(settings, '{bookingCalendar,verifiedAt}', to_jsonb(now()::text)) where host_account_id = ${host.hostAccountId}`;
    expect((await readReadiness(db, host.hostAccountId)).ready).toBe(true);

    await db`
      update app.provider_grants set granted_scopes = ${[GOOGLE_CALENDAR_SCOPES[0], GOOGLE_CALENDAR_SCOPES[1]]}
      where host_account_id = ${host.hostAccountId}
    `;

    expect((await readReadiness(db, host.hostAccountId)).ready).toBe(false);
    expect(await readSetupState(deps, host.hostAccountId)).toMatchObject({ calendar: { connected: false }, nextAction: "connect_calendar" });
  });
});

describe("setup routes", () => {
  const origin = "http://localhost:3000";
  const routeDeps = (): SetupRouteDependencies => ({ ...deps, appOrigin: origin, auth: localAuthConfig() });
  const state = createSetupStateHandler(routeDeps);
  const commands = createSetupCommandHandler(routeDeps);
  const handles = createHandleCheckHandler(routeDeps);
  const post = (cookie: string, body: unknown, headers: Record<string, string> = { origin }) =>
    commands(
      new Request(`${origin}/api/setup/commands`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", cookie, ...headers },
        method: "POST",
      }),
    );

  it("refuses a signed-out request and a cross-site command", async () => {
    const host = await signInHost(db);

    expect((await state(new Request(`${origin}/api/setup/state`))).status).toBe(401);
    expect((await post(host.cookie, {}, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("serves the signed-in host's state privately and runs card commands with their revisions", async () => {
    const host = await signInHost(db);
    const read = await state(new Request(`${origin}/api/setup/state?tz=Asia/Seoul`, { headers: { cookie: host.cookie } }));
    const body = (await read.json()) as { nextAction: string; draft: { revision: number } };
    const command = { expectedRevision: 1, input: { action: "adjust", field: "durationMinutes", value: 45 }, operation: "setup.update_draft", retryKey: randomUUID() };

    const saved = await post(host.cookie, command);
    const stale = await post(host.cookie, { ...command, retryKey: randomUUID() });
    const invalid = await post(host.cookie, { ...command, input: { action: "adjust", field: "durationMinutes", value: 7 }, expectedRevision: 2, retryKey: randomUUID() });
    const zoned = await post(host.cookie, { ...command, input: { action: "adjust", browserTimeZone: "Asia/Seoul", field: "durationMinutes", value: 50 }, expectedRevision: 2, retryKey: randomUUID() });
    const connect = await post(host.cookie, { input: { proposalHash: "a".repeat(64) }, expectedRevision: 2, operation: "setup.confirm_settings", retryKey: randomUUID() });
    const handle = await handles(new Request(`${origin}/api/setup/handle?candidate=Admin`, { headers: { cookie: host.cookie } }));

    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    // The read stored the browser zone, which is revision 1.
    expect(body).toMatchObject({ draft: { revision: 1 }, nextAction: "connect_calendar" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, result: { revision: 2 } });
    expect(stale.status).toBe(409);
    expect(invalid.status).toBe(400);
    // Commands no longer carry the browser zone.
    expect(zoned.status).toBe(400);
    // Confirmation reads the live calendar list first, and this host has no grant.
    expect(connect.status).toBe(409);
    expect(await connect.json()).toMatchObject({ code: "calendar_not_connected" });
    expect(await handle.json()).toEqual({ availability: "reserved", handle: "admin" });
  });

  it("refuses a confirmation whose destination became read-only with the destination reason, then asks for calendars", async () => {
    const host = await signInHost(db);
    const refreshToken = `refresh-${randomUUID()}`;
    const primaryId = `primary-${randomUUID()}@example.test`;
    const calendars = [{ ...PRIMARY, id: primaryId }];
    await recordGoogleGrant(db, deps.tokenKey, { grantedScopes: [...GOOGLE_CALENDAR_SCOPES], hostAccountId: host.hostAccountId, refreshToken });
    google.setFixture(refreshToken, { calendars, events: {} });
    await prepareReviewableHost(db, { calendars, hostAccountId: host.hostAccountId, primaryId } as unknown as SeededHost);
    const read = () => state(new Request(`${origin}/api/setup/state`, { headers: { cookie: host.cookie } }));
    const review = (await (await read()).json()) as { draft: { revision: number }; proposalHash: string; nextAction: string };
    google.setFixture(refreshToken, { calendars: [{ ...calendars[0]!, accessRole: "reader" }], events: {} });

    const refused = await post(host.cookie, {
      expectedRevision: review.draft.revision,
      input: { proposalHash: review.proposalHash },
      operation: "setup.confirm_settings",
      retryKey: randomUUID(),
    });
    const after = (await (await read()).json()) as { nextAction: string; calendar: { destinationLost: boolean } };

    expect(review.nextAction).toBe("confirm_settings");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { category: "invalid_input", reason: "destination_not_writable" }, ok: false });
    expect(after).toMatchObject({ calendar: { destinationLost: true }, nextAction: "choose_calendars" });
  });
});
