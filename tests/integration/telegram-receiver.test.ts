import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { channelHash, IMESSAGE_RECEIPT_JOB, receiptSealContext } from "../../lib/server/photon-receiver";
import { openTelegramText } from "../../lib/server/telegram";
import { receiveTelegramWebhook, type TelegramReceiverDependencies } from "../../lib/server/telegram-receiver";
import { openToken } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { testTokenKey } from "./support/requests";
import {
  newTelegramUpdateId,
  newTelegramUser,
  telegramBlocked,
  telegramCallback,
  telegramDelivery,
  telegramMessage,
  TEST_TELEGRAM_SECRET,
} from "./support/telegram";

// The Telegram webhook against the local stack (host-telegram-channel task 2.2):
// a private message, a button tap and a blocking update are each stored as one
// receipt (channel telegram, message ID update:<update_id>) and one job before
// 200; a redelivery or a concurrent duplicate reuses them; a wrong secret, a
// group, a bot and another update type store nothing; the sender is hashed in
// the telegram namespace and kept only sealed with its profile; and until Lane C
// the receipt job records a Telegram receipt that is not linking as ignored and
// replies nothing.

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

const deps: TelegramReceiverDependencies = { config: { secret: TEST_TELEGRAM_SECRET }, db, tokenKey: testTokenKey };
const load = () => deps;

async function receiptOf(updateId: number) {
  return db<
    {
      id: string;
      channel: string;
      webhook_id: string;
      sender_hash: string;
      space_hash: string;
      space_type: string;
      content_type: string;
      text_ciphertext: string | null;
      sender_ciphertext: string | null;
      sealed_key_id: string | null;
      outcome: string | null;
    }[]
  >`
    select id, channel, webhook_id, sender_hash, space_hash, space_type, content_type, text_ciphertext, sender_ciphertext, sealed_key_id, outcome
    from app.imessage_receipts where message_id = ${`update:${updateId}`}
  `;
}

async function jobsOf(receiptId: string) {
  return db<{ id: string; state: string }[]>`
    select id, state from app.jobs where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receiptId}`}
  `;
}

function opened(receipt: { id: string; text_ciphertext: string | null; sealed_key_id: string | null }) {
  return openTelegramText(openToken([testTokenKey], { ciphertext: receipt.text_ciphertext!, keyId: receipt.sealed_key_id! }, receiptSealContext(receipt.id)));
}

describe("receiveTelegramWebhook", () => {
  it("stores one sealed receipt and one job before answering 200", async () => {
    const userId = newTelegramUser();
    const updateId = newTelegramUpdateId();
    const response = await receiveTelegramWebhook(telegramDelivery(telegramMessage({ firstName: "Dohyeon", text: "Make it next week", updateId, userId, username: "dohyeon" })), load);

    expect(response.status).toBe(200);
    const [receipt] = await receiptOf(updateId);
    expect(receipt).toMatchObject({
      channel: "telegram",
      content_type: "text",
      outcome: null,
      sender_hash: channelHash(testTokenKey, "telegram", "sender", String(userId)),
      space_hash: channelHash(testTokenKey, "telegram", "space", String(userId)),
      space_type: "dm",
      webhook_id: "telegram",
    });
    expect(receipt!.text_ciphertext).not.toContain("next week");
    expect(receipt!.text_ciphertext).not.toContain("Dohyeon");
    expect(opened(receipt!)).toEqual({
      details: { callbackId: null, callbackMessageId: null, firstName: "Dohyeon", username: "dohyeon" },
      text: "Make it next week",
    });
    expect(openToken([testTokenKey], { ciphertext: receipt!.sender_ciphertext!, keyId: receipt!.sealed_key_id! }, receiptSealContext(receipt!.id))).toBe(String(userId));
    expect(await jobsOf(receipt!.id)).toEqual([expect.objectContaining({ state: "pending" })]);
  });

  it("answers 200 to a redelivery and to concurrent duplicates with one receipt and one job", async () => {
    const updateId = newTelegramUpdateId();
    const body = telegramMessage({ updateId, userId: newTelegramUser() });
    const answers = await Promise.all([1, 2, 3].map(() => receiveTelegramWebhook(telegramDelivery(body), load)));
    const again = await receiveTelegramWebhook(telegramDelivery(body), load);
    const changed = await receiveTelegramWebhook(telegramDelivery(telegramMessage({ text: "other", updateId, userId: newTelegramUser() })), load);

    expect([...answers, again, changed].map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const rows = await receiptOf(updateId);
    expect(rows).toHaveLength(1);
    expect(await jobsOf(rows[0]!.id)).toHaveLength(1);
  });

  it("stores a button tap with its callback locators and a blocking update", async () => {
    const userId = newTelegramUser();
    const tap = newTelegramUpdateId();
    const block = newTelegramUpdateId();

    expect((await receiveTelegramWebhook(telegramDelivery(telegramCallback({ callbackId: "cb-1", data: "a:K7Q2MX-2", updateId: tap, userId })), load)).status).toBe(200);
    expect((await receiveTelegramWebhook(telegramDelivery(telegramBlocked({ updateId: block, userId })), load)).status).toBe(200);

    const [callback] = await receiptOf(tap);
    expect(callback).toMatchObject({ content_type: "callback" });
    expect(opened(callback!)).toMatchObject({ details: { callbackId: "cb-1", callbackMessageId: "42" }, text: "a:K7Q2MX-2" });
    const [blocked] = await receiptOf(block);
    expect(blocked).toMatchObject({ content_type: "blocked", sender_hash: callback!.sender_hash });
  });

  it("stores nothing for a wrong secret, a group, a bot or another update type", async () => {
    const userId = newTelegramUser();
    const ids = [newTelegramUpdateId(), newTelegramUpdateId(), newTelegramUpdateId(), newTelegramUpdateId()];

    expect((await receiveTelegramWebhook(telegramDelivery(telegramMessage({ updateId: ids[0], userId }), "wrong"), load)).status).toBe(401);
    expect((await receiveTelegramWebhook(telegramDelivery(telegramMessage({ updateId: ids[0], userId }), null), load)).status).toBe(401);
    expect(
      (await receiveTelegramWebhook(telegramDelivery(telegramMessage({ chat: { id: -1001, type: "supergroup" }, updateId: ids[1], userId })), load)).status,
    ).toBe(200);
    expect((await receiveTelegramWebhook(telegramDelivery(telegramMessage({ isBot: true, updateId: ids[2], userId })), load)).status).toBe(200);
    expect((await receiveTelegramWebhook(telegramDelivery(JSON.stringify({ edited_message: {}, update_id: ids[3] })), load)).status).toBe(200);

    for (const id of ids) expect(await receiptOf(id!)).toEqual([]);
  });

  it("answers 500 when the receipt cannot be stored, so Telegram retries", async () => {
    const failing: TelegramReceiverDependencies = {
      ...deps,
      db: { begin: async () => Promise.reject(new Error("down")) } as unknown as TelegramReceiverDependencies["db"],
    };
    const response = await receiveTelegramWebhook(telegramDelivery(telegramMessage({ userId: newTelegramUser() })), () => failing);
    expect(response.status).toBe(500);
  });
});

describe("the receipt job before Lane C", () => {
  it("records a Telegram receipt as ignored, clears it and sends nothing", async () => {
    const updateId = newTelegramUpdateId();
    await receiveTelegramWebhook(telegramDelivery(telegramMessage({ text: "requests", updateId, userId: newTelegramUser() })), load);
    const [receipt] = await receiptOf(updateId);
    const before = photon.sends.length;

    await im.runReceipt(receipt!.id);

    const [after] = await receiptOf(updateId);
    expect(after).toMatchObject({ outcome: "ignored", sender_ciphertext: null, text_ciphertext: null });
    expect(await db`select 1 from app.imessage_outbox where dedupe_key = ${`receipt:${receipt!.id}`}`).toHaveLength(0);
    expect(photon.sends.length).toBe(before);
  });
});
