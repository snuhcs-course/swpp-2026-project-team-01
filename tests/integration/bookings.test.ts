import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveCommand,
  BOOKING_PENDING_JOB,
  checkBookingCommand,
  createBookingPendingHandler,
  declineCommand,
  readBookingStatus,
} from "../../lib/server/bookings";
import { eventIdFor } from "../../lib/server/calendar-events";
import { withdrawRequestCommand } from "../../lib/server/request-lifecycle";
import {
  type AgreedRequest,
  agreedRequest,
  asHost,
  bookingDeps,
  bookingJobs,
  bookingOf,
  deliveriesOf,
  requestState,
  runBooking,
} from "./support/booking";
import { runJob } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { hashBookingId, sealBookingLink } from "../../lib/server/booking-links";
import { testNotices, testTokenKey } from "./support/requests";
import { asRequester, revisionOf } from "./support/scheduling";

// Approval and the booking job (calendar-booking) against the fake Google
// Calendar: revalidation before dispatch, the fixed event ID, reconciliation of
// lost responses, definitive failures, withdrawal and decline around dispatch,
// the confirmation and status emails. Every test seeds its own host and request
// and runs its own jobs, so suites sharing the local stack never interfere.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

async function approve(request: { hostAccountId: string; requestId: string }, version = 1, retryKey?: string) {
  return asHost(db, request.hostAccountId, request.requestId, approveCommand, { version }, {
    expectedRevision: await revisionOf(db, request.requestId),
    retryKey,
  });
}

async function approved(request: { hostAccountId: string; requestId: string }) {
  const outcome = await approve(request);
  if (!outcome.ok) throw new Error(`approve failed: ${outcome.error.category}`);
  return outcome.result.bookingId;
}

describe("approval", () => {
  it("reserves a booking on the agreed current version and moves the request to booking", async () => {
    const request = await agreedRequest(db, google);
    const outcome = await approve(request);

    expect(outcome.ok && outcome.result.state).toBe("reserved");
    expect((await requestState(db, request.requestId)).state).toBe("booking");
    expect(await bookingJobs(db, outcome.ok ? outcome.result.bookingId : "")).toHaveLength(1);
  });

  it("returns the same booking to a second approval with another retry key", async () => {
    const request = await agreedRequest(db, google);
    const first = await approve(request, 1, "mobile");
    const second = await approve(request, 1, "agent");

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.bookingId).toBe(first.result.bookingId);
    expect(second.result.repeated).toBe(true);
    const [count] = await db<{ count: number }[]>`select count(*)::int as count from app.bookings where request_id = ${request.requestId}`;
    expect(count!.count).toBe(1);
  });

  it("rejects a superseded version, an unagreed request and another host", async () => {
    const request = await agreedRequest(db, google);
    const stale = await approve(request, 2);
    expect(!stale.ok && stale.error.category).toBe("stale_revision");

    const other = await asHost(db, randomUUID(), request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(!other.ok && other.error.category).toBe("forbidden");

    await db`update app.requests set state = 'negotiating' where id = ${request.requestId}`;
    const unagreed = await approve(request, 1);
    expect(!unagreed.ok && unagreed.error.category).toBe("stale_revision");
  });
});

describe("the booking job", () => {
  it("creates one event under the fixed ID, books the request and records both confirmations", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);

    expect(await runBooking(db, bookingDeps(db, google), bookingId)).toBe("completed");

    const booking = await bookingOf(db, bookingId);
    expect(booking.state).toBe("confirmed");
    expect(booking.event_id).toBe(eventIdFor(bookingId));

    const events = google.createdEvents(request.calendarId);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(eventIdFor(bookingId));
    expect(events[0]!.attendees).toEqual([{ displayName: "Grace Hopper", email: request.contactEmail }]);
    expect(JSON.stringify(events[0])).not.toContain(request.bookingId);
    expect(events[0]!.conferenceData).toBeDefined();

    expect((await requestState(db, request.requestId)).state).toBe("booked");

    const emails = await deliveriesOf(db, request.requestId);
    const requesterCopy = emails.find((email) => email.recipients[0] === request.contactEmail)!;
    const hostCopy = emails.find((email) => email.recipients[0] === request.calendarId)!;
    expect(emails.map((email) => email.kind)).toEqual(["booking_confirmation", "booking_confirmation"]);
    expect(requesterCopy.reply_to).toBe(request.calendarId);
    expect(requesterCopy.sender).toMatch(/^Ada Lovelace </);
    expect(hostCopy.reply_to).toBe(request.contactEmail);
    expect(hostCopy.parameters.viewUrl).toBe(`http://localhost:3000/app?request=${request.requestId}`);
    expect(JSON.stringify(hostCopy)).not.toContain(request.bookingId);

    const ics = Buffer.from(requesterCopy.attachments[0]!.content, "base64").toString("utf8");
    expect(ics).toContain(`UID:${eventIdFor(bookingId)}@google.com`);
    expect(ics).toContain("METHOD:REQUEST");

    const status = await readBookingStatus(db, request.requestId, "requester");
    expect(status?.receipt?.joinUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(status?.receipt?.calendarUrl).toBeNull();
    expect((await readBookingStatus(db, request.requestId, "host"))?.receipt?.calendarUrl).toMatch(/^https:\/\/www\.google\.com\//);
  });

  it("stops at revalidation when a busy event appeared, returning the request to negotiating", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    const start = new Date(request.start).toISOString();
    const end = new Date(request.end).toISOString();
    request.setCalendar({ events: { [request.calendarId]: [{ end: { dateTime: end }, id: "new-busy", start: { dateTime: start }, status: "confirmed" }] } });

    await runBooking(db, bookingDeps(db, google), bookingId);

    expect(await bookingOf(db, bookingId)).toMatchObject({ failure_category: "conflict", state: "failed" });
    expect((await requestState(db, request.requestId)).state).toBe("negotiating");
    expect(google.createdEvents(request.calendarId)).toHaveLength(0);
    const again = await approve(request, 1);
    expect(again.ok).toBe(false);
  });

  it("dispatches only one of two competing bookings for the same host", async () => {
    const first = await agreedRequest(db, google);
    const competing = await sameSlotRequest(first);
    const firstBooking = await approved(first);
    const secondBooking = await approved(competing);

    // The first dispatch counts as busy for the second, before and after the
    // event reaches the calendar.
    await db`update app.bookings set state = 'dispatching', dispatched_at = now(), payload = '{}'::jsonb where id = ${firstBooking}`;
    await runBooking(db, bookingDeps(db, google), secondBooking);
    expect(await bookingOf(db, secondBooking)).toMatchObject({ failure_category: "conflict", state: "failed" });

    await runBooking(db, bookingDeps(db, google), firstBooking).catch(() => null);
    expect(google.createdEvents(first.calendarId).length).toBeLessThanOrEqual(1);
  });

  it("reconciles a lost response by reading the event, never inserting twice", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ insertBehavior: { [request.calendarId]: "lost_after_create" } });

    expect(await runBooking(db, bookingDeps(db, google), bookingId)).toBe("failed");
    expect((await bookingOf(db, bookingId)).state).toBe("dispatching");
    expect((await readBookingStatus(db, request.requestId, "requester"))?.receipt).toBeNull();

    expect(await runBooking(db, bookingDeps(db, google), bookingId)).toBe("completed");
    expect((await bookingOf(db, bookingId)).state).toBe("confirmed");
    expect(google.createdEvents(request.calendarId)).toHaveLength(1);
    expect(google.requests.filter((entry) => entry.method === "POST" && entry.path.endsWith("/events"))).not.toHaveLength(0);
  });

  it("inserts the same frozen payload again when the first insert never arrived", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ insertBehavior: { [request.calendarId]: "lost_before_create" } });

    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(google.createdEvents(request.calendarId)).toHaveLength(0);

    request.setCalendar({});
    await runBooking(db, bookingDeps(db, google), bookingId);
    expect((await bookingOf(db, bookingId)).state).toBe("confirmed");
    expect(google.createdEvents(request.calendarId)).toHaveLength(1);
  });

  it("fails definitively on a refused write and lets the host retry by approving again", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ insertBehavior: { [request.calendarId]: { status: 403 } } });

    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(await bookingOf(db, bookingId)).toMatchObject({ failure_category: "calendar_rejected", state: "failed" });
    expect((await requestState(db, request.requestId)).state).toBe("awaiting_host_approval");

    request.setCalendar({});
    const retry = await approved(request);
    expect(retry).not.toBe(bookingId);
    await runBooking(db, bookingDeps(db, google), retry);
    expect((await bookingOf(db, retry)).state).toBe("confirmed");
  });

  it("records revoked Calendar access and creates no event", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ revoked: true });

    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(await bookingOf(db, bookingId)).toMatchObject({ failure_category: "calendar_access_revoked", state: "failed" });
    expect(google.createdEvents(request.calendarId)).toHaveLength(0);
  });

  it("does not book when revalidation cannot read the calendar", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ failingCalendars: [request.calendarId] });

    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(await bookingOf(db, bookingId)).toMatchObject({ failure_category: "revalidation_unavailable", state: "failed" });
    expect((await requestState(db, request.requestId)).state).toBe("awaiting_host_approval");
  });

  it("cancels a reserved booking whose request expired, and emails the requester", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    await db`update app.requests set expires_at = now() - interval '1 minute' where id = ${request.requestId}`;

    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(await bookingOf(db, bookingId)).toMatchObject({ failure_category: "expired", state: "cancelled" });
    expect((await requestState(db, request.requestId)).state).toBe("expired");
    expect((await deliveriesOf(db, request.requestId)).map((email) => email.kind)).toEqual(["status_expired"]);
  });

  it("marks a booking whose event the host deleted as removed", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ insertBehavior: { [request.calendarId]: "lost_after_create" } });
    await runBooking(db, bookingDeps(db, google), bookingId);
    google.cancelEvent(request.calendarId, eventIdFor(bookingId));

    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(await bookingOf(db, bookingId)).toMatchObject({ failure_category: "event_removed", state: "failed" });
  });
});

describe("withdrawal, decline and status", () => {
  it("lets the requester withdraw a reserved booking, and the job then creates nothing", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);

    const withdrawn = await asRequester(db, request.requestId, withdrawRequestCommand, {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(withdrawn.ok).toBe(true);
    expect(await bookingOf(db, bookingId)).toMatchObject({ failure_category: "withdrawn", state: "cancelled" });

    await runBooking(db, bookingDeps(db, google), bookingId);
    expect(google.createdEvents(request.calendarId)).toHaveLength(0);
    expect((await requestState(db, request.requestId)).state).toBe("withdrawn");
  });

  it("refuses withdrawal and decline once dispatch may have begun", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ insertBehavior: { [request.calendarId]: "lost_after_create" } });
    await runBooking(db, bookingDeps(db, google), bookingId);

    const revision = await revisionOf(db, request.requestId);
    const withdrawn = await asRequester(db, request.requestId, withdrawRequestCommand, {}, { expectedRevision: revision });
    expect(!withdrawn.ok && withdrawn.error.category).toBe("booking_pending");
    const declined = await asHost(db, request.hostAccountId, request.requestId, declineCommand(() => testNotices), {}, {
      expectedRevision: revision,
    });
    expect(!declined.ok && declined.error.category).toBe("booking_pending");
    expect((await requestState(db, request.requestId)).state).toBe("booking");
  });

  it("declines with the requester's status email", async () => {
    const request = await agreedRequest(db, google);
    const declined = await asHost(db, request.hostAccountId, request.requestId, declineCommand(() => testNotices), {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });

    expect(declined.ok).toBe(true);
    expect((await requestState(db, request.requestId)).state).toBe("declined");
    const [notice] = await deliveriesOf(db, request.requestId);
    expect(notice).toMatchObject({ kind: "status_declined", recipients: [request.contactEmail] });

    const late = await approve(request, 1);
    expect(!late.ok && late.error.category).toBe("request_closed");
  });

  it("sends the pending notice only while the booking is unconfirmed", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ insertBehavior: { [request.calendarId]: "lost_before_create" } });
    await runBooking(db, bookingDeps(db, google), bookingId);

    const [notice] = await db<{ id: string }[]>`
      select id from app.jobs where kind = ${BOOKING_PENDING_JOB} and payload ->> 'bookingId' = ${bookingId}
    `;
    await db`update app.jobs set run_after = now() where id = ${notice!.id}`;
    await runJob(db, notice!.id, createBookingPendingHandler(() => testNotices));

    const emails = await deliveriesOf(db, request.requestId);
    expect(emails.map((email) => email.kind)).toEqual(["status_pending"]);
    expect(emails[0]!.parameters.bookingId).toBe(bookingId);
  });

  it("starts another reconciliation from Check booking status after retries ran out", async () => {
    const request = await agreedRequest(db, google);
    const bookingId = await approved(request);
    request.setCalendar({ insertBehavior: { [request.calendarId]: "lost_before_create" } });
    const [job] = await bookingJobs(db, bookingId);
    await db`update app.jobs set max_attempts = 1 where id = ${job!.id}`;

    expect(await runBooking(db, bookingDeps(db, google), bookingId)).toBe("exhausted");
    expect((await bookingOf(db, bookingId)).state).toBe("dispatching");

    const checked = await asRequester(db, request.requestId, checkBookingCommand, {});
    expect(checked.ok && checked.result.reconciling).toBe(true);
    expect(checked.ok && checked.result.status?.state).toBe("dispatching");

    request.setCalendar({});
    await runBooking(db, bookingDeps(db, google), bookingId);
    expect((await bookingOf(db, bookingId)).state).toBe("confirmed");

    const other = await asHost(db, randomUUID(), request.requestId, checkBookingCommand, {});
    expect(!other.ok && other.error.category).toBe("forbidden");
  });
});

// A second agreed request for the same host and the same slot as `first`,
// copied from its records.
async function sameSlotRequest(first: AgreedRequest) {
  const bookingId = randomUUID();
  const [request] = await db<{ id: string }[]>`
    insert into app.requests (host_account_id, details, requester_name, contact_email, expires_at, state, revision)
    select host_account_id, details, 'Ada Byron', ${`ada-${randomUUID().slice(0, 8)}@example.test`},
           now() + interval '7 days', 'awaiting_host_approval', 2
    from app.requests where id = ${first.requestId}
    returning id
  `;
  const sealed = sealBookingLink(testTokenKey, request!.id, bookingId);
  await db`
    insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
    values (${request!.id}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;
  const [evaluation] = await db<{ id: string }[]>`
    insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at, candidates)
    select ${request!.id}, 1, settings_revision, 'completed', now(), candidates from app.evaluations
    where request_id = ${first.requestId} order by created_at desc limit 1
    returning id
  `;
  const [proposal] = await db<{ id: string }[]>`
    insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
    select ${request!.id}, 1, ${evaluation!.id}, candidate_id, start_at, end_at, details from app.proposals
    where request_id = ${first.requestId} and version = 1
    returning id
  `;
  await db`insert into app.agreements (proposal_id, request_revision, retry_key) values (${proposal!.id}, 1, 'copy')`;
  return { ...first, bookingId, requestId: request!.id };
}
