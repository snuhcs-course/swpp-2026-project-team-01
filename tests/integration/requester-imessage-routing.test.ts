import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUESTER_IMESSAGE_OPERATIONS } from "../../lib/contracts/requester-imessage";
import { enqueueStatusNotice } from "../../lib/server/booking-notices";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import { HELP_TEXT, requestRef } from "../../lib/server/imessage-commands";
import { createImessageNoticeHandler, GUEST_NOTICE_TEXTS } from "../../lib/server/imessage-notice-job";
import { enqueueHostNotice, guestNoticeKey, IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { GUEST_TEXTS } from "../../lib/server/imessage-receipts";
import { imessageHash } from "../../lib/server/photon-receiver";
import {
  confirmRequesterImessageLinkCommand,
  createRequesterImessageLinkCommand,
  readRequesterImessageStatus,
  unlinkRequesterImessageCommand,
} from "../../lib/server/requester-imessage-links";
import { approveCommand } from "../../lib/server/bookings";
import { agreedRequest, asHost, bookingDeps, runBooking } from "./support/booking";
import { revisionOf } from "./support/scheduling";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";
import { newSender, TEST_LINE } from "./support/photon";
import { makeHostReady } from "./support/ready-host";
import { createTestRequest, jobFor, runJob, testNotices, testTokenKey } from "./support/requests";

// A guest's messages and notices in iMessage against the local stack and the
// Photon stand-in (guest-flow-completion task 4.4): a message follows the last
// message the line sent its sender, between two hosts' requests and between a
// host's own conversation and their guest request; `request <ref>` switches; a
// replayed receipt records one input; the guest's notices are frozen without the
// booking link, and the booking confirmation ends the binding, after which the
// booked request answers once; and an unlinked guest's text goes nowhere.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const options = { lineNumber: TEST_LINE, tokenKey: testTokenKey, tokenKeys: [testTokenKey] };
const commands: Readonly<Record<string, CommandDefinition<unknown, unknown>>> = Object.fromEntries(
  [createRequesterImessageLinkCommand(options), confirmRequesterImessageLinkCommand(options), unlinkRequesterImessageCommand].map(
    (command) => [command.operation, command as unknown as CommandDefinition<unknown, unknown>],
  ),
);
const noticeHandler = createImessageNoticeHandler(() => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] }));

let google: FakeGoogle;

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

function asGuest(requestId: string, operation: string, input: unknown = {}) {
  return runCommand({ authenticate: async () => ({ id: requestId, kind: "requester_request" }), db }, commands[operation]!, {
    input,
    resourceId: requestId,
    retryKey: randomUUID(),
  });
}

// Links the sender as the request's guest, as the card and the guest's message do.
async function linkGuest(sender: string, requestId: string) {
  expect((await asGuest(requestId, REQUESTER_IMESSAGE_OPERATIONS.create)).ok).toBe(true);
  const pending = await readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE);
  if (pending.state !== "pending") throw new Error("Expected a pending code.");
  await im.deliver({ sender, text: pending.message });
  const received = await readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE);
  if (received.state !== "received") throw new Error("Expected a received code.");
  expect((await asGuest(requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId })).ok).toBe(true);
}

// A request of a ready host named hostName, with the sender linked as its guest.
async function linkedGuest(sender: string, hostName = "Ada Lovelace", hostAccountId?: string) {
  const request = await createTestRequest(db, hostAccountId ? { hostAccountId } : {});
  if (!hostAccountId) await makeHostReady(db, request.hostAccountId, { displayName: hostName });
  await linkGuest(sender, request.requestId);
  return request;
}

async function guestInputs(requestId: string) {
  return db<{ id: string; message: string }[]>`
    select i.id, i.message from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'requester_request' and d.principal_id = ${requestId} and d.audience = 'requester'
    order by i.accepted_at
  `;
}

async function hostInputs(hostAccountId: string) {
  return (await im.inputsOf(hostAccountId)).map((input) => input.message);
}

// The sender's outbound messages so far, to compare with later.
async function outboxOf(sender: string) {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where recipient_hash = ${imessageHash(testTokenKey, "sender", sender)} order by created_at, id
  `;
  return new Set(rows.map((row) => row.id));
}

// The texts of the sender's queued messages recorded after `before`, sending them.
async function sentTo(sender: string, before: ReadonlySet<string>) {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox
    where recipient_hash = ${imessageHash(testTokenKey, "sender", sender)} and state = 'queued'
    order by created_at, id
  `;
  const texts: string[] = [];
  for (const row of rows.filter((entry) => !before.has(entry.id))) texts.push(...textOf((await im.send(row.id)).sent));
  return texts;
}

async function runGuestNotice(requestId: string, notice: Parameters<typeof guestNoticeKey>[1]) {
  const job = await jobFor(db, IMESSAGE_NOTICE_JOB, guestNoticeKey(requestId, notice));
  return runJob(db, job.id, noticeHandler);
}

describe("routing a guest's message", () => {
  it("forwards text into the request's requester discussion and sends the turn's reply", async () => {
    const sender = newSender();
    const request = await linkedGuest(sender);

    // Processed, then processed again as a rolled-back job would leave it.
    const receiptId = await im.store({ sender, text: "Can we do Tuesday instead?" });
    await im.processTwice(receiptId);
    const inputs = await guestInputs(request.requestId);
    expect(inputs).toHaveLength(1);
    const input = inputs[0];
    expect(input!.message).toBe("[iMessage] Can we do Tuesday instead?");

    const [reply] = await db<{ id: string; requester_binding_id: string | null; state: string }[]>`
      select id, requester_binding_id, state from app.imessage_outbox where kind = 'turn' and input_id = ${input!.id}
    `;
    expect(reply).toMatchObject({ state: "waiting" });
    expect(reply!.requester_binding_id).not.toBeNull();
    await im.endTurn(input!.id, `Sure. Pick Tuesday on the times card on your booking page ${request.bookingId}.`);
    const { sent } = await im.send(reply!.id);
    expect(textOf(sent)).toHaveLength(1);
    expect(textOf(sent)[0]).not.toContain(request.bookingId);
    expect(await guestInputs(request.requestId)).toHaveLength(1);
  });

  it("follows the last message the line sent between two hosts' requests, and switches with request <ref>", async () => {
    const sender = newSender();
    const first = await linkedGuest(sender, "Ada Lovelace");
    const second = await linkedGuest(sender, "Grace Hopper");

    // The second welcome is the last message: the second request.
    await im.deliver({ sender, text: "Hello there" });
    expect(await guestInputs(second.requestId)).toHaveLength(1);
    expect(await guestInputs(first.requestId)).toHaveLength(0);

    // A notice about the first request makes it the conversation.
    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, first.requestId, { kind: "status_declined" }).then(() => undefined));
    await db`update app.requests set state = 'declined', closed_at = now() where id = ${first.requestId}`;
    const since = await outboxOf(sender);
    await runGuestNotice(first.requestId, { kind: "status_declined" });
    expect(await sentTo(sender, since)).toEqual([GUEST_NOTICE_TEXTS.en.status_declined("Ada Lovelace")]);
    // The declined request's conversation continues as its revised request.
    expect((await im.deliver({ sender, text: "Why not?" })).outcome).toBe("forwarded");
    expect(await guestInputs(first.requestId)).toHaveLength(0);
    const [revised] = await db<{ id: string }[]>`select id from app.requests where revised_from_request_id = ${first.requestId}`;
    expect((await guestInputs(revised!.id)).map((input) => input.message)).toContain("[iMessage] Why not?");
    expect(await guestInputs(second.requestId)).toHaveLength(1);

    // request <ref> switches back to the second request.
    const switched = await outboxOf(sender);
    expect((await im.deliver({ sender, text: `request ${requestRef(second.requestId)}` })).outcome).toBe("command");
    expect(await sentTo(sender, switched)).toEqual([GUEST_TEXTS.switched("Grace Hopper")]);
    await im.deliver({ sender, text: "Back to this one" });
    expect((await guestInputs(second.requestId)).map((input) => input.message)).toContain("[iMessage] Back to this one");
  });

  it("keeps a host's commands and host notices on the host side for a host who is also a guest", async () => {
    const host = await hostWithUser(db);
    await makeHostReady(db, host.hostAccountId, { displayName: "Dana Scully" });
    const { sender } = await im.link(host.hostAccountId);
    const other = await createTestRequest(db);
    await makeHostReady(db, other.hostAccountId, { displayName: "Fox Mulder" });
    const guest = await linkedGuest(sender, "Fox Mulder", other.hostAccountId);

    // After the guest welcome, free text is the guest's.
    await im.deliver({ sender, text: "Is Friday possible?" });
    expect((await guestInputs(guest.requestId)).map((input) => input.message)).toEqual(["[iMessage] Is Friday possible?"]);
    expect(await hostInputs(host.hostAccountId)).toEqual([]);

    // An exact command is the host's.
    const since = await outboxOf(sender);
    expect((await im.deliver({ sender, text: "help" })).outcome).toBe("command");
    expect(await sentTo(sender, since)).toEqual([HELP_TEXT]);

    // After a host message, free text is the host's again.
    const own = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await db.begin((tx) => enqueueHostNotice(tx, own.requestId, { kind: "new_request" }));
    const job = await jobFor(db, IMESSAGE_NOTICE_JOB, `notice:new_request:${own.requestId}`);
    await runJob(db, job.id, noticeHandler);
    await im.deliver({ sender, text: "Thanks" });
    expect(await hostInputs(host.hostAccountId)).toEqual(["[iMessage] Thanks"]);
    expect(await guestInputs(guest.requestId)).toHaveLength(1);
  });
});

describe("a guest's notices", () => {
  it("freezes the expiry notice without the booking link", async () => {
    const sender = newSender();
    const request = await linkedGuest(sender, "Ada Lovelace");
    await db`update app.requests set state = 'expired', closed_at = now() where id = ${request.requestId}`;
    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, request.requestId, { kind: "status_expired" }).then(() => undefined));
    const since = await outboxOf(sender);
    await runGuestNotice(request.requestId, { kind: "status_expired" });
    const texts = await sentTo(sender, since);
    expect(texts).toEqual([GUEST_NOTICE_TEXTS.en.status_expired("Ada Lovelace")]);
    expect(texts.join("\n")).not.toContain(request.bookingId);
  });

  it("tells the guest the meeting is booked, ends the binding, and answers later messages once", async () => {
    const sender = newSender();
    const request = await agreedRequest(db, google);
    await linkGuest(sender, request.requestId);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");

    const since = await outboxOf(sender);
    await runGuestNotice(request.requestId, { bookingId: approved.result.bookingId, kind: "booking_confirmation" });
    const [text] = await sentTo(sender, since);
    expect(text).toMatch(/^Booked with Ada Lovelace: .+\. The invitation and details are in your email\.$/);
    expect(text).not.toContain(request.bookingId);
    const [binding] = await db<{ state: string }[]>`select state from app.requester_imessage_bindings where request_id = ${request.requestId}`;
    expect(binding!.state).toBe("ended");

    // A later message gets the closed notice, once.
    const closed = await outboxOf(sender);
    expect((await im.deliver({ sender, text: "When is it again?" })).outcome).toBe("replied");
    expect((await im.deliver({ sender, text: "Anyone?" })).outcome).toBe("ignored");
    expect(await sentTo(sender, closed)).toEqual([GUEST_TEXTS.closed]);
    expect(await guestInputs(request.requestId)).toHaveLength(0);
  });

  it("sends nothing to a guest who unlinked, and their text goes nowhere", async () => {
    const sender = newSender();
    const request = await linkedGuest(sender);
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.unlink)).ok).toBe(true);

    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, request.requestId, { kind: "status_declined" }).then(() => undefined));
    expect(await db`select 1 from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and dedupe_key = ${guestNoticeKey(request.requestId, { kind: "status_declined" })}`).toHaveLength(0);

    expect((await im.deliver({ sender, text: "Still there?" })).outcome).toBe("unlinked_reply");
    expect(await guestInputs(request.requestId)).toHaveLength(0);
  });
});
