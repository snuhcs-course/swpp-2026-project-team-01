import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOKING_CANCEL_JOB, cancelBookingCommand, createBookingCancelHandler } from "../../lib/server/booking-cancellation";
import { approveCommand, type BookingDependencies, readBookingStatus } from "../../lib/server/bookings";
import { eventIdFor } from "../../lib/server/calendar-events";
import type { Database } from "../../lib/server/database";
import type { HostCalendar } from "../../lib/server/google-calendar";
import { agreedRequest, asHost, bookingDeps, bookingOf, deliveriesOf, requestState, runBooking } from "./support/booking";
import { runJob } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { testNotices } from "./support/requests";
import { asRequester, revisionOf } from "./support/scheduling";

// Cancelling a booked meeting (post-booking-changes): booking.cancel by either
// side, its refusals, the booking_cancel job against the fake Google Calendar,
// and the other side's notices. Every test seeds its own host and request.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

const cancel = cancelBookingCommand(() => testNotices);

async function booked() {
  const request = await agreedRequest(db, google);
  const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
    expectedRevision: await revisionOf(db, request.requestId),
  });
  if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
  expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");
  return { ...request, bookingId: approved.result.bookingId };
}

async function cancelJobs(database: Database, bookingId: string) {
  return database<{ id: string; state: string; attempts: number }[]>`
    select id, state, attempts from app.jobs where kind = ${BOOKING_CANCEL_JOB} and payload ->> 'bookingId' = ${bookingId}
  `;
}

async function runCancelJob(bookingId: string, deps: BookingDependencies = bookingDeps(db, google)) {
  const [job] = (await cancelJobs(db, bookingId)).filter((entry) => entry.state === "pending");
  if (!job) throw new Error("no pending cancel job");
  return runJob(db, job.id, createBookingCancelHandler(() => deps));
}

function calendarDeleting(outcome: Awaited<ReturnType<HostCalendar["deleteEvent"]>>): Partial<BookingDependencies> {
  return { openCalendar: async () => ({ deleteEvent: async () => outcome }) as unknown as HostCalendar };
}

describe("booking.cancel", () => {
  it("lets the requester cancel: the event is deleted and the host is emailed", async () => {
    const request = await booked();
    expect(google.createdEvents(request.calendarId)).toHaveLength(1);

    const outcome = await asRequester(db, request.requestId, cancel, {}, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(outcome.ok && outcome.result.state).toBe("cancelled");

    expect((await requestState(db, request.requestId)).state).toBe("cancelled");
    const booking = await bookingOf(db, request.bookingId);
    expect(booking).toMatchObject({ failure_category: "requester_cancelled", state: "cancelled" });
    // What was booked stays readable.
    expect(booking.evidence).not.toBeNull();
    expect((await readBookingStatus(db, request.requestId, "requester"))?.state).toBe("cancelled");

    const emails = await deliveriesOf(db, request.requestId);
    const notice = emails.find((email) => email.kind === "booking_cancelled");
    expect(notice).toMatchObject({ recipients: [request.calendarId], reply_to: request.contactEmail });
    expect(notice!.parameters.viewUrl).toBe(`http://localhost:3000/app?request=${request.requestId}`);
    expect(emails.some((email) => email.kind === "status_cancelled")).toBe(false);

    expect(await runCancelJob(request.bookingId)).toBe("completed");
    expect(google.createdEvents(request.calendarId)).toHaveLength(0);
    expect(google.requests.some((entry) => entry.method === "DELETE" && entry.path.endsWith(`/events/${eventIdFor(request.bookingId)}`))).toBe(true);
  });

  it("lets the host cancel and tells the requester", async () => {
    const request = await booked();
    const outcome = await asHost(db, request.hostAccountId, request.requestId, cancel, {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });

    expect(outcome.ok).toBe(true);
    expect((await bookingOf(db, request.bookingId)).failure_category).toBe("host_cancelled");
    const emails = await deliveriesOf(db, request.requestId);
    const notice = emails.find((email) => email.kind === "status_cancelled");
    expect(notice).toMatchObject({ recipients: [request.contactEmail] });
    expect(notice!.parameters.bookingId).toBe(request.bookingId);
    expect(emails.some((email) => email.kind === "booking_cancelled")).toBe(false);
  });

  it("refuses a second cancellation and returns the saved outcome to a replay", async () => {
    const request = await booked();
    const revision = await revisionOf(db, request.requestId);
    const first = await asRequester(db, request.requestId, cancel, {}, { expectedRevision: revision, retryKey: "same" });
    const replay = await asRequester(db, request.requestId, cancel, {}, { expectedRevision: revision, retryKey: "same" });
    const host = await asHost(db, request.hostAccountId, request.requestId, cancel, {}, { expectedRevision: revision + 1 });

    expect(first.ok && replay.ok).toBe(true);
    expect(!host.ok && host.error.category).toBe("request_closed");
    expect((await deliveriesOf(db, request.requestId)).filter((email) => email.kind === "booking_cancelled")).toHaveLength(1);
    expect(await cancelJobs(db, request.bookingId)).toHaveLength(1);
  });

  it("refuses a request that is not booked, another host, and a stale revision", async () => {
    const request = await agreedRequest(db, google);
    const notBooked = await asRequester(db, request.requestId, cancel, {}, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(!notBooked.ok && notBooked.error).toMatchObject({ category: "invalid_input", reason: "not_booked" });

    const done = await booked();
    const stranger = await asHost(db, request.hostAccountId, done.requestId, cancel, {}, { expectedRevision: await revisionOf(db, done.requestId) });
    expect(!stranger.ok && stranger.error.category).toBe("forbidden");
    const stale = await asRequester(db, done.requestId, cancel, {}, { expectedRevision: 1 });
    expect(!stale.ok && stale.error.category).toBe("stale_revision");
    expect((await requestState(db, done.requestId)).state).toBe("booked");
  });

  it("refuses once the meeting has started", async () => {
    const request = await booked();
    await db`
      update app.bookings set start_at = now() - interval '5 minutes', reserved_start = now() - interval '5 minutes'
      where id = ${request.bookingId}
    `;
    const outcome = await asHost(db, request.hostAccountId, request.requestId, cancel, {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });

    expect(!outcome.ok && outcome.error).toMatchObject({ category: "invalid_input", reason: "start_passed" });
    expect((await bookingOf(db, request.bookingId)).state).toBe("confirmed");
  });
});

describe("the booking_cancel job", () => {
  it("retries an uncertain deletion", async () => {
    const request = await booked();
    await asRequester(db, request.requestId, cancel, {}, { expectedRevision: await revisionOf(db, request.requestId) });

    expect(await runCancelJob(request.bookingId, bookingDeps(db, google, calendarDeleting({ httpStatus: 503, outcome: "uncertain" })))).not.toBe("completed");
    const [job] = await cancelJobs(db, request.bookingId);
    expect(job?.state).toBe("pending");
    expect((await requestState(db, request.requestId)).state).toBe("cancelled");
  });

  it("finishes when Google refuses, keeping the request cancelled", async () => {
    const request = await booked();
    await asHost(db, request.hostAccountId, request.requestId, cancel, {}, { expectedRevision: await revisionOf(db, request.requestId) });

    expect(await runCancelJob(request.bookingId, bookingDeps(db, google, calendarDeleting({ httpStatus: 403, outcome: "rejected" })))).toBe("completed");
    expect((await requestState(db, request.requestId)).state).toBe("cancelled");
    expect(google.createdEvents(request.calendarId)).toHaveLength(1);
  });
});
