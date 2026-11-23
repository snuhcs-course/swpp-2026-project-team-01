import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUESTER_IMESSAGE_OPERATIONS } from "../../lib/contracts/requester-imessage";
import { enqueueStatusNotice } from "../../lib/server/booking-notices";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import { hashLinkCode } from "../../lib/server/email-links";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { guestNoticeKey, IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { withdrawRequestCommand } from "../../lib/server/request-lifecycle";
import { REQUESTER_LINK_TEXTS } from "../../lib/server/requester-imessage-bindings";
import {
  createRequesterImessageLinkCommand,
  emailOnlyRequesterCommand,
  readRequesterImessageStatus,
  shareRequesterContactCardCommand,
  unlinkRequesterImessageCommand,
} from "../../lib/server/requester-imessage-links";
import { channelHash, imessageHash } from "../../lib/server/photon-receiver";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { newSender, newWhatsAppSender, TEST_LINE, TEST_WHATSAPP_NUMBER } from "./support/photon";
import { makeHostReady } from "./support/ready-host";
import { createTestRequest, jobFor, runJob, testNotices, testTokenKey } from "./support/requests";

// Linking a guest's iMessage to one request against the local stack and the
// Photon stand-in (guest-flow-completion task 3.4): a code the booking page made
// binds its sender as soon as it arrives (link-on-code D1), with a welcome that
// carries no booking link; a code that ran out, or arrives for a closed request,
// binds nothing; a forwarded code links whoever sends it first, only to its own
// request, and the guest unlinks it; a host may also be a guest; unlinking ends
// the binding and suppresses what had not left; and a withdrawn request keeps it.
// WhatsApp links the same way (guest-whatsapp-link tasks 2.1 and 2.2): the
// number is registered without keeping Photon's assigned number, the code is
// addressed to the WhatsApp number, the binding records its channel, the
// guest's text reaches the discussion marked [WhatsApp], and a notice goes out
// on WhatsApp inside the 24-hour window and is suppressed outside it, with no
// template.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const options = { lineNumber: TEST_LINE, registrar: im.registrar, tokenKey: testTokenKey, tokenKeys: [testTokenKey], whatsappNumber: TEST_WHATSAPP_NUMBER };
const commands: Readonly<Record<string, CommandDefinition<unknown, unknown>>> = Object.fromEntries(
  [createRequesterImessageLinkCommand(options), unlinkRequesterImessageCommand, emailOnlyRequesterCommand, shareRequesterContactCardCommand(options)].map(
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
  return readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE, TEST_WHATSAPP_NUMBER);
}

async function bindingOf(requestId: string) {
  const [row] = await db<{ id: string; state: string; sender_hash: string }[]>`
    select id, state, sender_hash from app.requester_imessage_bindings where request_id = ${requestId} order by created_at desc limit 1
  `;
  return row ?? null;
}

async function pendingCode(requestId: string) {
  expect((await asGuest(requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { number: "+15557654321" })).ok).toBe(true);
  const pending = await status(requestId);
  if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
  return pending;
}

async function linkedGuest(sender: string = newSender()) {
  const request = await createTestRequest(db);
  const pending = await pendingCode(request.requestId);
  expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
  const linked = await status(request.requestId);
  if (linked.state !== "linked") throw new Error(`Expected a linked sender, got ${linked.state}.`);
  return { ...request, sender };
}

describe("linking a guest's iMessage", () => {
  it("registers the guest's number first and addresses the code to the number Photon assigned", async () => {
    const request = await createTestRequest(db);
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create)).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    const number = newSender();
    photon.nextRegistration({ lineNumber: "+15550009999" });
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { number })).ok).toBe(true);
    expect(photon.registered.at(-1)).toBe(number);
    expect(await status(request.requestId)).toMatchObject({ lineNumber: "+15550009999", state: "pending" });
  });

  it("sends a contact card only to the linked guest and prevents duplicate queued sends", async () => {
    const guest = await linkedGuest();
    expect((await asGuest(guest.requestId, REQUESTER_IMESSAGE_OPERATIONS.shareContactCard)).ok).toBe(true);
    expect(await asGuest(guest.requestId, REQUESTER_IMESSAGE_OPERATIONS.shareContactCard)).toMatchObject({ error: { category: "rate_limited" } });
    expect(await status(guest.requestId)).toMatchObject({ contactCard: { state: "queued" } });
    const binding = await bindingOf(guest.requestId);
    const [card] = await db<{ id: string }[]>`select id from app.imessage_outbox where requester_binding_id = ${binding!.id} and kind = 'contact_card'`;
    const { sent } = await im.send(card!.id);
    expect(textOf(sent)).toEqual(["[contact_card]"]);
    expect(sent[0]!.recipient.address).toBe(guest.sender);
    expect(await status(guest.requestId)).toMatchObject({ contactCard: { state: "sent" } });
    const other = await createTestRequest(db);
    expect(await asGuest(other.requestId, REQUESTER_IMESSAGE_OPERATIONS.shareContactCard)).toMatchObject({ error: { category: "invalid_input" } });
  });

  it("still lets a linked guest share a contact card and unlink after the request closes", async () => {
    const guest = await linkedGuest();
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${guest.requestId}`;
    expect((await asGuest(guest.requestId, REQUESTER_IMESSAGE_OPERATIONS.shareContactCard)).ok).toBe(true);
    expect((await asGuest(guest.requestId, REQUESTER_IMESSAGE_OPERATIONS.unlink)).ok).toBe(true);
    expect(await status(guest.requestId)).toMatchObject({ state: "none" });
  });
  it("shows the code and the guest message, and binds the arriving sender at once", async () => {
    const request = await createTestRequest(db);
    const sender = newSender();
    const pending = await pendingCode(request.requestId);
    expect(pending).toMatchObject({ lineNumber: TEST_LINE, message: `Get Find Me a Time updates: ${pending.code}` });

    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
    const senderHash = imessageHash(testTokenKey, "sender", sender);
    expect(await bindingOf(request.requestId)).toMatchObject({ sender_hash: senderHash, state: "active" });
    // The card shows the number by its last four digits (link-on-code D4).
    expect(await status(request.requestId)).toMatchObject({ sender: `•••• ${sender.slice(-4)}`, state: "linked" });
    const [attempt] = await db<{ state: string }[]>`select state from app.imessage_links where request_id = ${request.requestId}`;
    expect(attempt!.state).toBe("linked");
    // No "go back to your booking page" reply: the welcome is the only message.
    expect(await im.outbox({ kind: "link_received", recipientHash: senderHash })).toHaveLength(0);

    // The welcome is a reply in that conversation and names no booking link.
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: senderHash });
    const { sent } = await im.send(welcome!.id);
    expect(textOf(sent)).toEqual([REQUESTER_LINK_TEXTS.linked("your host")]);
    expect(sent[0]!.recipient).toEqual({ address: sender, spaceId: `any;-;${sender}` });
    expect(textOf(sent)[0]).not.toContain(request.bookingId);
  });

  it("binds nothing for a code that ran out, or that arrives once the request closed", async () => {
    const request = await createTestRequest(db);
    const expired = await pendingCode(request.requestId);
    await db`update app.imessage_links set expires_at = now() - interval '1 second' where request_id = ${request.requestId} and state = 'pending'`;
    expect((await im.deliver({ sender: newSender(), text: expired.message })).outcome).toBe("link_refused");
    expect(await status(request.requestId)).toMatchObject({ state: "none" });

    const closed = await pendingCode(request.requestId);
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${request.requestId}`;
    expect((await im.deliver({ sender: newSender(), text: closed.message })).outcome).toBe("link_refused");
    expect(await bindingOf(request.requestId)).toBeNull();
    const [attempt] = await db<{ state: string }[]>`select state from app.imessage_links where code_hash = ${hashLinkCode(closed.code)}`;
    expect(attempt!.state).toBe("voided");
  });

  it("treats the same sender sending the code again as the same link, and refuses it from anyone else", async () => {
    const request = await createTestRequest(db);
    const sender = newSender();
    const pending = await pendingCode(request.requestId);
    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
    const binding = await bindingOf(request.requestId);
    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
    expect(await im.outbox({ kind: "link_refused", recipientHash: imessageHash(testTokenKey, "sender", sender) })).toHaveLength(0);
    expect(await im.outbox({ kind: "linked", recipientHash: imessageHash(testTokenKey, "sender", sender) })).toHaveLength(1);

    expect((await im.deliver({ sender: newSender(), text: pending.message })).outcome).toBe("link_refused");
    expect(await bindingOf(request.requestId)).toMatchObject({ id: binding!.id, state: "active" });
  });

  // A forwarded code links whoever sends it first (link-on-code D3); the booking
  // page then shows that number and Unlink, and the guest makes a new code (D2).
  it("binds a forwarded code to its sender for that request only, and lets the guest unlink it", async () => {
    const request = await createTestRequest(db);
    const other = await createTestRequest(db);
    const pending = await pendingCode(request.requestId);
    const stranger = newSender();
    expect((await im.deliver({ sender: stranger, text: pending.message })).outcome).toBe("link_received");
    expect(await status(request.requestId)).toMatchObject({ sender: `•••• ${stranger.slice(-4)}`, state: "linked" });
    expect(await bindingOf(other.requestId)).toBeNull();

    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.unlink)).toMatchObject({ ok: true, result: { unlinked: true } });
    expect(await status(request.requestId)).toMatchObject({ state: "none" });
    expect((await im.outbox({ kind: "linked", recipientHash: imessageHash(testTokenKey, "sender", stranger) }))[0]!.state).toBe("suppressed");

    const own = newSender();
    const fresh = await pendingCode(request.requestId);
    expect((await im.deliver({ sender: own, text: fresh.message })).outcome).toBe("link_received");
    expect(await bindingOf(request.requestId)).toMatchObject({ sender_hash: imessageHash(testTokenKey, "sender", own), state: "active" });
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
    for (let index = 0; index < 5; index += 1) expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { number: "+15557654321" })).ok).toBe(true);
    const sixth = await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { number: "+15557654321" });
    expect(sixth.ok ? null : sixth.error.category).toBe("rate_limited");
  });
});

describe("ending a guest binding", () => {
  it("persists email-only delivery, cancels pending links and refuses a later linking attempt", async () => {
    const request = await createTestRequest(db);
    const pending = await pendingCode(request.requestId);
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.emailOnly)).toMatchObject({ ok: true, result: { emailOnly: true } });
    expect(await status(request.requestId)).toMatchObject({ state: "none", emailOnly: true });
    const [saved] = await db<{ details: { notificationPreference: string }; state: string }[]>`
      select details, state from app.requests where id = ${request.requestId}
    `;
    expect(saved!.details.notificationPreference).toBe("email_only");
    expect(saved!.state).toBe("gathering");
    const [attempt] = await db<{ state: string }[]>`select state from app.imessage_links where request_id = ${request.requestId} and code_hash = ${hashLinkCode(pending.code)}`;
    expect(attempt!.state).toBe("cancelled");
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { number: newSender() })).toMatchObject({ ok: false, error: { category: "invalid_input" } });
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.emailOnly)).ok).toBe(true);
    expect(await readRequesterImessageStatus(db, [testTokenKey], request.requestId, "")).toMatchObject({ state: "none", emailOnly: true });
  });

  it("choosing email only ends an active binding and suppresses queued messaging", async () => {
    const guest = await linkedGuest();
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: imessageHash(testTokenKey, "sender", guest.sender) });
    expect((await asGuest(guest.requestId, REQUESTER_IMESSAGE_OPERATIONS.emailOnly)).ok).toBe(true);
    expect(await bindingOf(guest.requestId)).toMatchObject({ state: "unlinked" });
    expect(await status(guest.requestId)).toMatchObject({ state: "none", emailOnly: true });
    expect((await im.send(welcome!.id)).sent).toEqual([]);
  });

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

  it("keeps the binding when the request is withdrawn, for a revised request later (U16)", async () => {
    const guest = await linkedGuest();
    const [request] = await db<{ revision: number }[]>`select revision from app.requests where id = ${guest.requestId}`;
    const withdrawn = await runCommand(
      { authenticate: async () => ({ id: guest.requestId, kind: "requester_request" }), db },
      withdrawRequestCommand as unknown as CommandDefinition<unknown, unknown>,
      { expectedRevision: request!.revision, input: {}, resourceId: guest.requestId, retryKey: randomUUID() },
    );
    expect(withdrawn.ok).toBe(true);
    expect(await bindingOf(guest.requestId)).toMatchObject({ state: "active" });

    const [welcome] = await im.outbox({ kind: "linked", recipientHash: imessageHash(testTokenKey, "sender", guest.sender) });
    expect(textOf((await im.send(welcome!.id)).sent)).toHaveLength(1);
  });
});

const noticeHandler = createImessageNoticeHandler(() => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] }));

// A guest of a ready host's request linked on WhatsApp, as the card and the guest's WhatsApp message do.
async function linkedWhatsAppGuest(sender: string = newWhatsAppSender()) {
  const request = await createTestRequest(db);
  await makeHostReady(db, request.hostAccountId, { displayName: "Ada Lovelace" });
  expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { channel: "whatsapp", number: `+${sender}` })).ok).toBe(true);
  const pending = await status(request.requestId);
  if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
  expect((await im.deliver({ channel: "whatsapp", sender, text: pending.message })).outcome).toBe("link_received");
  expect(await status(request.requestId)).toMatchObject({ state: "linked" });
  return { ...request, sender, senderHash: channelHash(testTokenKey, "whatsapp", "sender", sender) };
}

async function guestNotice(requestId: string, notice: { readonly kind: "status_declined" | "status_expired" }) {
  await db.begin((tx) => enqueueStatusNotice(tx, testNotices, requestId, notice).then(() => undefined));
  const job = await jobFor(db, IMESSAGE_NOTICE_JOB, guestNoticeKey(requestId, notice));
  await runJob(db, job.id, noticeHandler);
  const [row] = await db<{ id: string; channel: string }[]>`
    select id, channel from app.imessage_outbox where kind = 'notice' and dedupe_key = ${guestNoticeKey(requestId, notice)}
  `;
  return row!;
}

describe("linking a guest's WhatsApp", () => {
  it("offers WhatsApp where it is configured and refuses it where it is not", async () => {
    const request = await createTestRequest(db);
    expect(await status(request.requestId)).toEqual({ lineNumber: TEST_LINE, state: "none", telegramUsername: null, whatsappNumber: TEST_WHATSAPP_NUMBER });
    expect(await readRequesterImessageStatus(db, [testTokenKey], request.requestId, "", TEST_WHATSAPP_NUMBER)).toMatchObject({ lineNumber: "", state: "none" });

    const imessageOnly = createRequesterImessageLinkCommand({ ...options, whatsappNumber: "" });
    const refused = await runCommand(
      { authenticate: async () => ({ id: request.requestId, kind: "requester_request" }), db },
      imessageOnly as unknown as CommandDefinition<unknown, unknown>,
      { input: { channel: "whatsapp", number: "+15557654321" }, resourceId: request.requestId, retryKey: randomUUID() },
    );
    expect(refused).toMatchObject({ error: { category: "unavailable_configuration" }, ok: false });
  });

  it("refuses a WhatsApp code without a number, or with a refused registration", async () => {
    const request = await createTestRequest(db);
    const before = photon.registered.length;
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { channel: "whatsapp" })).toMatchObject({
      error: { category: "invalid_input" },
      ok: false,
    });
    expect(photon.registered.length).toBe(before);
    photon.nextRegistration(422);
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { channel: "whatsapp", number: "+15557654321" })).toMatchObject({
      error: { category: "unavailable_configuration" },
      ok: false,
    });
    expect(await status(request.requestId)).toMatchObject({ state: "none" });
  });

  it("registers the number, addresses the WhatsApp number, and binds the WhatsApp sender on arrival", async () => {
    const request = await createTestRequest(db);
    const sender = newWhatsAppSender();
    photon.nextRegistration({ lineNumber: "+15550009999" });
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { channel: "whatsapp", number: `+${sender}` })).ok).toBe(true);
    expect(photon.registered.at(-1)).toBe(`+${sender}`);
    const pending = await status(request.requestId);
    expect(pending).toMatchObject({ channel: "whatsapp", lineNumber: TEST_WHATSAPP_NUMBER, state: "pending" });
    const [attempt] = await db<{ channel: string; line_number: string | null }[]>`
      select channel, line_number from app.imessage_links where request_id = ${request.requestId} and state = 'pending'
    `;
    expect(attempt).toEqual({ channel: "whatsapp", line_number: null });
    if (pending.state !== "pending") throw new Error("Expected pending.");

    expect((await im.deliver({ channel: "whatsapp", sender, text: pending.message })).outcome).toBe("link_received");
    const senderHash = channelHash(testTokenKey, "whatsapp", "sender", sender);
    expect(await im.outbox({ kind: "link_received", recipientHash: senderHash })).toHaveLength(0);
    const [binding] = await db<{ channel: string; sender_hash: string; in_window: boolean }[]>`
      select channel, sender_hash, last_inbound_at > now() - interval '1 hour' as in_window
      from app.requester_imessage_bindings where request_id = ${request.requestId} and state = 'active'
    `;
    expect(binding).toEqual({ channel: "whatsapp", in_window: true, sender_hash: senderHash });
    expect(await status(request.requestId)).toMatchObject({
      channel: "whatsapp",
      lineNumber: TEST_WHATSAPP_NUMBER,
      sender: `•••• ${sender.slice(-4)}`,
      state: "linked",
    });

    // The welcome goes out on WhatsApp, inside the window the link message opened.
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: senderHash });
    const { sent } = await im.send(welcome!.id);
    expect(sent).toEqual([expect.objectContaining({ channel: "whatsapp", recipient: { address: sender, spaceId: sender } })]);
    expect(textOf(sent)).toEqual([REQUESTER_LINK_TEXTS.linked("your host")]);

    // WhatsApp has no contact card.
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.shareContactCard)).toMatchObject({ error: { category: "invalid_input" } });
  });

  it("voids a WhatsApp code that arrives from iMessage", async () => {
    const request = await createTestRequest(db);
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { channel: "whatsapp", number: "+15557654321" })).ok).toBe(true);
    const pending = await status(request.requestId);
    if (pending.state !== "pending") throw new Error("Expected pending.");
    expect((await im.deliver({ sender: newSender(), text: pending.message })).outcome).toBe("link_refused");
    expect(await status(request.requestId)).toMatchObject({ state: "none" });
  });

  it("routes the guest's WhatsApp text into the requester discussion marked [WhatsApp], and replies on WhatsApp", async () => {
    const guest = await linkedWhatsAppGuest();
    expect((await im.deliver({ channel: "whatsapp", sender: guest.sender, text: "Can we do Tuesday instead?" })).outcome).toBe("forwarded");
    const inputs = await db<{ id: string; message: string }[]>`
      select i.id, i.message from app.conversation_inputs i
      join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${guest.requestId} and d.audience = 'requester'
    `;
    expect(inputs.map((input) => input.message)).toEqual(["[WhatsApp] Can we do Tuesday instead?"]);
    const [reply] = await db<{ id: string; channel: string }[]>`select id, channel from app.imessage_outbox where kind = 'turn' and input_id = ${inputs[0]!.id}`;
    expect(reply!.channel).toBe("whatsapp");
    await im.endTurn(inputs[0]!.id, "Sure, Tuesday works.");
    const { sent } = await im.send(reply!.id);
    expect(sent).toEqual([expect.objectContaining({ channel: "whatsapp", recipient: { address: guest.sender, spaceId: guest.sender } })]);
  });

  it("sends a notice inside the window as text and suppresses one outside it with no template", async () => {
    const guest = await linkedWhatsAppGuest();
    const inside = await guestNotice(guest.requestId, { kind: "status_declined" });
    expect(inside.channel).toBe("whatsapp");
    const { sent } = await im.send(inside.id);
    expect((await db<{ state: string }[]>`select state from app.imessage_outbox where id = ${inside.id}`)[0]!.state).toBe("accepted");
    expect(sent).toEqual([expect.objectContaining({ channel: "whatsapp", content: expect.objectContaining({ kind: "text" }) })]);

    await db`
      update app.requester_imessage_bindings set last_inbound_at = now() - interval '25 hours'
      where request_id = ${guest.requestId} and state = 'active'
    `;
    const outside = await guestNotice(guest.requestId, { kind: "status_expired" });
    expect((await im.send(outside.id)).sent).toEqual([]);
    const [row] = await db<{ state: string; failure_category: string | null }[]>`
      select state, failure_category from app.imessage_outbox where id = ${outside.id}
    `;
    expect(row).toEqual({ failure_category: "window_closed", state: "suppressed" });
    expect(await db`select 1 from app.imessage_outbox where kind = 'template' and recipient_hash = ${guest.senderHash}`).toHaveLength(0);
  });
});
