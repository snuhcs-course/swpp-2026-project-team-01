import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUESTER_IMESSAGE_OPERATIONS } from "../../lib/contracts/requester-imessage";
import { enqueueStatusNotice } from "../../lib/server/booking-notices";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { guestNoticeKey, IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { photonConfig } from "../../lib/server/photon";
import { channelHash } from "../../lib/server/photon-receiver";
import { REQUESTER_LINK_TEXTS } from "../../lib/server/requester-imessage-bindings";
import {
  confirmRequesterImessageLinkCommand,
  createRequesterImessageLinkCommand,
  readRequesterImessageStatus,
  shareRequesterContactCardCommand,
  unlinkRequesterImessageCommand,
} from "../../lib/server/requester-imessage-links";
import { telegramConfig } from "../../lib/server/telegram";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { type FakeTelegram, startFakeTelegram } from "./support/fake-telegram";
import { imessageHarness, TEST_TELEGRAM_BOT } from "./support/imessage";
import { newSender, TEST_LINE, TEST_WHATSAPP_NUMBER } from "./support/photon";
import { makeHostReady } from "./support/ready-host";
import { createTestRequest, jobFor, runJob, testNotices, testTokenKey } from "./support/requests";
import { newTelegramUser, telegramBlocked, telegramCallback, telegramMessage } from "./support/telegram";

// Linking a guest's Telegram to one request against the local stack, the
// Photon stand-in and the Bot API stand-in (guest-telegram-link tasks 2.1 and
// 2.2): Get updates in Telegram takes no number and registers nothing; the
// code names the bot and its start link; /start <code> from the guest's private
// chat records the sender by their Telegram name with no reply, and binds only
// after Confirm and link, whose welcome is the bot's first message; a code from
// iMessage voids it; the guest's text reaches the requester discussion marked
// [Telegram] and the reply and notices go out on Telegram without buttons; a
// linked guest's /start and button taps reach no discussion; and unlinking,
// blocking the bot or a send refused as blocked ends the binding.

const db = testDatabase();
let photon: FakePhoton;
let telegram: FakeTelegram;
const im = imessageHarness(db, () => photon);
const TOKEN = "123456:stand_in_token";
const options = {
  lineNumber: TEST_LINE,
  registrar: im.registrar,
  telegramUsername: TEST_TELEGRAM_BOT,
  tokenKey: testTokenKey,
  tokenKeys: [testTokenKey],
  whatsappNumber: TEST_WHATSAPP_NUMBER,
};
const commands: Readonly<Record<string, CommandDefinition<unknown, unknown>>> = Object.fromEntries(
  [createRequesterImessageLinkCommand(options), confirmRequesterImessageLinkCommand(options), unlinkRequesterImessageCommand, shareRequesterContactCardCommand(options)].map(
    (command) => [command.operation, command as unknown as CommandDefinition<unknown, unknown>],
  ),
);

beforeAll(async () => {
  photon = await startFakePhoton();
  telegram = await startFakeTelegram();
});

afterAll(async () => {
  await photon.close();
  await telegram.close();
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
  return readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE, TEST_WHATSAPP_NUMBER, TEST_TELEGRAM_BOT);
}

// Sends one outbox row through the Bot API stand-in.
function sendTelegram(outboxId: string) {
  return im.send(outboxId, {
    ...im.sendDeps(),
    config: { ...photonConfig({}), apiUrl: photon.baseUrl },
    telegram: telegramConfig({ TELEGRAM_API_URL: telegram.baseUrl, TELEGRAM_BOT_TOKEN: TOKEN }),
  });
}

const telegramHash = (userId: number) => channelHash(testTokenKey, "telegram", "sender", String(userId));
const sentTo = (userId: number) => telegram.callsOf("sendMessage").filter((call) => call.params.chat_id === String(userId));

async function bindingOf(requestId: string) {
  const [row] = await db<{ id: string; channel: string; state: string; sender_hash: string; sender_ciphertext: string | null; sender_name_ciphertext: string | null }[]>`
    select id, channel, state, sender_hash, sender_ciphertext, sender_name_ciphertext from app.requester_imessage_bindings
    where request_id = ${requestId} order by created_at desc limit 1
  `;
  return row ?? null;
}

async function pendingTelegram(requestId: string) {
  expect((await asGuest(requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { channel: "telegram" })).ok).toBe(true);
  const pending = await status(requestId);
  if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
  return pending;
}

// A guest of a ready host's request linked on Telegram, as the card and the bot's Start do.
async function linkedTelegramGuest(userId: number = newTelegramUser()) {
  const request = await createTestRequest(db);
  await makeHostReady(db, request.hostAccountId, { displayName: "Ada Lovelace" });
  const pending = await pendingTelegram(request.requestId);
  expect((await im.deliverTelegram(telegramMessage({ firstName: "Grace", text: `/start ${pending.code}`, userId, username: "grace" })))?.outcome).toBe(
    "link_received",
  );
  const received = await status(request.requestId);
  if (received.state !== "received") throw new Error(`Expected a received code, got ${received.state}.`);
  expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId })).ok).toBe(true);
  return { ...request, senderHash: telegramHash(userId), userId };
}

describe("linking a guest's Telegram", () => {
  it("offers Telegram where the bot is configured and refuses it where it is not", async () => {
    const request = await createTestRequest(db);
    expect(await status(request.requestId)).toEqual({ lineNumber: TEST_LINE, state: "none", telegramUsername: TEST_TELEGRAM_BOT, whatsappNumber: TEST_WHATSAPP_NUMBER });
    // Telegram alone is enough to offer updates.
    expect(await readRequesterImessageStatus(db, [testTokenKey], request.requestId, "", "", TEST_TELEGRAM_BOT)).toMatchObject({ state: "none", telegramUsername: TEST_TELEGRAM_BOT });
    expect(await readRequesterImessageStatus(db, [testTokenKey], request.requestId, "", "", "")).toEqual({ state: "unavailable" });

    const withoutBot = createRequesterImessageLinkCommand({ ...options, telegramUsername: "" });
    const refused = await runCommand(
      { authenticate: async () => ({ id: request.requestId, kind: "requester_request" }), db },
      withoutBot as unknown as CommandDefinition<unknown, unknown>,
      { input: { channel: "telegram" }, resourceId: request.requestId, retryKey: randomUUID() },
    );
    expect(refused).toMatchObject({ error: { category: "unavailable_configuration" }, ok: false });
  });

  it("takes no number, registers nothing, and names the bot and the bare code", async () => {
    const request = await createTestRequest(db);
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { channel: "telegram", number: "+15557654321" })).toMatchObject({
      error: { category: "invalid_input" },
      ok: false,
    });
    const before = photon.registered.length;
    const pending = await pendingTelegram(request.requestId);
    expect(photon.registered.length).toBe(before);
    expect(pending).toMatchObject({ channel: "telegram", lineNumber: TEST_TELEGRAM_BOT, message: pending.code, state: "pending" });
    const [attempt] = await db<{ channel: string; line_number: string | null }[]>`
      select channel, line_number from app.imessage_links where request_id = ${request.requestId} and state = 'pending'
    `;
    expect(attempt).toEqual({ channel: "telegram", line_number: null });
  });

  it("records the sender by name with no reply, and binds only after confirmation", async () => {
    const request = await createTestRequest(db);
    const userId = newTelegramUser();
    const pending = await pendingTelegram(request.requestId);

    const start = telegramMessage({ firstName: "Grace", text: `/start ${pending.code}`, userId, username: "grace" });
    expect((await im.deliverTelegram(start))?.outcome).toBe("link_received");
    const received = await status(request.requestId);
    expect(received).toMatchObject({ channel: "telegram", lineNumber: TEST_TELEGRAM_BOT, sender: "Grace (@grace)", state: "received" });
    expect(await bindingOf(request.requestId)).toBeNull();
    // The bot never writes first: nothing goes back until Confirm and link.
    expect(await im.outbox({ recipientHash: telegramHash(userId) })).toEqual([]);

    if (received.state !== "received") throw new Error("Expected received.");
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId })).ok).toBe(true);
    expect(await bindingOf(request.requestId)).toMatchObject({
      channel: "telegram",
      sender_hash: telegramHash(userId),
      sender_name_ciphertext: expect.any(String),
      state: "active",
    });
    expect(await status(request.requestId)).toMatchObject({ channel: "telegram", contactCard: null, lineNumber: TEST_TELEGRAM_BOT, sender: "Grace (@grace)", state: "linked" });

    // The welcome is the bot's first message, on Telegram, with no booking link.
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: telegramHash(userId) });
    expect((await sendTelegram(welcome!.id)).sent).toEqual([]);
    expect(sentTo(userId)).toEqual([
      { method: "sendMessage", params: { chat_id: String(userId), text: REQUESTER_LINK_TEXTS.linked("your host") }, token: TOKEN },
    ]);
    expect(String(sentTo(userId)[0]!.params.text)).not.toContain(request.bookingId);

    // A bot has no contact card.
    expect(await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.shareContactCard)).toMatchObject({ error: { category: "invalid_input" } });
  });

  it("voids a Telegram code that arrives from iMessage, and an iMessage code that arrives from Telegram", async () => {
    const request = await createTestRequest(db);
    const pending = await pendingTelegram(request.requestId);
    expect((await im.deliver({ sender: newSender(), text: pending.code })).outcome).toBe("link_refused");
    expect(await status(request.requestId)).toMatchObject({ state: "none" });

    const other = await createTestRequest(db);
    expect((await asGuest(other.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { number: "+15557654321" })).ok).toBe(true);
    const imessage = await status(other.requestId);
    if (imessage.state !== "pending") throw new Error("Expected pending.");
    expect((await im.deliverTelegram(telegramMessage({ text: `/start ${imessage.code}`, userId: newTelegramUser() })))?.outcome).toBe("link_refused");
    expect(await status(other.requestId)).toMatchObject({ state: "none" });
  });

  it("replaces an iMessage binding on the request when Telegram is confirmed", async () => {
    const request = await createTestRequest(db);
    expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create, { number: "+15557654321" })).ok).toBe(true);
    const imessage = await status(request.requestId);
    if (imessage.state !== "pending") throw new Error("Expected pending.");
    await im.deliver({ sender: newSender(), text: imessage.message });
    const imessageReceived = await status(request.requestId);
    if (imessageReceived.state !== "received") throw new Error("Expected received.");
    await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: imessageReceived.linkId });
    expect(await bindingOf(request.requestId)).toMatchObject({ channel: "imessage", state: "active" });

    const pending = await pendingTelegram(request.requestId);
    await im.deliverTelegram(telegramMessage({ firstName: "Grace", text: pending.code, userId: newTelegramUser() }));
    const received = await status(request.requestId);
    if (received.state !== "received") throw new Error("Expected received.");
    await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId });
    const bindings = await db<{ channel: string; state: string }[]>`
      select channel, state from app.requester_imessage_bindings where request_id = ${request.requestId} order by created_at
    `;
    expect(bindings).toEqual([
      { channel: "imessage", state: "unlinked" },
      { channel: "telegram", state: "active" },
    ]);
  });
});

const noticeHandler = createImessageNoticeHandler(() => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] }));

describe("a linked Telegram guest", () => {
  it("writes into the requester discussion marked [Telegram], and the reply goes out on Telegram", async () => {
    const guest = await linkedTelegramGuest();
    expect((await im.deliverTelegram(telegramMessage({ text: "Can we do Tuesday instead?", userId: guest.userId })))?.outcome).toBe("forwarded");
    const inputs = await db<{ id: string; message: string }[]>`
      select i.id, i.message from app.conversation_inputs i
      join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${guest.requestId} and d.audience = 'requester'
    `;
    expect(inputs.map((input) => input.message)).toEqual(["[Telegram] Can we do Tuesday instead?"]);
    const [reply] = await db<{ id: string; channel: string; requester_binding_id: string | null }[]>`
      select id, channel, requester_binding_id from app.imessage_outbox where kind = 'turn' and input_id = ${inputs[0]!.id}
    `;
    expect(reply).toMatchObject({ channel: "telegram", requester_binding_id: (await bindingOf(guest.requestId))!.id });
    await im.endTurn(inputs[0]!.id, "Sure, Tuesday works.");
    await sendTelegram(reply!.id);
    expect(sentTo(guest.userId).at(-1)).toMatchObject({ params: { chat_id: String(guest.userId), text: expect.stringContaining("Tuesday works") } });
    expect(sentTo(guest.userId).at(-1)!.params.reply_markup).toBeUndefined();
  });

  it("gets a status notice on Telegram without buttons", async () => {
    const guest = await linkedTelegramGuest();
    const notice = { kind: "status_declined" } as const;
    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, guest.requestId, notice).then(() => undefined));
    await runJob(db, (await jobFor(db, IMESSAGE_NOTICE_JOB, guestNoticeKey(guest.requestId, notice))).id, noticeHandler);
    const [row] = await db<{ id: string; channel: string; buttons: unknown }[]>`
      select id, channel, buttons from app.imessage_outbox where kind = 'notice' and dedupe_key = ${guestNoticeKey(guest.requestId, notice)}
    `;
    expect(row).toMatchObject({ buttons: null, channel: "telegram" });
    await sendTelegram(row!.id);
    expect((await db<{ state: string }[]>`select state from app.imessage_outbox where id = ${row!.id}`)[0]!.state).toBe("accepted");
    expect(sentTo(guest.userId).at(-1)!.params.reply_markup).toBeUndefined();
  });

  it("keeps a repeated /start and a button tap out of the discussion", async () => {
    const guest = await linkedTelegramGuest();
    expect((await im.deliverTelegram(telegramMessage({ text: "/start", userId: guest.userId })))?.outcome).toBe("ignored");
    expect((await im.deliverTelegram(telegramCallback({ data: "a:K7Q2MX-1", userId: guest.userId })))?.outcome).toBe("unlinked_reply");
    const [inputs] = await db<{ count: number }[]>`
      select count(*)::int as count from app.conversation_inputs i
      join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${guest.requestId}
        and i.message like '[Telegram]%'
    `;
    expect(inputs!.count).toBe(0);
    expect((await im.outbox({ recipientHash: guest.senderHash })).map((row) => row.kind).sort()).toEqual(["callback_answer", "linked"]);
  });

  it("moves to a revised request with its channel and name when the guest writes after a decline", async () => {
    const guest = await linkedTelegramGuest();
    await db`update app.requests set state = 'declined', closed_at = now() where id = ${guest.requestId}`;
    expect((await im.deliverTelegram(telegramMessage({ text: "Why not?", userId: guest.userId })))?.outcome).toBe("forwarded");
    const [revised] = await db<{ id: string }[]>`select id from app.requests where revised_from_request_id = ${guest.requestId}`;
    expect(await bindingOf(guest.requestId)).toMatchObject({ sender_name_ciphertext: null, state: "moved" });
    expect(await bindingOf(revised!.id)).toMatchObject({ channel: "telegram", sender_hash: guest.senderHash, state: "active" });
    expect(await status(revised!.id)).toMatchObject({ channel: "telegram", sender: "Grace (@grace)", state: "linked" });
    const [input] = await db<{ message: string }[]>`
      select i.message from app.conversation_inputs i join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${revised!.id} and d.audience = 'requester' and i.message like '[Telegram]%'
    `;
    expect(input).toEqual({ message: "[Telegram] Why not?" });
  });

  it("unlinks, clearing the sealed name, and later messages reach no discussion of the request", async () => {
    const guest = await linkedTelegramGuest();
    expect(await asGuest(guest.requestId, REQUESTER_IMESSAGE_OPERATIONS.unlink)).toMatchObject({ ok: true, result: { unlinked: true } });
    expect(await bindingOf(guest.requestId)).toMatchObject({ sender_ciphertext: null, sender_name_ciphertext: null, state: "unlinked" });
    expect(await status(guest.requestId)).toMatchObject({ state: "none" });
    expect((await im.outbox({ kind: "linked", recipientHash: guest.senderHash }))[0]!.state).toBe("suppressed");
    expect((await im.deliverTelegram(telegramMessage({ text: "Still there?", userId: guest.userId })))?.outcome).toBe("unlinked_reply");
  });

  it("ends the binding when the guest blocks the bot, suppressing what was queued", async () => {
    const guest = await linkedTelegramGuest();
    expect((await im.deliverTelegram(telegramBlocked({ userId: guest.userId })))?.outcome).toBe("ignored");
    expect(await bindingOf(guest.requestId)).toMatchObject({ sender_name_ciphertext: null, state: "unlinked" });
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: guest.senderHash });
    const [row] = await db<{ state: string; failure_category: string | null }[]>`select state, failure_category from app.imessage_outbox where id = ${welcome!.id}`;
    expect(row).toEqual({ failure_category: "blocked", state: "suppressed" });
  });

  it("ends the binding when Telegram refuses a send as blocked", async () => {
    const guest = await linkedTelegramGuest();
    telegram.block(String(guest.userId));
    const [welcome] = await im.outbox({ kind: "linked", recipientHash: guest.senderHash });
    await sendTelegram(welcome!.id);
    const [row] = await db<{ state: string; failure_category: string | null }[]>`select state, failure_category from app.imessage_outbox where id = ${welcome!.id}`;
    expect(row).toEqual({ failure_category: "blocked", state: "failed" });
    expect(await bindingOf(guest.requestId)).toMatchObject({ state: "unlinked" });
  });
});
