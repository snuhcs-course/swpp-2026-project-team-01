import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CalendarAccessError, openHostCalendar } from "../../lib/server/google-calendar";
import { recordGoogleGrant } from "../../lib/server/provider-grants";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { createCalendarHost, fakeGoogleConfig } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { defaultGoogleFixture, type FakeGoogle, startFakeGoogle } from "./support/fake-google";

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

async function category(promise: Promise<unknown>) {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof CalendarAccessError ? error.category : String(error);
  }
}

async function invalidatedAt(hostAccountId: string) {
  const [row] = await db<{ invalidated_at: Date | null }[]>`
    select invalidated_at from app.provider_grants where host_account_id = ${hostAccountId}
  `;
  return row!.invalidated_at;
}

describe("Google Calendar client", () => {
  it("lists actual calendars by provider identity, keeping two with the same name apart", async () => {
    const host = await createCalendarHost(db, key);
    google.setFixture(host.refreshToken!, defaultGoogleFixture(new Date(), host.email));

    const calendar = await openHostCalendar(deps(), host.hostAccountId);
    const { calendars, primaryTimeZone } = await calendar.listCalendars();

    expect(primaryTimeZone).toBe("Asia/Seoul");
    expect(calendars.filter((entry) => entry.summary === "Shared")).toEqual([
      { accessRole: "writer", id: "shared-writer@group.calendar.google.com", summary: "Shared", timeZone: "Asia/Seoul" },
      { accessRole: "reader", id: "shared-reader@group.calendar.google.com", summary: "Shared", timeZone: "Asia/Seoul" },
    ]);
    expect(calendars[0]).toMatchObject({ accessRole: "owner", id: host.email, primary: true });
  });

  it("reads the events of a calendar within the range", async () => {
    const host = await createCalendarHost(db, key);
    const now = new Date();
    google.setFixture(host.refreshToken!, defaultGoogleFixture(now, host.email));

    const calendar = await openHostCalendar(deps(), host.hostAccountId);
    const events = await calendar.listEvents(host.email, {
      end: new Date(now.getTime() + 28 * 86_400_000),
      start: new Date(now.getTime() - 28 * 86_400_000),
    });

    expect(events.length).toBeGreaterThanOrEqual(12);
    expect(events.find((event) => event.id === "client-2")).toMatchObject({
      hasConferenceLink: false,
      location: "Blue Bottle Coffee, Seongsu, Seoul",
    });
    expect(events.find((event) => event.id === "standup-1")).toMatchObject({ hasConferenceLink: true });
  });

  it("refuses a host who declined the Calendar scopes as not connected, without calling Google", async () => {
    const host = await createCalendarHost(db, key, {
      scopes: ["https://www.googleapis.com/auth/calendar.events.freebusy"],
    });
    const before = google.requests.length;

    expect(await category(openHostCalendar(deps(), host.hostAccountId))).toBe("calendar_not_connected");
    expect(google.requests.length).toBe(before);
  });

  it("marks a revoked grant invalid, and a reconnect that records a fresh token restores it", async () => {
    const host = await createCalendarHost(db, key, { refreshToken: "revoked" });

    const calendar = await openHostCalendar(deps(), host.hostAccountId);
    expect(await category(calendar.listCalendars())).toBe("calendar_access_revoked");
    expect(await invalidatedAt(host.hostAccountId)).toBeInstanceOf(Date);
    expect(await category(openHostCalendar(deps(), host.hostAccountId))).toBe("calendar_not_connected");

    // A sign-in that returns no refresh token does not restore it.
    await recordGoogleGrant(db, key, { grantedScopes: null, hostAccountId: host.hostAccountId, refreshToken: null });
    expect(await invalidatedAt(host.hostAccountId)).toBeInstanceOf(Date);

    // Connect Google Calendar: consent returns a fresh refresh token.
    const fresh = `1//refresh-${randomUUID()}`;
    google.setFixture(fresh, defaultGoogleFixture(new Date(), host.email));
    await recordGoogleGrant(db, key, { grantedScopes: null, hostAccountId: host.hostAccountId, refreshToken: fresh });

    expect(await invalidatedAt(host.hostAccountId)).toBeNull();
    const reconnected = await openHostCalendar(deps(), host.hostAccountId);
    expect((await reconnected.listCalendars()).calendars.length).toBe(5);
  });

  it("reports an unreachable Google as unavailable and leaves the grant valid", async () => {
    const host = await createCalendarHost(db, key);
    const calendar = await openHostCalendar(
      { ...deps(), config: fakeGoogleConfig(google, { tokenUrl: "http://127.0.0.1:9/token" }) },
      host.hostAccountId,
    );

    expect(await category(calendar.listCalendars())).toBe("calendar_unavailable");
    expect(await invalidatedAt(host.hostAccountId)).toBeNull();
  });
});
