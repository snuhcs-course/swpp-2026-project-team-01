import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLatestAnalysis } from "../../lib/server/analysis";
import { readCalendarRoles, recheckConfirmedDestination, saveCalendarRolesCommand } from "../../lib/server/calendar-roles";
import { runCommand } from "../../lib/server/commands";
import { type CalendarListEntry, openHostCalendar } from "../../lib/server/google-calendar";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { analysisJobs, createCalendarHost, fakeGoogleConfig, hostCommandDeps, suspend } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { defaultGoogleFixture, type FakeGoogle, type FakeGoogleFixture, startFakeGoogle } from "./support/fake-google";

const db = testDatabase();
const key = parseTokenKey(randomBytes(32).toString("base64"));
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

function deps() {
  return { config: fakeGoogleConfig(google), db, tokenKeys: [key] };
}

// A host with the default fixture, and its live calendar list as the card reads it.
async function hostWithCalendars(fixture?: (email: string) => FakeGoogleFixture) {
  const host = await createCalendarHost(db, key);
  google.setFixture(host.refreshToken!, fixture?.(host.email) ?? defaultGoogleFixture(new Date(), host.email));
  const live = (await (await openHostCalendar(deps(), host.hostAccountId)).listCalendars()).calendars;
  return { ...host, live };
}

function save(
  hostAccountId: string,
  live: CalendarListEntry[],
  input: { conflictCalendarIds: string[]; bookingCalendarId: string },
  options: { expectedRevision?: number | null; retryKey?: string } = {},
) {
  return runCommand(hostCommandDeps(db, hostAccountId), saveCalendarRolesCommand(live), {
    expectedRevision: options.expectedRevision ?? null,
    input,
    resourceId: hostAccountId,
    retryKey: options.retryKey ?? randomUUID(),
  });
}

describe("setup.save_calendar_roles", () => {
  it("saves roles by provider identity, keeps the draft row and publishes one scan", async () => {
    const host = await hostWithCalendars();

    const outcome = await save(host.hostAccountId, host.live, {
      bookingCalendarId: "shared-writer@group.calendar.google.com",
      conflictCalendarIds: [host.email, "shared-writer@group.calendar.google.com", "shared-reader@group.calendar.google.com"],
    });

    expect(outcome).toMatchObject({ ok: true, result: { revision: 1 } });
    const roles = await readCalendarRoles(db, host.hostAccountId);
    expect(roles).toMatchObject({
      bookingCalendar: { accessRole: "writer", id: "shared-writer@group.calendar.google.com", summary: "Shared" },
      conflictCalendars: [
        { accessRole: "owner", id: host.email, primary: true },
        { accessRole: "writer", id: "shared-writer@group.calendar.google.com", summary: "Shared" },
        { accessRole: "reader", id: "shared-reader@group.calendar.google.com", summary: "Shared" },
      ],
      revision: 1,
    });
    expect(roles!.conflictCalendars[0]).not.toHaveProperty("timeZone");

    const jobs = await analysisJobs(db, host.hostAccountId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload.analysisId).toBe(outcome.ok && outcome.result.analysisId);
    const analysis = await readLatestAnalysis(db, host.hostAccountId);
    expect(analysis).toMatchObject({
      calendars: [
        { id: host.email, ok: null },
        { id: "shared-writer@group.calendar.google.com", ok: null, summary: "Shared" },
        { id: "shared-reader@group.calendar.google.com", ok: null, summary: "Shared" },
      ],
      state: "pending",
    });
    const span = Date.parse(analysis!.range.end) - Date.parse(analysis!.range.start);
    expect(span).toBe(56 * 86_400_000);

    const [draft] = await db`select analysis_skipped from app.setup_drafts where host_account_id = ${host.hostAccountId}`;
    expect(draft).toEqual({ analysis_skipped: false });
  });

  it("rejects a read-only destination and keeps the previous roles", async () => {
    const host = await hostWithCalendars();
    await save(host.hostAccountId, host.live, { bookingCalendarId: host.email, conflictCalendarIds: [host.email] });

    const outcome = await save(
      host.hostAccountId,
      host.live,
      { bookingCalendarId: "team@group.calendar.google.com", conflictCalendarIds: [host.email] },
      { expectedRevision: 1 },
    );

    expect(outcome).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect(await readCalendarRoles(db, host.hostAccountId)).toMatchObject({ bookingCalendar: { id: host.email }, revision: 1 });
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(1);
  });

  it("rejects calendars that are not in the live list", async () => {
    const host = await hostWithCalendars();

    const unknownConflict = await save(host.hostAccountId, host.live, {
      bookingCalendarId: host.email,
      conflictCalendarIds: [host.email, "someone-else@example.test"],
    });
    const unknownDestination = await save(host.hostAccountId, host.live, {
      bookingCalendarId: "someone-else@example.test",
      conflictCalendarIds: [host.email],
    });
    const noConflict = await save(host.hostAccountId, host.live, { bookingCalendarId: host.email, conflictCalendarIds: [] });

    for (const outcome of [unknownConflict, unknownDestination, noConflict]) {
      expect(outcome).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    }
    expect(await readCalendarRoles(db, host.hostAccountId)).toBeNull();
  });

  it("rejects a stale revision", async () => {
    const host = await hostWithCalendars();
    const input = { bookingCalendarId: host.email, conflictCalendarIds: [host.email] };

    expect(await save(host.hostAccountId, host.live, input)).toMatchObject({ ok: true, result: { revision: 1 } });
    // Roles exist now, so "no roles yet" is stale.
    expect(await save(host.hostAccountId, host.live, input)).toMatchObject({ error: { category: "stale_revision" } });
    expect(await save(host.hostAccountId, host.live, input, { expectedRevision: 1 })).toMatchObject({
      ok: true,
      result: { revision: 2 },
    });
    expect(await save(host.hostAccountId, host.live, input, { expectedRevision: 1 })).toMatchObject({
      error: { category: "stale_revision" },
    });
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(2);
  });

  it("replays an exact retry without saving or scanning again", async () => {
    const host = await hostWithCalendars();
    const input = { bookingCalendarId: host.email, conflictCalendarIds: [host.email] };

    const first = await save(host.hostAccountId, host.live, input, { retryKey: "card-save-1" });
    const retry = await save(host.hostAccountId, host.live, input, { retryKey: "card-save-1" });

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(retry).toMatchObject({ ok: true, replayed: true });
    expect(retry.ok && retry.result).toEqual(first.ok && first.result);
    expect((await readCalendarRoles(db, host.hostAccountId))!.revision).toBe(1);
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(1);
  });

  it("rejects a suspended host without saving", async () => {
    const host = await hostWithCalendars();
    await suspend(db, host.hostAccountId);

    const outcome = await save(host.hostAccountId, host.live, { bookingCalendarId: host.email, conflictCalendarIds: [host.email] });

    expect(outcome).toMatchObject({ error: { category: "forbidden" }, ok: false });
    expect(await readCalendarRoles(db, host.hostAccountId)).toBeNull();
    expect(await analysisJobs(db, host.hostAccountId)).toHaveLength(0);
  });
});

describe("confirmed destination recheck", () => {
  async function confirmedHost(verifiedAt: Date, fixture?: (email: string) => FakeGoogleFixture) {
    const host = await hostWithCalendars(fixture);
    await db`
      insert into app.host_settings (host_account_id, settings, draft_revision)
      values (
        ${host.hostAccountId},
        ${db.json({
          bookingCalendar: { accessRole: "owner", id: host.email, summary: host.email, verifiedAt: verifiedAt.toISOString() },
          timezone: "Asia/Seoul",
        })},
        1
      )
    `;
    return host;
  }

  async function bookingCalendar(hostAccountId: string) {
    const [row] = await db<{ booking: { verifiedAt: string; unwritableAt?: string } }[]>`
      select settings -> 'bookingCalendar' as booking from app.host_settings where host_account_id = ${hostAccountId}
    `;
    return row!.booking;
  }

  const now = new Date("2026-10-19T12:00:00Z");

  it("skips a destination verified within the hour", async () => {
    const host = await confirmedHost(new Date(now.getTime() - 10 * 60_000));
    const before = google.requests.length;

    expect(await recheckConfirmedDestination(deps(), host.hostAccountId, now)).toBe("fresh");
    expect(google.requests.length).toBe(before);
  });

  it("refreshes the verification of a still-writable destination", async () => {
    const host = await confirmedHost(new Date(now.getTime() - 2 * 3_600_000));

    expect(await recheckConfirmedDestination(deps(), host.hostAccountId, now)).toBe("verified");
    expect(await bookingCalendar(host.hostAccountId)).toMatchObject({ verifiedAt: now.toISOString() });
    expect(await bookingCalendar(host.hostAccountId)).not.toHaveProperty("unwritableAt");
  });

  it("marks a destination that became read-only as unwritable", async () => {
    const host = await confirmedHost(new Date(now.getTime() - 2 * 3_600_000), (email) => {
      const fixture = defaultGoogleFixture(new Date(), email);
      return {
        ...fixture,
        calendars: fixture.calendars.map((calendar) => (calendar.id === email ? { ...calendar, accessRole: "reader" } : calendar)),
      };
    });

    expect(await recheckConfirmedDestination(deps(), host.hostAccountId, now)).toBe("unwritable");
    expect(await bookingCalendar(host.hostAccountId)).toMatchObject({ unwritableAt: now.toISOString() });
    expect(await recheckConfirmedDestination(deps(), host.hostAccountId, now)).toBe("unwritable");
  });

  it("reports a revoked grant, which the client already marked invalid", async () => {
    const host = await confirmedHost(new Date(now.getTime() - 2 * 3_600_000));
    google.setFixture(host.refreshToken!, { ...defaultGoogleFixture(new Date(), host.email), revoked: true });

    expect(await recheckConfirmedDestination(deps(), host.hostAccountId, now)).toBe("revoked");
    const [grant] = await db`select invalidated_at is not null as invalid from app.provider_grants where host_account_id = ${host.hostAccountId}`;
    expect(grant).toEqual({ invalid: true });
    expect(await bookingCalendar(host.hostAccountId)).not.toHaveProperty("unwritableAt");
  });

  it("changes nothing when Calendar is unavailable", async () => {
    const host = await confirmedHost(new Date(now.getTime() - 2 * 3_600_000));
    const unavailable = { ...deps(), config: fakeGoogleConfig(google, { apiBaseUrl: "http://127.0.0.1:9/calendar/v3" }) };
    const before = await bookingCalendar(host.hostAccountId);

    expect(await recheckConfirmedDestination(unavailable, host.hostAccountId, now)).toBe("unknown");
    expect(await bookingCalendar(host.hostAccountId)).toEqual(before);
  });
});
