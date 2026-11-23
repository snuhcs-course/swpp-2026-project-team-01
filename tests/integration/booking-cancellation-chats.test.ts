import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOKING_CANCEL_JOB, cancelBookingCommand, createBookingCancelHandler } from "../../lib/server/booking-cancellation";
import { approveCommand, type BookingDependencies } from "../../lib/server/bookings";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import type { HostCalendar } from "../../lib/server/google-calendar";
import { requestRef } from "../../lib/server/imessage-commands";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { guestNoticeKey, IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { imessageHash } from "../../lib/server/photon-receiver";
import { createRequesterImessageLinkCommand, readRequesterImessageStatus } from "../../lib/server/requester-imessage-links";
import { agreedRequest, asHost, bookingDeps, runBooking } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { newSender, TEST_LINE } from "./support/photon";
import { jobFor, runJob, testNotices, testTokenKey } from "./support/requests";
import { asRequester, revisionOf } from "./support/scheduling";

// The linked-chat texts of a cancelled meeting (post-booking-changes task, step
// 1): with an active binding, the guest's status_cancelled when the host
// cancels, the host's booking_cancelled when the guest cancels, and the host's
// booking_event_left when Google refuses to delete the event. Every test seeds
// its own host and request; the guest here is Grace Hopper and the host Ada
// Lovelace, as the booking support seeds them.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
const im = imessageHarness(db, () => photon);
const linkCommand = createRequesterImessageLinkCommand({ lineNumber: TEST_LINE, registrar: im.registrar, tokenKey: testTokenKey, tokenKeys: [testTokenKey] });
const cancel = cancelBookingCommand(() => testNotices);
const noticeDeps = () => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] });

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

// Links the sender as the request's guest, as the card and the guest's message do.
async function linkGuest(sender: string, requestId: string) {
  const created = await runCommand(
    { authenticate: async () => ({ id: requestId, kind: "requester_request" }), db },
    linkCommand as unknown as CommandDefinition<unknown, unknown>,
    { input: { number: "+15557654321" }, resourceId: requestId, retryKey: randomUUID() },
  );
  expect(created.ok).toBe(true);
  const pending = await readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE);
  if (pending.state !== "pending") throw new Error("Expected a pending code.");
  expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
}

// A booked request; the host's chat is linked before the guest agrees when
// `hostChat`, and the guest's after.
async function bookedWith(chats: { readonly hostChat?: boolean; readonly guestSender?: string }) {
  const request = await agreedRequest(db, google, {
    beforeAgree: async (seeded) => {
      if (chats.hostChat) await im.link(seeded.hostAccountId);
    },
  });
  if (chats.guestSender) await linkGuest(chats.guestSender, request.requestId);
  const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
    expectedRevision: await revisionOf(db, request.requestId),
  });
  if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
  expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");
  return { ...request, approvedBookingId: approved.result.bookingId };
}

// Runs the request's pending notice jobs, then sends what the host's chat queued.
async function hostTexts(hostAccountId: string, requestId: string) {
  const jobs = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and state = 'pending' and payload ->> 'requestId' = ${requestId}
    order by created_at
  `;
  for (const job of jobs) await runJob(db, job.id, createImessageNoticeHandler(noticeDeps));
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'notice' and state = 'queued' order by created_at
  `;
  const texts: string[] = [];
  for (const row of rows) texts.push(...textOf((await im.send(row.id)).sent));
  return texts;
}

// The IDs of the guest's outbox rows so far.
async function guestOutbox(sender: string) {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where recipient_hash = ${imessageHash(testTokenKey, "sender", sender)} order by created_at, id
  `;
  return new Set(rows.map((row) => row.id));
}

// The guest's queued messages recorded after `before`, sent.
async function guestTexts(sender: string, before: ReadonlySet<string>) {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox
    where recipient_hash = ${imessageHash(testTokenKey, "sender", sender)} and state = 'queued'
    order by created_at, id
  `;
  const texts: string[] = [];
  for (const row of rows.filter((entry) => !before.has(entry.id))) texts.push(...textOf((await im.send(row.id)).sent));
  return texts;
}

function calendarRefusingDelete(): Partial<BookingDependencies> {
  return { openCalendar: async () => ({ deleteEvent: async () => ({ httpStatus: 403, outcome: "rejected" }) }) as unknown as HostCalendar };
}

async function runCancelJob(bookingId: string, deps: BookingDependencies) {
  const [job] = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${BOOKING_CANCEL_JOB} and state = 'pending' and payload ->> 'bookingId' = ${bookingId}
  `;
  if (!job) throw new Error("no pending cancel job");
  return runJob(db, job.id, createBookingCancelHandler(() => deps));
}

describe("a cancelled meeting in the linked chats", () => {
  it("tells the linked guest when the host cancels, without the booking link", async () => {
    const sender = newSender();
    const request = await bookedWith({ guestSender: sender });
    const since = await guestOutbox(sender);

    const outcome = await asHost(db, request.hostAccountId, request.requestId, cancel, {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(outcome.ok).toBe(true);
    const job = await jobFor(db, IMESSAGE_NOTICE_JOB, guestNoticeKey(request.requestId, { bookingId: request.approvedBookingId, kind: "status_cancelled" }));
    await runJob(db, job.id, createImessageNoticeHandler(noticeDeps));

    const texts = await guestTexts(sender, since);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(
      /^Ada Lovelace cancelled your meeting \(.+\)\. The calendar invitation is cancelled too\. Write here if you'd like to ask for a new time\.$/,
    );
    // request.bookingId is the seeded booking-link secret.
    expect(texts[0]).not.toContain(request.bookingId);
    expect(texts[0]).not.toContain("/booking/");
  });

  it("tells the linked host when the guest cancels, and nothing to the guest who cancelled", async () => {
    const sender = newSender();
    const request = await bookedWith({ guestSender: sender, hostChat: true });
    // The approval summary and the booking confirmation went first.
    await hostTexts(request.hostAccountId, request.requestId);
    const since = await guestOutbox(sender);

    const outcome = await asRequester(db, request.requestId, cancel, {}, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(outcome.ok).toBe(true);

    expect(await hostTexts(request.hostAccountId, request.requestId)).toEqual([
      expect.stringMatching(/^Grace Hopper cancelled your meeting \(.+\)\. It's being removed from your calendar\.$/),
    ]);
    expect(await guestTexts(sender, since)).toEqual([]);
  });

  it("tells the linked host to delete an event Google would not remove", async () => {
    const request = await bookedWith({ hostChat: true });
    await hostTexts(request.hostAccountId, request.requestId);

    const outcome = await asHost(db, request.hostAccountId, request.requestId, cancel, {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(outcome.ok).toBe(true);
    // The host cancelled, so nothing is sent to the host's chat for the cancellation itself.
    expect(await hostTexts(request.hostAccountId, request.requestId)).toEqual([]);

    expect(await runCancelJob(request.approvedBookingId, bookingDeps(db, google, calendarRefusingDelete()))).toBe("completed");
    const texts = await hostTexts(request.hostAccountId, request.requestId);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(`The meeting for request ${requestRef(request.requestId)} (`);
    expect(texts[0]).toContain("is cancelled, but its event couldn't be removed from Google Calendar. Please delete it there yourself: ");
    expect(texts[0]).toContain("http://localhost:3000/app?request=");
  });
});
