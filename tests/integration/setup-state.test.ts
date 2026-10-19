import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readSetupState } from "../../lib/server/setup";
import {
  createHandleCheckHandler,
  createSetupCommandHandler,
  createSetupStateHandler,
  type SetupRouteDependencies,
} from "../../lib/server/setup-routes";
import { localAuthConfig, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { draftRevision, prepareReviewableHost, seedHost, setupDependencies } from "./support/setup-host";

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
      calendar: { calendars: null, connected: false, invalid: false },
      draft: { revision: 0 },
      links: null,
      missingFields: ["meetingMode"],
      nextAction: "connect_calendar",
      readiness: { ready: false },
    });
    expect(state!.fields.timezone.proposed).toMatchObject({ reason: "From this browser.", source: "starter_default", value: "Asia/Seoul" });
    expect(state!.fields.displayName.proposed).toMatchObject({ source: "inferred", value: "Alice Kim" });
    expect(state!.fields.handle.proposed).toMatchObject({ source: "starter_default", value: host.local });
    expect(state!.fields.meetingMode.proposed).toBeNull();
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

    expect((await readSetupState(deps, host.hostAccountId))!.nextAction).toBe("analyzing");

    await db`insert into app.setup_drafts (host_account_id, analysis_skipped) values (${host.hostAccountId}, true)`;
    expect((await readSetupState(deps, host.hostAccountId))!.nextAction).toBe("review_suggestions");
  });

  it("moves to confirmation once the host answers the mode, and never writes on read", async () => {
    const host = await seedHost(db, deps, google);
    await prepareReviewableHost(db, host);
    const revision = await draftRevision(db, host.hostAccountId);

    const state = await readSetupState(deps, host.hostAccountId);
    await readSetupState(deps, host.hostAccountId, { browserTimeZone: "Europe/Paris", includeCalendars: true });

    expect(state).toMatchObject({ calendar: { calendars: null }, missingFields: [], nextAction: "confirm_settings" });
    expect(state!.roles?.bookingCalendar.id).toBe(host.primaryId);
    expect(state!.fields.meetingMode.proposed).toMatchObject({ accepted: true, source: "stated", value: "online" });
    expect(await draftRevision(db, host.hostAccountId)).toBe(revision);
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
    const command = { expectedRevision: 0, input: { action: "adjust", field: "durationMinutes", value: 45 }, operation: "setup.update_draft", retryKey: randomUUID() };

    const saved = await post(host.cookie, command);
    const stale = await post(host.cookie, { ...command, retryKey: randomUUID() });
    const invalid = await post(host.cookie, { ...command, input: { action: "adjust", field: "durationMinutes", value: 7 }, expectedRevision: 1, retryKey: randomUUID() });
    const connect = await post(host.cookie, { input: { proposalHash: "a".repeat(64) }, expectedRevision: 1, operation: "setup.confirm_settings", retryKey: randomUUID() });
    const handle = await handles(new Request(`${origin}/api/setup/handle?candidate=Admin`, { headers: { cookie: host.cookie } }));

    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({ draft: { revision: 0 }, nextAction: "connect_calendar" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, result: { revision: 1 } });
    expect(stale.status).toBe(409);
    expect(invalid.status).toBe(400);
    // Confirmation reads the live calendar list first, and this host has no grant.
    expect(connect.status).toBe(409);
    expect(await connect.json()).toMatchObject({ code: "calendar_not_connected" });
    expect(await handle.json()).toEqual({ availability: "reserved", handle: "admin" });
  });
});
