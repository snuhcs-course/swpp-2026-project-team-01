import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calendarConnectUrl, LINK_TEXTS } from "../../lib/server/imessage-links";
import { outboxSealContext } from "../../lib/server/imessage-outbox";
import { helpText } from "../../lib/server/imessage-commands";
import { CHANNEL_TEXTS } from "../../lib/server/imessage-receipts";
import { channelHash } from "../../lib/server/photon-receiver";
import { receiveTelegramWebhook } from "../../lib/server/telegram-receiver";
import { openToken } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, TEST_TELEGRAM_BOT } from "./support/imessage";
import { newSender } from "./support/photon";
import { newHostAccount } from "./support/ready-host";
import { testTokenKey } from "./support/requests";
import { newTelegramUpdateId, newTelegramUser, telegramDelivery, telegramMessage, TEST_TELEGRAM_SECRET } from "./support/telegram";

// Linking Telegram against the local stack (host-telegram-channel task 3.1): a
// Telegram attempt names the bot; /start <code> or the bare code from the host's
// private chat records the sender with their Telegram name and no reply, and
// binds only after Confirm and link, whose welcome is the bot's first message;
// /start without a code gets the unlinked-sender reply once a day; a code from
// the other channel voids the attempt; confirming Telegram ends an iMessage
// binding and suppresses what was queued for it; exact retries change nothing.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

async function pendingTelegram(hostAccountId: string) {
  const created = await im.command(hostAccountId, "imessage.link.create", { channel: "telegram" });
  expect(created.ok).toBe(true);
  const status = await im.status(hostAccountId);
  if (status.state !== "pending") throw new Error(`Expected a pending code, got ${status.state}.`);
  return status;
}

// The outbox rows sent to a sender, with their sealed text opened.
async function sentTo(recipientHash: string) {
  const rows = await db<{ id: string; kind: string; channel: string; state: string; text_ciphertext: string | null; sealed_key_id: string | null }[]>`
    select id, kind, channel, state, text_ciphertext, sealed_key_id from app.imessage_outbox where recipient_hash = ${recipientHash} order by created_at
  `;
  return rows.map((row) => ({
    channel: row.channel,
    kind: row.kind,
    state: row.state,
    text: row.text_ciphertext ? openToken([testTokenKey], { ciphertext: row.text_ciphertext, keyId: row.sealed_key_id! }, outboxSealContext(row.id)) : null,
  }));
}

const telegramHash = (userId: number) => channelHash(testTokenKey, "telegram", "sender", String(userId));

describe("linking Telegram", () => {
  it("names the bot, records the sender by name with no reply, and binds only after confirmation", async () => {
    const hostAccountId = await newHostAccount(db);
    const userId = newTelegramUser();
    const pending = await pendingTelegram(hostAccountId);
    expect(pending).toMatchObject({ channel: "telegram", channels: { telegram: TEST_TELEGRAM_BOT }, lineNumber: TEST_TELEGRAM_BOT, message: pending.code });

    const start = telegramMessage({ firstName: "Dohyeon", text: `/start ${pending.code}`, userId, username: "dohyeon" });
    expect((await im.deliverTelegram(start))?.outcome).toBe("link_received");
    const received = await im.status(hostAccountId);
    expect(received).toMatchObject({ channel: "telegram", replaces: null, sender: "Dohyeon (@dohyeon)", state: "received" });
    expect(await im.bindingOf(hostAccountId)).toBeNull();
    // The bot never writes first: nothing goes back until Confirm and link.
    expect(await sentTo(telegramHash(userId))).toEqual([]);

    if (received.state !== "received") throw new Error("Expected received.");
    expect((await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId })).ok).toBe(true);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ channel: "telegram", sender_hash: telegramHash(userId), state: "active" });
    expect(await im.status(hostAccountId)).toMatchObject({ channel: "telegram", lineNumber: TEST_TELEGRAM_BOT, sender: "Dohyeon (@dohyeon)", state: "linked" });

    const sent = await sentTo(telegramHash(userId));
    expect(sent).toEqual([expect.objectContaining({ channel: "telegram", kind: "linked" })]);
    // A host still setting up is welcomed into setup, Calendar first.
    expect(sent[0]!.text).toBe(LINK_TEXTS.welcomeCalendar(calendarConnectUrl("http://localhost:3000")));

    // The link's sealed values, the name included, are gone.
    const [link] = await db<{ sender_ciphertext: string | null; sender_name_ciphertext: string | null }[]>`
      select sender_ciphertext, sender_name_ciphertext from app.imessage_links where host_account_id = ${hostAccountId}
    `;
    expect(link).toEqual({ sender_ciphertext: null, sender_name_ciphertext: null });
  });

  it("links from the bare code typed as text, and clears the name on unlink", async () => {
    const hostAccountId = await newHostAccount(db);
    const userId = newTelegramUser();
    const pending = await pendingTelegram(hostAccountId);
    expect((await im.deliverTelegram(telegramMessage({ firstName: "Mina", text: pending.code.toLowerCase(), userId })))?.outcome).toBe("link_received");
    const received = await im.status(hostAccountId);
    expect(received).toMatchObject({ sender: "Mina", state: "received" });
    if (received.state !== "received") throw new Error("Expected received.");
    await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId });

    expect((await im.command(hostAccountId, "imessage.unlink")).ok).toBe(true);
    const [binding] = await db<{ state: string; sender_ciphertext: string | null; sender_name_ciphertext: string | null }[]>`
      select state, sender_ciphertext, sender_name_ciphertext from app.imessage_bindings where host_account_id = ${hostAccountId}
    `;
    expect(binding).toEqual({ sender_ciphertext: null, sender_name_ciphertext: null, state: "unlinked" });
  });

  it("answers /start without a code with the unlinked-sender reply once a day, and binds nothing", async () => {
    const userId = newTelegramUser();
    expect((await im.deliverTelegram(telegramMessage({ text: "/start", userId })))?.outcome).toBe("unlinked_reply");
    expect(await sentTo(telegramHash(userId))).toEqual([{ channel: "telegram", kind: "unlinked_sender", state: "queued", text: CHANNEL_TEXTS.unlinkedTelegram }]);
    expect((await im.deliverTelegram(telegramMessage({ text: "/start@findmeatime_bot", userId })))?.outcome).toBe("ignored");
    expect(await sentTo(telegramHash(userId))).toHaveLength(1);
    const [bound] = await db<{ count: number }[]>`select count(*)::int as count from app.imessage_bindings where sender_hash = ${telegramHash(userId)}`;
    expect(bound!.count).toBe(0);

    // A linked host's /start is not linking: it gets help (Lane C), never the unlinked-sender reply.
    const { hostAccountId } = await hostWithUser(db);
    const host = newTelegramUser();
    const pending = await pendingTelegram(hostAccountId);
    await im.deliverTelegram(telegramMessage({ text: `/start ${pending.code}`, userId: host }));
    const received = await im.status(hostAccountId);
    if (received.state !== "received") throw new Error("Expected received.");
    await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId });
    expect((await im.deliverTelegram(telegramMessage({ text: "/start", userId: host })))?.outcome).toBe("command");
    expect((await sentTo(telegramHash(host))).map((row) => [row.kind, row.kind === "command" ? row.text : null])).toEqual([
      ["linked", null],
      ["command", helpText("http://localhost:3000", "en", true)],
    ]);
  });

  it("voids an attempt whose code arrives on another channel", async () => {
    // A Telegram attempt's code sent from iMessage.
    const telegramHost = await newHostAccount(db);
    const pending = await pendingTelegram(telegramHost);
    const imessageSender = newSender();
    expect((await im.deliver({ sender: imessageSender, text: pending.code })).outcome).toBe("link_refused");
    expect(await im.status(telegramHost)).toMatchObject({ state: "none" });

    // An iMessage attempt's code sent from Telegram.
    const imessageHost = await newHostAccount(db);
    await im.command(imessageHost, "imessage.link.create", { number: newSender() });
    const code = await im.status(imessageHost);
    if (code.state !== "pending") throw new Error("Expected pending.");
    const userId = newTelegramUser();
    expect((await im.deliverTelegram(telegramMessage({ text: `/start ${code.code}`, userId })))?.outcome).toBe("link_refused");
    expect(await im.status(imessageHost)).toMatchObject({ state: "none" });
    expect(await sentTo(telegramHash(userId))).toEqual([{ channel: "telegram", kind: "link_refused", state: "queued", text: LINK_TEXTS.refusedTelegram }]);
  });

  it("replaces an iMessage binding after confirmation and suppresses what was queued for it", async () => {
    const hostAccountId = await newHostAccount(db);
    const imessage = await im.link(hostAccountId);
    const queued = await db<{ id: string }[]>`
      select id from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'linked' and state = 'queued'
    `;
    expect(queued).toHaveLength(1);

    const pending = await pendingTelegram(hostAccountId);
    await im.deliverTelegram(telegramMessage({ firstName: "Dohyeon", text: `/start ${pending.code}`, userId: newTelegramUser() }));
    const received = await im.status(hostAccountId);
    expect(received).toMatchObject({ channel: "telegram", replaces: "imessage", state: "received" });
    // Until the tap, the iMessage binding stands.
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ channel: "imessage", state: "active" });
    if (received.state !== "received") throw new Error("Expected received.");
    await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId });

    const bindings = await db<{ channel: string; state: string }[]>`
      select channel, state from app.imessage_bindings where host_account_id = ${hostAccountId} order by linked_at
    `;
    expect(bindings).toEqual([
      { channel: "imessage", state: "unlinked" },
      { channel: "telegram", state: "active" },
    ]);
    const [suppressed] = await db<{ state: string; failure_category: string }[]>`
      select state, failure_category from app.imessage_outbox where id = ${queued[0]!.id}
    `;
    expect(suppressed).toEqual({ failure_category: "replaced", state: "suppressed" });
    expect((await im.deliver({ sender: imessage.sender, text: "requests" })).outcome).toBe("unlinked_reply");
  });

  it("changes nothing on exact retries of the code's receipt and of the commands", async () => {
    const hostAccountId = await newHostAccount(db);
    const first = await im.command(hostAccountId, "imessage.link.create", { channel: "telegram" }, "tg-create");
    const again = await im.command(hostAccountId, "imessage.link.create", { channel: "telegram" }, "tg-create");
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(first.ok && first.result).toEqual(again.ok && again.result);
    const pending = await im.status(hostAccountId);
    if (pending.state !== "pending") throw new Error("Expected pending.");

    // The same update stored once, processed twice, as a rolled-back job retries it.
    const userId = newTelegramUser();
    const body = telegramMessage({ firstName: "Dohyeon", text: `/start ${pending.code}`, updateId: newTelegramUpdateId(), userId });
    const deps = () => ({ config: { secret: TEST_TELEGRAM_SECRET }, db, tokenKey: testTokenKey });
    expect((await receiveTelegramWebhook(telegramDelivery(body), deps)).status).toBe(200);
    // Telegram redelivers the same update: no second receipt.
    expect((await receiveTelegramWebhook(telegramDelivery(body), deps)).status).toBe(200);
    const receipts = await db<{ id: string }[]>`
      select id from app.imessage_receipts where message_id = ${`update:${(JSON.parse(body) as { update_id: number }).update_id}`}
    `;
    expect(receipts).toHaveLength(1);
    await im.processTwice(receipts[0]!.id);
    const received = await im.status(hostAccountId);
    expect(received).toMatchObject({ sender: "Dohyeon", state: "received" });
    if (received.state !== "received") throw new Error("Expected received.");

    // A double tap of Start sends the same code again: still the same attempt.
    expect((await im.deliverTelegram(telegramMessage({ text: `/start ${pending.code}`, userId })))?.outcome).toBe("link_received");
    expect(await im.status(hostAccountId)).toMatchObject({ linkId: received.linkId, state: "received" });

    const confirmed = await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId }, "tg-confirm");
    const replayed = await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId }, "tg-confirm");
    expect(replayed).toMatchObject({ ok: true, replayed: true });
    expect(confirmed.ok && confirmed.result).toEqual(replayed.ok && replayed.result);
    const bindings = await db<{ count: number }[]>`select count(*)::int as count from app.imessage_bindings where host_account_id = ${hostAccountId}`;
    expect(bindings[0]!.count).toBe(1);
    expect((await sentTo(telegramHash(userId))).map((row) => row.kind)).toEqual(["linked"]);
  });
});
