import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUESTER_IMESSAGE_OPERATIONS } from "../../lib/contracts/requester-imessage";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import { withdrawRequestCommand } from "../../lib/server/request-lifecycle";
import { REQUESTER_LINK_TEXTS } from "../../lib/server/requester-imessage-bindings";
import {
  confirmRequesterImessageLinkCommand,
  createRequesterImessageLinkCommand,
  readRequesterImessageStatus,
  unlinkRequesterImessageCommand,
} from "../../lib/server/requester-imessage-links";
import { imessageHash } from "../../lib/server/photon-receiver";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { newSender, TEST_LINE } from "./support/photon";
import { createTestRequest, testTokenKey } from "./support/requests";

// Linking a guest's iMessage to one request against the local stack and the
// Photon stand-in (guest-flow-completion task 3.4): a code the booking page made
// binds only after the guest confirms the masked sender, with a welcome that
// carries no booking link; a code that ran out binds nothing; a forwarded code
// binds nothing until the holder of the booking link confirms, and confirms
// only the sender it shows; a host may also be a guest; unlinking ends the
// binding and suppresses what had not left; and a withdrawn request ends it.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const options = { lineNumber: TEST_LINE, tokenKey: testTokenKey, tokenKeys: [testTokenKey] };
const commands: Readonly<Record<string, CommandDefinition<unknown, unknown>>> = Object.fromEntries(
  [createRequesterImessageLinkCommand(options), confirmRequesterImessageLinkCommand(options), unlinkRequesterImessageCommand].map(
    (command) => [command.operation, command as unknown as CommandDefinition<unknown, unknown>],
  ),
);

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

function asGuest(requestId: string, operation: string, input: unknown = {}) {
  return runCommand({ authenticate: async () => ({ id: requestId, kind: "requester_request" }), db }, commands[operation]!, {
    input,
    resourceId: requestId,
    retryKey: randomUUID(),
  });
}

function status(requestId: string) {
  return readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE);
}

async function bindingOf(requestId: string) {
  const [row] = await db<{ id: string; state: string; sender_hash: string }[]>`
    select id, state, sender_hash from app.requester_imessage_bindings where request_id = ${requestId} order by created_at desc limit 1
  `;
  return row ?? null;
}

async function pendingCode(requestId: string) {
  expect((await asGuest(requestId, REQUESTER_IMESSAGE_OPERATIONS.create)).ok).toBe(true);
  const pending = await status(requestId);
  if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
  return pending;
}

async function linkedGuest(sender: string = newSender()) {
  const request = await createTestRequest(db);
  const pending = await pendingCode(request.requestId);
  await im.deliver({ sender, text: pending.message });
  const received = await status(request.requestId);
  if (received.state !== "received") throw new Error(`Expected a received code, got ${received.state}.`);
  expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId })).ok).toBe(true);
  return { ...request, sender };
}

describe("linking a guest's iMessage", () => {
  it("shows the code and the guest message, records the arriving sender, and binds only after confirmation", async () => {
    const request = await createTestRequest(db);
    const sender = newSender();
    const pending = await pendingCode(request.requestId);
    expect(pending).toMatchObject({ lineNumber: TEST_LINE, message: `Get Find Me a Time updates: ${pending.code}` });

    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
    const received = await status(request.requestId);
    expect(received).toMatchObject({ sender: `•••• ${sender.slice(-4)}`, state: "received" });
    expect(await bindingOf(request.requestId)).toBeNull();

    const senderHash = imessageHash(testTokenKey, "sender", sender);
    const [ack] = await im.outbox({ kind: "link_received", recipientHash: senderHash });
    expect(textOf((await im.send(ack!.id)).sent)).toEqual([REQUESTER_LINK_TEXTS.received]);

    if (received.state !== "received") throw new Error("Expected a received code.");
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId })).ok).toBe(true);
    expect(await bindingOf(request.requestId)).toMatchObject({ sender_hash: senderHash, state: "active" });
    expect(await status(request.requestId)).toMatchObject({ sender: `•••• ${sender.slice(-4)}`, state: "linked" });

    // The welcome is a reply in that conversation and names no booking link.
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: senderHash });
    const { sent } = await im.send(welcome!.id);
    expect(textOf(sent)).toEqual([REQUESTER_LINK_TEXTS.linked("your host")]);
    expect(sent[0]!.recipient).toEqual({ address: sender, spaceId: `any;-;${sender}` });
    expect(textOf(sent)[0]).not.toContain(request.bookingId);
  });

  it("binds nothing for a code that ran out or was never confirmed", async () => {
    const request = await createTestRequest(db);
    const expired = await pendingCode(request.requestId);
    await db`update app.imessage_links set expires_at = now() - interval '1 second' where request_id = ${request.requestId} and state = 'pending'`;
    expect((await im.deliver({ sender: newSender(), text: expired.message })).outcome).toBe("link_refused");
    expect(await status(request.requestId)).toMatchObject({ state: "none" });

    const unconfirmed = await pendingCode(request.requestId);
    await im.deliver({ sender: newSender(), text: unconfirmed.message });
    await db`update app.imessage_links set confirm_by = now() - interval '1 second' where request_id = ${request.requestId} and state = 'received'`;
    expect(await status(request.requestId)).toMatchObject({ state: "none" });
    const [link] = await db<{ id: string }[]>`select id from app.imessage_links where request_id = ${request.requestId} and state = 'received'`;
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: link!.id })).ok).toBe(false);
    expect(await bindingOf(request.requestId)).toBeNull();
  });

  it("binds a forwarded code to nobody but the sender the booking page shows, and only for that request", async () => {
    const request = await createTestRequest(db);
    const other = await createTestRequest(db);
    const pending = await pendingCode(request.requestId);
    // Someone the code was forwarded to sends it first.
    const stranger = newSender();
    await im.deliver({ sender: stranger, text: pending.message });
    const received = await status(request.requestId);
    expect(received).toMatchObject({ sender: `•••• ${stranger.slice(-4)}`, state: "received" });
    if (received.state !== "received") throw new Error("Expected a received code.");

    // Another request's booking link cannot confirm it.
    expect((await asGuest(other.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId })).ok).toBe(false);
    expect(await bindingOf(other.requestId)).toBeNull();
    expect(await bindingOf(request.requestId)).toBeNull();
  });

  it("lets a linked host link the same number as a guest, and a sender hold several requests", async () => {
    const hostAccountId = (await createTestRequest(db)).hostAccountId;
    const { sender } = await im.link(hostAccountId);
    const first = await linkedGuest(sender);
    const second = await linkedGuest(sender);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ state: "active" });
    expect(await bindingOf(first.requestId)).toMatchObject({ state: "active" });
    expect(await bindingOf(second.requestId)).toMatchObject({ state: "active" });
  });

  it("refuses a sixth code in an hour", async () => {
    const request = await createTestRequest(db);
    for (let index = 0; index < 5; index += 1) expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create)).ok).toBe(true);
    const sixth = await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create);
    expect(sixth.ok ? null : sixth.error.category).toBe("rate_limited");
  });
});

describe("ending a guest binding", () => {
  it("unlinks in the database only and suppresses the guest's messages that had not left", async () => {
    const guest = await linkedGuest();
    const senderHash = imessageHash(testTokenKey, "sender", guest.sender);
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: senderHash });
    expect(welcome!.state).toBe("queued");

    expect(await asGuest(guest.requestId, REQUESTER_IMESSAGE_OPERATIONS.unlink)).toMatchObject({ ok: true, result: { unlinked: true } });
    expect(await bindingOf(guest.requestId)).toMatchObject({ state: "unlinked" });
    expect(await status(guest.requestId)).toMatchObject({ state: "none" });
    expect((await im.outbox({ kind: "linked", recipientHash: senderHash }))[0]!.state).toBe("suppressed");
    expect((await im.send(welcome!.id)).sent).toEqual([]);
  });

  it("ends the binding when the request is withdrawn, still sending what was queued", async () => {
    const guest = await linkedGuest();
    const [request] = await db<{ revision: number }[]>`select revision from app.requests where id = ${guest.requestId}`;
    const withdrawn = await runCommand(
      { authenticate: async () => ({ id: guest.requestId, kind: "requester_request" }), db },
      withdrawRequestCommand as unknown as CommandDefinition<unknown, unknown>,
      { expectedRevision: request!.revision, input: {}, resourceId: guest.requestId, retryKey: randomUUID() },
    );
    expect(withdrawn.ok).toBe(true);
    expect(await bindingOf(guest.requestId)).toMatchObject({ state: "ended" });

    const [welcome] = await im.outbox({ kind: "linked", recipientHash: imessageHash(testTokenKey, "sender", guest.sender) });
    expect(textOf((await im.send(welcome!.id)).sent)).toHaveLength(1);
  });
});
