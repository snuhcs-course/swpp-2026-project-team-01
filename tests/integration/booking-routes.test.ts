import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  createIntakeTranscriptHandler,
  createRequesterCalendarsHandler,
  createRequesterCommandHandler,
  createRequesterEventsHandler,
  createRequesterMessageHandler,
  createRequesterStateHandler,
} from "../../lib/server/requester-routes";
import { testDatabase } from "./support/database";
import { call, guestDependencies, recordingRuntime, type Sent } from "./support/guests";
import { closeTestRequest, createTestRequest } from "./support/requests";

// The booking page's application routes (task 3.2): lookup by hash, the same
// generic answer for an unknown, malformed or expired link and (where an open
// request is needed) a closed one, the credential headers on every response, the
// minimal closed view, and a message that lands only in its own request's
// discussion.

const db = testDatabase();
const sent: Sent[] = [];
const deps = guestDependencies(db, { runtime: recordingRuntime(sent) });

afterAll(async () => {
  await db.end();
});

const UNAVAILABLE = { code: "unavailable", error: "This booking link is not available." };

const routes = {
  calendars: (bookingId: string) => call(createRequesterCalendarsHandler(() => deps), { bookingId }, "/calendars"),
  commands: (bookingId: string) =>
    call(createRequesterCommandHandler(() => deps), { bookingId }, "/commands", {
      body: { expectedRevision: 1, input: {}, operation: "request.withdraw", retryKey: randomUUID() },
    }),
  events: (bookingId: string) => call(createRequesterEventsHandler(() => deps), { bookingId }, "/events?cursor=0"),
  intake: (bookingId: string) => call(createIntakeTranscriptHandler(() => deps), { bookingId }, "/intake?cursor=0"),
  messages: (bookingId: string) =>
    call(createRequesterMessageHandler(() => deps), { bookingId }, "/messages", {
      body: { clientInputId: randomUUID(), message: "Hello" },
    }),
  state: (bookingId: string) => call(createRequesterStateHandler(() => deps), { bookingId }, "/state"),
};

function expectCredentialHeaders(response: Response) {
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expect(response.headers.get("cache-control")).toContain("no-store");
}

describe("booking routes", () => {
  it.each([
    ["malformed", async () => "not-a-booking-id"],
    ["unknown", async () => randomUUID()],
    [
      "expired",
      async () => {
        const request = await createTestRequest(db);
        await db`update app.booking_links set expires_at = now() - interval '1 second' where request_id = ${request.requestId}`;
        return request.bookingId;
      },
    ],
  ])("answers a %s link with the same generic unavailable result everywhere", async (_name, link) => {
    const bookingId = await link();

    for (const route of Object.values(routes)) {
      const response = await route(bookingId);
      expect(response.status).toBe(404);
      expectCredentialHeaders(response);
      expect(await response.json()).toEqual(UNAVAILABLE);
    }
  });

  it("gives a closed request with an unexpired link only its status, and refuses everything else", async () => {
    const request = await createTestRequest(db);
    await closeTestRequest(db, request.requestId);

    const state = await routes.state(request.bookingId);
    expect(state.status).toBe(200);
    expectCredentialHeaders(state);
    expect(await state.json()).toEqual({ host: { displayName: "Your host", handle: null }, open: false, request: { state: "withdrawn" } });

    for (const route of [routes.events, routes.messages, routes.intake, routes.calendars]) {
      const response = await route(request.bookingId);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(UNAVAILABLE);
    }

    const command = await routes.commands(request.bookingId);
    expect(command.status).toBe(409);
    expect(await command.json()).toMatchObject({ error: { category: "request_closed" }, status: "withdrawn" });
  });

  it("serves an open request's view, with its contact and connection state but nothing of the host's", async () => {
    const request = await createTestRequest(db);
    const response = await routes.state(request.bookingId.toUpperCase());

    expect(response.status).toBe(200);
    expectCredentialHeaders(response);
    const view = (await response.json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      connection: { calendar: false, canUseGoogleEmail: false, identity: false },
      contact: { confirmed: false, email: request.contactEmail, name: "Grace Hopper" },
      conversation: { generation: null, state: "none" },
      open: true,
      request: { revision: 1, state: "gathering" },
    });
    expect(JSON.stringify(view)).not.toMatch(/refresh|weeklyWindows|bookingCalendar|token/i);
  });

  it("records a message only in its own request's discussion", async () => {
    const [mine, other] = await Promise.all([createTestRequest(db), createTestRequest(db)]);
    const response = await routes.messages(mine.bookingId);

    expect(response.status).toBe(202);
    expectCredentialHeaders(response);
    const counts = await db<{ count: number; principal_id: string }[]>`
      select d.principal_id, count(i.id)::int as count
      from app.discussions d left join app.conversation_inputs i on i.discussion_id = d.id
      where d.principal_type = 'requester_request' and d.principal_id in (${mine.requestId}, ${other.requestId})
      group by d.principal_id
    `;
    expect(counts).toEqual([{ count: 1, principal_id: mine.requestId }]);
  });

  it("refuses a cross-site message", async () => {
    const request = await createTestRequest(db);
    const response = await call(createRequesterMessageHandler(() => deps), { bookingId: request.bookingId }, "/messages", {
      body: { clientInputId: randomUUID(), message: "Hello" },
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});
