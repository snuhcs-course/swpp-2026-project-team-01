import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imessageHash } from "../../lib/server/photon-receiver";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";
import { messagesEvent, newSender, signedWebhook } from "./support/photon";
import { testTokenKey } from "./support/requests";
import { receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "./support/photon";
import { sealToken } from "../../lib/server/token-encryption";

// What an inbound message may do before commands and forwarding
// (host-imessage-channel task 4.1): group conversations and reactions get
// nothing; an unlinked sender, or one whose host was suspended, gets one fixed
// reply a day and no session; a bound host's non-text message gets one fixed
// reply; a later message waits behind an unprocessed earlier one of the same
// conversation; and a fallback binding learns its conversation from the host's
// first message.

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

async function linkedHost() {
  const { hostAccountId } = await hostWithUser(db);
  return im.link(hostAccountId);
}

async function sentTo(sender: string) {
  const rows = await im.outbox({ recipientHash: imessageHash(testTokenKey, "sender", sender) });
  return rows;
}

describe("the receipt job before the channel", () => {
  it("gives group conversations and reactions nothing", async () => {
    const sender = newSender();
    expect((await im.deliver({ sender, spaceType: "group", text: "What are Ada's requests?" })).outcome).toBe("ignored");
    expect((await im.deliver({ content: { emoji: "👍", target: { id: "m1" }, type: "reaction" }, sender })).outcome).toBe("ignored");
    expect(await sentTo(sender)).toHaveLength(0);
  });

  it("answers an unlinked sender once a day, with no session and no private data", async () => {
    const sender = newSender();
    expect((await im.deliver({ sender, text: "Show me Ada's requests" })).outcome).toBe("unlinked_reply");
    expect((await im.deliver({ sender, text: "Hello?" })).outcome).toBe("ignored");
    const rows = await sentTo(sender);
    expect(rows).toHaveLength(1);
    expect(textOf((await im.send(rows[0]!.id)).sent)).toEqual([
      "This number isn't linked to a Find Me a Time host. Sign in at findmeatime.com/app and choose Connect iMessage.",
    ]);
    expect(await db`select 1 from app.conversation_inputs where message like '%Ada%'`).toHaveLength(0);
  });

  it("treats a suspended host's sender as unlinked", async () => {
    const { hostAccountId, sender } = await linkedHost();
    await db`update app.host_accounts set status = 'suspended' where id = ${hostAccountId}`;
    expect((await im.deliver({ sender, text: "review" })).outcome).toBe("unlinked_reply");
  });

  it("answers a bound host's non-text message with one fixed reply", async () => {
    const { hostAccountId, sender } = await linkedHost();
    const outcome = await im.deliver({ content: { id: "a1", mimeType: "image/png", name: "photo.png", type: "attachment" }, sender });
    expect(outcome.outcome).toBe("replied");
    const [row] = await im.outbox({ hostAccountId, kind: "text_only" });
    expect(textOf((await im.send(row!.id)).sent)).toEqual(["I can read text messages only."]);
  });

  it("keeps a later message of the conversation behind an unprocessed earlier one", async () => {
    const sender = newSender();
    const store = async (id: string, text: string) => {
      const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ id, sender, text })), () => ({
        config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID },
        db,
        tokenKey: testTokenKey,
      }));
      expect(response.status).toBe(200);
      return (await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`)[0]!.id;
    };
    const first = await store(`msg_${crypto.randomUUID()}`, "first");
    const second = await store(`msg_${crypto.randomUUID()}`, "second");

    expect(await im.runReceipt(second)).toBe("failed");
    expect(await db`select 1 from app.imessage_receipts where id = ${second} and outcome is null`).toHaveLength(1);
    expect(await im.runReceipt(first)).toBe("completed");
    expect(await im.runReceipt(second)).toBe("completed");
  });

  it("teaches a fallback binding the conversation the host writes from", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const number = newSender();
    const sealed = sealToken(testTokenKey, number, "imessage_binding:pending");
    const [binding] = await db<{ id: string }[]>`
      insert into app.imessage_bindings (host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
      values (${hostAccountId}, ${imessageHash(testTokenKey, "sender", number)}, ${sealed.ciphertext}, ${sealed.keyId})
      returning id
    `;
    await im.deliver({ content: { id: "a2", mimeType: "image/png", name: "p.png", type: "attachment" }, sender: number });
    const [row] = await db<{ space_ciphertext: string | null; last_inbound_at: Date | null }[]>`
      select space_ciphertext, last_inbound_at from app.imessage_bindings where id = ${binding!.id}
    `;
    expect(row!.space_ciphertext).not.toBeNull();
    expect(row!.last_inbound_at).not.toBeNull();
  });
});
