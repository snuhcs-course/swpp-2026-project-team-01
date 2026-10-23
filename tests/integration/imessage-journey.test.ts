import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eveRuntime } from "../../lib/server/conversations";
import { IMESSAGE_SEND_JOB } from "../../lib/server/imessage-outbox";
import { clearServiceWindow, testDatabase } from "./support/database";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";
import { messagesEvent, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "./support/photon";
import { testTokenKey } from "./support/requests";

// The host iMessage channel against a real `eve dev` whose model is the local
// OpenAI stand-in, the local stack and the Photon stand-in. Photon's signed
// webhook reaches the agent service's photon channel, the receipt job forwards
// the linked host's text into the host's setup discussion, the turn runs in eve,
// the session-owner hook makes the waiting reply due, and the send job delivers
// the turn's text to the linked conversation.

const db = testDatabase();
let photon: FakePhoton;
let fake: FakeOpenAI;
let server: EveServer;

beforeAll(async () => {
  photon = await startFakePhoton();
  fake = await startFakeOpenAI();
  await clearServiceWindow(db);
  // The agent service's receiver reads these.
  process.env.PHOTON_WEBHOOK_ID = TEST_WEBHOOK_ID;
  process.env.PHOTON_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = testTokenKey.key.toString("base64");
  server = await startEve("dev", { modelBaseURL: fake.baseURL });
}, 300_000);

afterAll(async () => {
  await server?.stop();
  await fake?.close();
  await photon?.close();
  await db.end();
});

const im = imessageHarness(db, () => photon, {
  receipt: () => ({ conversation: { admission: { serviceKey: `test:${randomUUID()}` }, db, runtime: eveRuntime(server.url), signingKey: server.signingKey } }),
});

async function waitFor(check: () => Promise<boolean>, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// Photon delivers to the agent service's channel route; the receipt job then runs.
async function arrive(sender: string, text: string) {
  const id = `msg_${randomUUID()}`;
  const response = await fetch(signedWebhook(messagesEvent({ id, sender, text }), { url: `${server.url}/photon/webhook` }));
  expect(response.status).toBe(200);
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`;
  await im.runReceipt(receipt!.id);
  const [after] = await db<{ outcome: string }[]>`select outcome from app.imessage_receipts where id = ${receipt!.id}`;
  return { outcome: after!.outcome, receiptId: receipt!.id };
}

// Waits for the turn behind each waiting reply to end, then sends the reply.
async function answer(hostAccountId: string) {
  const waiting = await db<{ id: string; input_id: string }[]>`
    select id, input_id from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'turn' and state = 'waiting'
  `;
  const texts: string[] = [];

  for (const reply of waiting) {
    expect(
      await waitFor(async () => {
        const [input] = await db<{ state: string }[]>`select state from app.conversation_inputs where id = ${reply.input_id}`;
        return input!.state === "completed";
      }),
    ).toBe(true);
    // The session-owner hook made the waiting reply due when the turn ended.
    expect(
      await waitFor(async () => {
        const [job] = await db<{ due: boolean }[]>`
          select run_after <= now() as due from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${reply.id}`}
        `;
        return job!.due;
      }, 40),
    ).toBe(true);
    const { sent } = await im.send(reply.id, { ...im.sendDeps(), runtime: eveRuntime(server.url), signingKey: server.signingKey });
    texts.push(...textOf(sent));
  }
  return texts;
}

describe("forwarding through eve", () => {
  it("answers a linked host's message with the turn's text in the linked conversation", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);
    fake.rules.push({ includes: "I usually meet in the mornings", reply: { kind: "text", text: "Mornings it is. Shall I offer 9 to 12 on weekdays?" } });

    expect((await arrive(sender, "I usually meet in the mornings")).outcome).toBe("forwarded");
    expect(await answer(hostAccountId)).toEqual(["Mornings it is. Shall I offer 9 to 12 on weekdays?"]);

    const [input] = await im.inputsOf(hostAccountId);
    expect(input).toMatchObject({ message: "[iMessage] I usually meet in the mornings", request_id: null, state: "completed" });
  });
});
