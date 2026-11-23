import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelBookingCommand, changeBookingCommand } from "../../lib/server/booking-cancellation";
import { approveCommand, declineCommand, readBookingStatus } from "../../lib/server/bookings";
import { createRequestExpiryHandler, withdrawRequestCommand } from "../../lib/server/request-lifecycle";
import { readRequesterView } from "../../lib/server/requester-routes";
import { agreeCommand, chooseCandidateCommand, evaluateCommand, readCurrentEvaluation } from "../../lib/server/request-proposals";
import { type AgreedRequest, agreedRequest, asHost, bookingDeps, bookingOf, deliveriesOf, requestState, runBooking } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { testNotices } from "./support/requests";
import { asRequester, evaluationDeps, revisionOf, runEvaluation } from "./support/scheduling";

// Changing a booked meeting (post-booking-changes design 5): booking.change
// reopens it while the confirmed booking stands, the usual evaluation, choice,
// agreement and approval follow, and the booking job patches the same Google
// event; withdrawal, decline and expiry leave the meeting as it was, and a
// cancellation during the change cancels the meeting.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

type Booked = AgreedRequest & { readonly bookingId: string };

async function booked(): Promise<Booked> {
  const request = await agreedRequest(db, google);
  const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
    expectedRevision: await revisionOf(db, request.requestId),
  });
  if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
  expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");
  return { ...request, bookingId: approved.result.bookingId };
}

async function reopen(request: Booked, as: "host" | "requester" = "requester") {
  const options = { expectedRevision: await revisionOf(db, request.requestId) };
  const outcome =
    as === "host"
      ? await asHost(db, request.hostAccountId, request.requestId, changeBookingCommand, {}, options)
      : await asRequester(db, request.requestId, changeBookingCommand, {}, options);
  if (!outcome.ok) throw new Error(`change failed: ${outcome.error.category}`);
  return outcome.result;
}

// Finds times again and agrees to one that differs from the booked time.
async function agreeToAnotherTime(request: Booked) {
  const evaluated = await asRequester(db, request.requestId, evaluateCommand, {});
  if (!evaluated.ok) throw new Error(`evaluate failed: ${evaluated.error.category}`);
  await runEvaluation(db, evaluationDeps(db, google), evaluated.result.evaluationId);
  const view = await readCurrentEvaluation(db, request.requestId);
  const candidate = view?.candidates.find((entry) => entry.start !== request.start);
  if (!view || !candidate) throw new Error("no other candidate");

  const revision = await revisionOf(db, request.requestId);
  const chosen = await asRequester(db, request.requestId, chooseCandidateCommand, { candidateId: candidate.id, evaluationId: view.id }, { expectedRevision: revision });
  if (!chosen.ok || chosen.result.outcome !== "proposed") throw new Error("choose failed");
  const agreed = await asRequester(db, request.requestId, agreeCommand(() => evaluationDeps(db, google)), { version: chosen.result.version }, { expectedRevision: revision });
  if (!agreed.ok) throw new Error(`agree failed: ${agreed.error.category}`);
  return { candidate, version: chosen.result.version, view };
}

describe("booking.change", () => {
  it("reopens a booked meeting that keeps standing, and offers its own time again", async () => {
    const request = await booked();
    const reopened = await reopen(request);

    expect(reopened.state).toBe("negotiating");
    expect(Date.parse(reopened.expiresAt)).toBeLessThanOrEqual(Date.parse(request.start));
    expect((await bookingOf(db, request.bookingId)).state).toBe("confirmed");
    expect((await readBookingStatus(db, request.requestId, "requester"))?.state).toBe("confirmed");

    // The meeting's own event is not busy time for its own change.
    const evaluated = await asRequester(db, request.requestId, evaluateCommand, {});
    if (!evaluated.ok) throw new Error("evaluate failed");
    await runEvaluation(db, evaluationDeps(db, google), evaluated.result.evaluationId);
    const view = await readCurrentEvaluation(db, request.requestId);
    expect(view?.candidates.some((entry) => entry.start === request.start)).toBe(true);
  });

  it("patches the same event on approval and cancels the replaced booking", async () => {
    const request = await booked();
    await reopen(request, "host");
    const { candidate, version } = await agreeToAnotherTime(request);

    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    // The original stands while the change is booked.
    expect((await bookingOf(db, request.bookingId)).state).toBe("confirmed");
    expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");

    expect((await requestState(db, request.requestId)).state).toBe("booked");
    const change = await bookingOf(db, approved.result.bookingId);
    expect(change.state).toBe("confirmed");
    expect(change.event_id).toBe((await bookingOf(db, request.bookingId)).event_id);
    expect(await bookingOf(db, request.bookingId)).toMatchObject({ failure_category: "changed", state: "cancelled" });

    const events = google.createdEvents(request.calendarId);
    expect(events).toHaveLength(1);
    expect(Date.parse(events[0]!.start.dateTime!)).toBe(Date.parse(candidate.start));
    expect(events[0]!.attendees).toEqual([{ displayName: "Grace Hopper", email: request.contactEmail }]);

    const changed = (await deliveriesOf(db, request.requestId)).filter((email) => email.kind === "booking_confirmation" && email.parameters.changed === true);
    expect(changed).toHaveLength(2);
    expect(changed.every((email) => email.attachments.length === 0)).toBe(true);
    expect((await readBookingStatus(db, request.requestId, "requester"))?.receipt?.start).toBe(new Date(candidate.start).toISOString());
  });

  it("removes the Meet when an approved change moves the meeting to the guest's own link", async () => {
    const request = await booked();
    expect(google.createdEvents(request.calendarId)[0]!.hangoutLink).toBeDefined();
    await reopen(request);
    const { version } = await agreeToAnotherTime(request);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    // The agreed version moves to the guest's own link before the booking job
    // freezes its payload, as a change of meeting type would.
    const guestLink = "https://zoom.example/j/1";
    await db`
      update app.proposals
      set details = details || ${db.json({ linkPlan: { kind: "requester_link", url: guestLink } } as never)}
      where id = (select proposal_id from app.bookings where id = ${approved.result.bookingId})
    `;
    expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");

    const [event] = google.createdEvents(request.calendarId);
    expect(event!.hangoutLink).toBeUndefined();
    expect(event!.location).toBe(guestLink);

    const changed = (await deliveriesOf(db, request.requestId)).filter((email) => email.kind === "booking_confirmation" && email.parameters.changed === true);
    expect(changed.map((email) => email.parameters.joinUrl)).toEqual([guestLink, guestLink]);
    expect((await readBookingStatus(db, request.requestId, "requester"))?.receipt?.joinUrl).toBe(guestLink);
  });

  it("names the side that reopened the booked meeting on the guest's page (#321)", async () => {
    const byHost = await booked();
    await reopen(byHost, "host");
    expect(await readRequesterView(db, byHost.requestId)).toMatchObject({ reopenedBy: "host" });
    // The guest's Change while it is already open changes nothing, nor who reopened it.
    await reopen(byHost);
    expect(await readRequesterView(db, byHost.requestId)).toMatchObject({ reopenedBy: "host" });

    const byGuest = await booked();
    await reopen(byGuest);
    expect(await readRequesterView(db, byGuest.requestId)).toMatchObject({ reopenedBy: "requester" });
  });

  it("refuses a request that is not booked, and a meeting that has started", async () => {
    const open = await agreedRequest(db, google);
    const notBooked = await asRequester(db, open.requestId, changeBookingCommand, {}, { expectedRevision: await revisionOf(db, open.requestId) });
    expect(!notBooked.ok && notBooked.error).toMatchObject({ category: "invalid_input", reason: "not_booked" });

    const request = await booked();
    await db`update app.bookings set start_at = now() - interval '1 minute', reserved_start = now() - interval '1 minute' where id = ${request.bookingId}`;
    const started = await asRequester(db, request.requestId, changeBookingCommand, {}, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(!started.ok && started.error).toMatchObject({ category: "invalid_input", reason: "start_passed" });
  });
});

describe("leaving a change", () => {
  it("keeps the booked meeting when the requester withdraws the change", async () => {
    const request = await booked();
    await reopen(request);
    const withdrawn = await asRequester(db, request.requestId, withdrawRequestCommand, {}, { expectedRevision: await revisionOf(db, request.requestId) });

    expect(withdrawn.ok && withdrawn.result.state).toBe("booked");
    expect((await requestState(db, request.requestId)).state).toBe("booked");
    expect((await bookingOf(db, request.bookingId)).state).toBe("confirmed");
  });

  it("keeps the booked meeting when the host declines the change, and tells the requester", async () => {
    const request = await booked();
    await reopen(request);
    await agreeToAnotherTime(request);
    const declined = await asHost(db, request.hostAccountId, request.requestId, declineCommand(() => testNotices), {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });

    expect(declined.ok && declined.result.state).toBe("booked");
    expect((await bookingOf(db, request.bookingId)).state).toBe("confirmed");
    const notice = (await deliveriesOf(db, request.requestId)).find((email) => email.kind === "status_change_dropped");
    expect(notice).toMatchObject({ recipients: [request.contactEmail] });
    expect(notice!.parameters).toMatchObject({ bookingId: request.bookingId, reason: "declined" });
  });

  it("keeps the booked meeting when the change expires", async () => {
    const request = await booked();
    await reopen(request);
    await db`update app.requests set expires_at = now() - interval '1 second' where id = ${request.requestId}`;
    await db.begin((tx) =>
      createRequestExpiryHandler(() => testNotices)(tx, { attempts: 1, fence: 1, id: randomUUID(), kind: "request_expiry", maxAttempts: 1, payload: {} }),
    );

    expect((await requestState(db, request.requestId)).state).toBe("booked");
    expect((await bookingOf(db, request.bookingId)).state).toBe("confirmed");
    const notice = (await deliveriesOf(db, request.requestId)).find((email) => email.kind === "status_change_dropped");
    expect(notice?.parameters.reason).toBe("expired");
  });

  it("cancels the meeting itself, and the change reserved for it, when cancelled during a change", async () => {
    const request = await booked();
    await reopen(request);
    const { version } = await agreeToAnotherTime(request);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error("approve failed");

    const cancelled = await asRequester(db, request.requestId, cancelBookingCommand(() => testNotices), {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(cancelled.ok).toBe(true);
    expect((await requestState(db, request.requestId)).state).toBe("cancelled");
    expect(await bookingOf(db, request.bookingId)).toMatchObject({ failure_category: "requester_cancelled", state: "cancelled" });
    expect((await bookingOf(db, approved.result.bookingId)).state).toBe("cancelled");
  });
});
