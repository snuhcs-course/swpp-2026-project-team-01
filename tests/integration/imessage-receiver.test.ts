import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  IMESSAGE_RECEIPT_JOB,
  channelHash,
  imessageHash,
  receivePhotonWebhook,
  type ReceiverDependencies,
  receiptSealContext,
} from "../../lib/server/photon-receiver";
import { openToken } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";
import { messagesEvent, newSender, newWhatsAppSender, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET, whatsAppEvent } from "./support/photon";
import { testTokenKey } from "./support/requests";

// The Photon receiver against the local stack (host-imessage-channel task 2.3):
// an inbound message is stored as one receipt and one job before 200; a repeat
// or a concurrent duplicate reuses them; a changed payload under the same
// message is refused with 409 and changes nothing; a stale or bad signature,
// another webhook's delivery and an unconfigured deployment store nothing; other
// events and outbound echoes are acknowledged and dropped; and the receipt keeps
// the sender and text only sealed.

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

const deps: ReceiverDependencies = { config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID }, db, tokenKey: testTokenKey };
const load = () => deps;

async function receiptOf(messageId: string) {
  return db<
    {
      id: string;
      sender_hash: string;
      space_type: string;
      text_ciphertext: string | null;
      sender_ciphertext: string | null;
      sealed_key_id: string | null;
      outcome: string | null;
    }[]
  >`select id, sender_hash, space_type, text_ciphertext, sender_ciphertext, sealed_key_id, outcome from app.imessage_receipts where message_id = ${messageId}`;
}

async function jobsOf(receiptId: string) {
  return db<{ id: string; state: string; max_attempts: number }[]>`
    select id, state, max_attempts from app.jobs where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receiptId}`}
  `;
}

describe("receivePhotonWebhook", () => {
  it("stores one sealed receipt and one job before answering 200", async () => {
    const id = `msg_${randomUUID()}`;
    const sender = newSender();
    const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ id, sender, text: "Make it next week" })), load);

    expect(response.status).toBe(200);
    const [receipt] = await receiptOf(id);
    expect(receipt).toMatchObject({ outcome: null, sender_hash: imessageHash(testTokenKey, "sender", sender), space_type: "dm" });
    const sealed = { ciphertext: receipt!.text_ciphertext!, keyId: receipt!.sealed_key_id! };
    expect(sealed.ciphertext).not.toContain("next week");
    expect(openToken([testTokenKey], sealed, receiptSealContext(receipt!.id))).toBe("Make it next week");
    expect(openToken([testTokenKey], { ciphertext: receipt!.sender_ciphertext!, keyId: receipt!.sealed_key_id! }, receiptSealContext(receipt!.id))).toBe(sender);
    expect(await jobsOf(receipt!.id)).toEqual([expect.objectContaining({ max_attempts: 10, state: "pending" })]);
  });

  it("answers 200 to a repeat and to concurrent duplicates with one receipt and one job", async () => {
    const id = `msg_${randomUUID()}`;
    const body = messagesEvent({ id });
    const answers = await Promise.all([1, 2, 3].map(() => receivePhotonWebhook(signedWebhook(body), load)));
    const again = await receivePhotonWebhook(signedWebhook(body), load);

    expect([...answers, again].map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const rows = await receiptOf(id);
    expect(rows).toHaveLength(1);
    expect(await jobsOf(rows[0]!.id)).toHaveLength(1);
  });

  it("refuses a changed payload under a stored message with 409", async () => {
    const id = `msg_${randomUUID()}`;
    const sender = newSender();
    await receivePhotonWebhook(signedWebhook(messagesEvent({ id, sender, text: "first" })), load);
    const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ id, sender, text: "changed" })), load);

    expect(response.status).toBe(409);
    const [receipt] = await receiptOf(id);
    expect(openToken([testTokenKey], { ciphertext: receipt!.text_ciphertext!, keyId: receipt!.sealed_key_id! }, receiptSealContext(receipt!.id))).toBe("first");
  });

  it("stores nothing for a stale or bad signature, another webhook or no configuration", async () => {
    const ids = [1, 2, 3, 4, 5].map(() => `msg_${randomUUID()}`);
    const stale = await receivePhotonWebhook(signedWebhook(messagesEvent({ id: ids[0] }), { at: Math.floor(Date.now() / 1000) - 301 }), load);
    const bad = await receivePhotonWebhook(signedWebhook(messagesEvent({ id: ids[1] }), { secret: "another" }), load);
    const foreign = await receivePhotonWebhook(signedWebhook(messagesEvent({ id: ids[2] }), { webhookId: randomUUID() }), load);
    const unconfigured = await receivePhotonWebhook(signedWebhook(messagesEvent({ id: ids[3] })), () => ({
      ...deps,
      config: { secret: "", webhookId: "" },
    }));
    const tooLarge = await receivePhotonWebhook(signedWebhook(messagesEvent({ id: ids[4], text: "x".repeat(70_000) })), load);

    expect([stale.status, bad.status, foreign.status, unconfigured.status, tooLarge.status]).toEqual([401, 401, 404, 404, 413]);
    for (const id of ids) expect(await receiptOf(id)).toHaveLength(0);
  });

  it("acknowledges other events, outbound echoes and malformed senders without storing them", async () => {
    const ids = [1, 2, 3].map(() => `msg_${randomUUID()}`);
    const other = JSON.parse(messagesEvent({ id: ids[0] })) as Record<string, unknown>;
    other.event = "typing";
    const answers = [
      await receivePhotonWebhook(signedWebhook(JSON.stringify(other)), load),
      await receivePhotonWebhook(signedWebhook(messagesEvent({ direction: "outbound", id: ids[1] })), load),
      await receivePhotonWebhook(signedWebhook(messagesEvent({ id: ids[2], sender: "not a sender" })), load),
      await receivePhotonWebhook(signedWebhook("{not json"), load),
    ];

    expect(answers.map((response) => response.status)).toEqual([200, 200, 200, 400]);
    for (const id of ids) expect(await receiptOf(id)).toHaveLength(0);
  });

  it("stores a group message for the job, which never gives it a session", async () => {
    const id = `msg_${randomUUID()}`;
    await receivePhotonWebhook(signedWebhook(messagesEvent({ id, spaceType: "group" })), load);
    expect((await receiptOf(id))[0]?.space_type).toBe("group");
  });
});

// host-whatsapp-channel task 2.2: the same webhook and signature, routed by platform.
describe("receivePhotonWebhook with WhatsApp Business", () => {
  async function channelOf(messageId: string) {
    return db<{ channel: string; sender_hash: string; space_hash: string; space_type: string }[]>`
      select channel, sender_hash, space_hash, space_type from app.imessage_receipts where message_id = ${messageId}
    `;
  }

  it("stores a WhatsApp message as a whatsapp receipt with its job, hashed in its own namespace", async () => {
    const id = `wamid.${randomUUID()}`;
    const sender = newWhatsAppSender();
    const response = await receivePhotonWebhook(signedWebhook(whatsAppEvent({ id, sender, text: "help" })), load);

    expect(response.status).toBe(200);
    const [receipt] = await channelOf(id);
    expect(receipt).toEqual({
      channel: "whatsapp",
      sender_hash: channelHash(testTokenKey, "whatsapp", "sender", sender),
      space_hash: channelHash(testTokenKey, "whatsapp", "space", sender),
      space_type: "dm",
    });
    expect(receipt!.sender_hash).not.toBe(imessageHash(testTokenKey, "sender", sender));
    const [stored] = await receiptOf(id);
    expect(await jobsOf(stored!.id)).toHaveLength(1);
  });

  it("keeps iMessage receipts on the iMessage channel", async () => {
    const id = `msg_${randomUUID()}`;
    await receivePhotonWebhook(signedWebhook(messagesEvent({ id })), load);
    expect((await channelOf(id))[0]?.channel).toBe("imessage");
  });

  it("acknowledges and drops unlabelled, mixed, personal-WhatsApp and group events", async () => {
    const ids = [1, 2, 3, 4, 5].map(() => `wamid.${randomUUID()}`);
    const mixed = JSON.parse(whatsAppEvent({ id: ids[1] })) as { space: { platform: string } };
    mixed.space.platform = "iMessage";
    const unlabelled = JSON.parse(whatsAppEvent({ id: ids[0] })) as { message: Record<string, unknown> & { sender: Record<string, unknown>; space: Record<string, unknown> }; space: Record<string, unknown> };
    delete unlabelled.message.platform;
    delete unlabelled.message.sender.platform;
    delete unlabelled.message.space.platform;
    delete unlabelled.space.platform;
    const answers = [
      await receivePhotonWebhook(signedWebhook(JSON.stringify(unlabelled)), load),
      await receivePhotonWebhook(signedWebhook(JSON.stringify(mixed)), load),
      await receivePhotonWebhook(signedWebhook(whatsAppEvent({ id: ids[2], platform: "whatsapp" })), load),
      await receivePhotonWebhook(signedWebhook(whatsAppEvent({ id: ids[3], spaceType: "group" })), load),
      await receivePhotonWebhook(signedWebhook(whatsAppEvent({ id: ids[4], spaceId: newWhatsAppSender() })), load),
    ];

    expect(answers.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    for (const id of ids) expect(await channelOf(id)).toHaveLength(0);
  });

  it("refuses an unsigned WhatsApp delivery like any other", async () => {
    const id = `wamid.${randomUUID()}`;
    const response = await receivePhotonWebhook(signedWebhook(whatsAppEvent({ id }), { secret: "another" }), load);
    expect(response.status).toBe(401);
    expect(await channelOf(id)).toHaveLength(0);
  });
});
