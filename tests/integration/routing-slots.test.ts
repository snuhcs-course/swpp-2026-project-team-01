import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awaitEvaluation, publishEvaluation } from "../../lib/server/evaluation";
import { createCalendarHost, fakeGoogleConfig } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { FAKE_ROUTES_API_KEY, type FakeRoutes, startFakeRoutes } from "./support/fake-routes";
import { calendarKey, evaluationDeps, MONDAY, runEvaluation, seoul, settingsFor } from "./support/scheduling";

// Routing evaluation (issue #186; documentation 13, "Routing time and the
// offered slots"), through the real evaluation job, fake Google Calendar and
// fake Routes: one in-person request searched twice with the same calendar,
// details and settings, changing only the Routes duration of the host's trip.
// The candidates read here are the guest-visible list the booking page and the
// assistant show. lib/server/routing-slots.test.ts is the same check on the
// engine alone.

const db = testDatabase();
let google: FakeGoogle;
let routes: FakeRoutes;

beforeAll(async () => {
  google = await startFakeGoogle();
  routes = await startFakeRoutes();
});

afterAll(async () => {
  await google.close();
  await routes.close();
  await db.end();
});

describe("routing time and the slots offered to guests", () => {
  it("offers 11:45 after a 20-minute trip and leaves it out after a 35-minute trip", async () => {
    const office = `Office ${randomUUID()}, Gangnam`;
    const cafe = `Cafe ${randomUUID()}, Seongsu`;
    const host = await createCalendarHost(db, calendarKey);
    const calendarId = host.email;
    google.setFixture(host.refreshToken!, {
      calendars: [{ accessRole: "owner", conferenceSolutionTypes: ["hangoutsMeet"], id: calendarId, primary: true, summary: "Work" }],
      events: {
        [calendarId]: [
          { end: { dateTime: seoul("11:00") }, id: `event-${randomUUID()}`, location: office, start: { dateTime: seoul("10:00") }, status: "confirmed" },
        ],
      },
    });
    await db`
      insert into app.host_settings (host_account_id, settings, draft_revision)
      values (${host.hostAccountId}, ${db.json(settingsFor(calendarId, { bufferAfterMinutes: 10, bufferBeforeMinutes: 10, travelBufferMinutes: 15 }) as never)}, 1)
    `;
    const [request] = await db<{ id: string }[]>`
      insert into app.requests (host_account_id, requester_name, contact_email, expires_at, details)
      values (${host.hostAccountId}, 'Grace Hopper', ${`grace-${randomUUID()}@example.test`}, now() + interval '7 days',
        ${db.json({
          durationMinutes: 30,
          language: "en",
          linkPlan: null,
          location: cafe,
          mode: "in_person",
          purpose: "Talk about compilers",
          timezone: "Asia/Seoul",
          travelMode: "transit",
          windows: [{ end: seoul("12:30"), start: seoul("11:00") }],
        } as never)})
      returning id
    `;
    const deps = evaluationDeps(db, google, {
      calendar: fakeGoogleConfig(google),
      routes: { apiKey: FAKE_ROUTES_API_KEY, baseUrl: routes.baseUrl, timeoutMs: 5_000 },
    });

    async function guestVisibleStarts(tripMinutes: number) {
      const started = new Date();
      routes.setRoute(office, cafe, "TRANSIT", tripMinutes);
      const { evaluationId } = await db.begin((tx) => publishEvaluation(tx, { audience: "requester", requestId: request!.id, retryKey: randomUUID() }));
      await runEvaluation(db, deps, evaluationId);
      const view = await awaitEvaluation(db, evaluationId, 1_000);
      // Saved estimates are reused for 24 hours; age this search's so the next
      // search asks Routes again and sees only the new duration.
      await db`update app.route_estimates set fetched_at = now() - interval '2 days' where fetched_at >= ${started}`;
      return { starts: view!.candidates.map((candidate) => candidate.start).sort(), view };
    }

    const shorter = await guestVisibleStarts(20);
    const longer = await guestVisibleStarts(35);

    expect(shorter.view).toMatchObject({ failure: null, state: "completed" });
    expect(longer.view).toMatchObject({ failure: null, state: "completed" });
    // 11:00 plus the trip plus 25 minutes of buffers (10 before, 15 travel).
    expect(shorter.starts).toEqual(["11:45", "12:00"].map((clock) => seoul(clock, MONDAY)));
    expect(longer.starts).toEqual([seoul("12:00", MONDAY)]);
  });
});
