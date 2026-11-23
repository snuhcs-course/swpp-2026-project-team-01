import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequesterCommandHandler } from "../../lib/server/requester-routes";
import { createWorkspaceRequestListHandler } from "../../lib/server/host-request-routes";
import { readHostDashboard } from "../../lib/server/host-dashboard";
import { closeRequest } from "../../lib/server/request-lifecycle";
import { recordHostSessionMatch } from "../../lib/server/requester-host-profiles";
import { listWorkspaceRequests } from "../../lib/server/workspace-requests";
import { localAuthConfig, signInHost } from "./support/auth";
import { approveCommand } from "../../lib/server/bookings";
import { agreedRequest, asHost, bookingDeps, bookingOf, runBooking } from "./support/booking";
import { fakeGoogleConfig } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { call, guestDependencies, readyHost, startedDraft } from "./support/guests";
import { createTestRequest, testTokenKey } from "./support/requests";
import { calendarKey, revisionOf } from "./support/scheduling";

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

describe("signed-in account requests", () => {
  it("links the Continue without Google flow to an existing signed-in account", async () => {
    const viewer = await signInHost(db);
    const host = await readyHost(db);
    const deps = guestDependencies(db, { hostAuth: localAuthConfig() });
    const draft = await startedDraft(deps, host.handle);

    const response = await call(createRequesterCommandHandler(() => deps), { bookingId: draft.bookingId }, "/commands", {
      body: {
        expectedRevision: null,
        input: { email: "different-address@example.test", name: "Grace Hopper", timezone: "Asia/Seoul" },
        operation: "request.identify",
        retryKey: randomUUID(),
      },
      headers: { cookie: viewer.cookie },
    });

    expect(response.status).toBe(200);
    expect((await listWorkspaceRequests(db, viewer.hostAccountId, [testTokenKey])).map((item) => item.requestId)).toContain(draft.requestId);
  });

  it("links a manually identified request by the signed-in user ID, not by the typed email", async () => {
    const viewer = await signInHost(db);
    const other = await signInHost(db);
    const sent = await createTestRequest(db, { contactEmail: "different-address@example.test" });

    await db.begin((tx) => recordHostSessionMatch(tx, sent.requestId, viewer.userId));
    await db.begin((tx) => recordHostSessionMatch(tx, sent.requestId, other.userId));
    expect((await listWorkspaceRequests(db, viewer.hostAccountId, [testTokenKey])).map((item) => item.requestId)).toContain(sent.requestId);
    expect((await listWorkspaceRequests(db, other.hostAccountId, [testTokenKey])).map((item) => item.requestId)).not.toContain(sent.requestId);
  });

  it("combines received and matched sent requests, without revealing another account's private link", async () => {
    const viewer = await signInHost(db);
    const outsider = await signInHost(db);
    const received = await createTestRequest(db, { hostAccountId: viewer.hostAccountId });
    const sent = await createTestRequest(db);
    const unmatched = await createTestRequest(db);
    await db`insert into app.requester_host_profiles (request_id, host_account_id) values (${sent.requestId}, ${viewer.hostAccountId})`;

    const items = await listWorkspaceRequests(db, viewer.hostAccountId, [testTokenKey]);
    expect(items.map((item) => [item.requestId, item.direction])).toEqual(expect.arrayContaining([
      [received.requestId, "received"],
      [sent.requestId, "sent"],
    ]));
    expect(items.map((item) => item.requestId)).not.toContain(unmatched.requestId);
    expect(items.find((item) => item.requestId === sent.requestId)?.bookingPath).toBe(`/booking/${sent.bookingId}`);
    expect(items.find((item) => item.requestId === received.requestId)?.bookingPath).toBeNull();

    const route = createWorkspaceRequestListHandler(
      () => ({ appOrigin: "http://localhost:3000", auth: localAuthConfig(), db }) as never,
      () => [testTokenKey],
    );
    const response = await route(new Request("http://localhost:3000/api/host/workspace-requests", { headers: { cookie: outsider.cookie } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { requests: { requestId: string; bookingPath: string | null }[] };
    expect(body.requests.map((item) => item.requestId)).not.toContain(sent.requestId);
    expect(JSON.stringify(body)).not.toContain(sent.bookingId);
    expect((await route(new Request("http://localhost:3000/api/host/workspace-requests"))).status).toBe(401);
  });

  it("keeps closed sent history after clearing the settings choice and withholds an expired link", async () => {
    const viewer = await signInHost(db);
    const sent = await createTestRequest(db);
    await db`
      insert into app.requester_host_profiles (request_id, host_account_id, items, decided_at)
      values (${sent.requestId}, ${viewer.hostAccountId}, ${["details"]}, now())
    `;
    await db.begin((tx) => closeRequest(tx, sent.requestId, "withdrawn"));
    const [match] = await db<{ items: string[]; decided_at: Date | null }[]>`
      select items, decided_at from app.requester_host_profiles where request_id = ${sent.requestId}
    `;
    expect(match).toEqual({ decided_at: null, items: [] });

    await db`update app.booking_links set expires_at = now() - interval '1 minute' where request_id = ${sent.requestId}`;
    const item = (await listWorkspaceRequests(db, viewer.hostAccountId, [testTokenKey])).find((request) => request.requestId === sent.requestId);
    expect(item).toMatchObject({ bookingPath: null, direction: "sent", state: "withdrawn" });
  });

  it("shows a timed sent request as awaiting approval in the calendar without calling it booked", async () => {
    const request = await agreedRequest(db, google);
    const viewer = await signInHost(db);
    await db`insert into app.requester_host_profiles (request_id, host_account_id) values (${request.requestId}, ${viewer.hostAccountId})`;
    const data = await readHostDashboard(
      db,
      { config: fakeGoogleConfig(google), db, tokenKeys: [testTokenKey] },
      viewer.hostAccountId,
      { end: new Date(Date.parse(request.end) + 86_400_000), start: new Date(Date.parse(request.start) - 86_400_000) },
    );
    expect(data.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `sent:${request.requestId}`, source: "sent", start: request.start, state: "awaiting_host_approval" }),
    ]));
    expect(data.events.filter((event) => event.id === `sent:${request.requestId}`)).toHaveLength(1);
  });

  // host-dashboard-booking-details: the Dashboard joins each confirmed booking
  // to its proposal and request for the details the host approved.
  async function bookedDashboardEvent(request: Awaited<ReturnType<typeof agreedRequest>>) {
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    const bookingId = approved.result.bookingId;
    expect(await runBooking(db, bookingDeps(db, google), bookingId)).toBe("completed");
    const data = await readHostDashboard(
      db,
      { config: fakeGoogleConfig(google), db, tokenKeys: [calendarKey] },
      request.hostAccountId,
      { end: new Date(Date.parse(request.end) + 86_400_000), start: new Date(Date.parse(request.start) - 86_400_000) },
    );
    const events = data.events.filter((event) => event.id === `thyme:${bookingId}`);
    expect(events).toHaveLength(1);
    return { booking: await bookingOf(db, bookingId), event: events[0]! };
  }

  it("shows a booked online meeting with its length, Meet link, confirmed guest, purpose and request", async () => {
    const request = await agreedRequest(db, google, { confirmed: true });
    const { booking, event } = await bookedDashboardEvent(request);

    expect(event).toMatchObject({ source: "thyme", start: request.start, end: request.end });
    expect(booking.evidence?.joinUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(event.meeting).toEqual({
      durationMinutes: 30,
      guest: { email: request.contactEmail, emailConfirmed: true, name: "Grace Hopper" },
      joinUrl: booking.evidence?.joinUrl,
      mode: "online",
      purpose: "Talk about compilers",
      requestId: request.requestId,
    });
  });

  it("shows a booked in-person meeting at its place, without a join link or a confirmed address", async () => {
    const venue = `AA Cafe ${randomUUID().slice(0, 8)}`;
    const request = await agreedRequest(db, google, {
      details: { location: null, mode: "in_person", travelMode: "transit" },
      settings: { location: { areas: [`Seolleung Station ${randomUUID().slice(0, 8)}`], kind: "places", venue } },
    });
    const { event } = await bookedDashboardEvent(request);
    const [created] = google.createdEvents(request.calendarId);

    expect(event.location).toBe(created!.location);
    expect(event.meeting).toEqual({
      durationMinutes: 30,
      guest: { email: request.contactEmail, emailConfirmed: false, name: "Grace Hopper" },
      joinUrl: null,
      mode: "in_person",
      purpose: "Talk about compilers",
      requestId: request.requestId,
    });
  });
});
