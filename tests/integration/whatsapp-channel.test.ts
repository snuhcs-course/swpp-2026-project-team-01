import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reviewRef, STOP_TEXTS } from "../../lib/server/imessage-commands";
import { CHANNEL_TEXTS, WHATSAPP_PREFIX } from "../../lib/server/imessage-receipts";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { seedHost, setupDependencies } from "./support/setup-host";

// The channel behavior WhatsApp shares with iMessage (host-whatsapp-channel task
// 4.2): an exact approval from WhatsApp approves once, also when the receipt is
// replayed after a restart; a plain "yes" and an outdated reference decide
// nothing; free text reaches the shared discussion marked [WhatsApp]; setup
// answers in WhatsApp; other content gets the text-only reply; stop ends the
// binding, confirms once and sends nothing after.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
let setupDeps: ReturnType<typeof setupDependencies>;
const im = imessageHarness(db, () => photon, { receipt: () => ({ setup: setupDeps }) });

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
  setupDeps = setupDependencies(db, google);
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

async function say(sender: string, text: string) {
  const delivered = await im.deliver({ channel: "whatsapp", sender, text });
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where dedupe_key = ${`receipt:${delivered.receiptId}`} and state = 'queued'
  `;
  if (rows.length === 0) return { delivered, reply: null, sent: [] };
  const { sent } = await im.send(rows[0]!.id);
  return { delivered, reply: textOf(sent)[0] ?? null, sent };
}

async function whatsAppRequest() {
  const request = await agreedRequest(db, google);
  const { sender } = await im.link(request.hostAccountId, undefined, "whatsapp");
  return { request, sender };
}

describe("WhatsApp as a host channel", () => {
  it("approves the current proposal once from WhatsApp, also when the receipt is replayed", async () => {
    const { request, sender } = await whatsAppRequest();
    const decision = reviewRef(request.requestId, 1);

    expect((await say(sender, "yes")).delivered.outcome).not.toBe("command");
    expect((await say(sender, `approve ${reviewRef(request.requestId, 9)}`)).delivered.outcome).toBe("command");
    expect(await db`select 1 from app.approvals where request_id = ${request.requestId}`).toHaveLength(0);

    const approved = await say(sender, `approve ${decision}`);
    expect(approved.sent[0]?.channel).toBe("whatsapp");
    expect(approved.reply).toBe("Approved. I'm adding it to your calendar and will tell you when it's confirmed.");

    const replayId = await im.store({ channel: "whatsapp", sender, text: `approve ${decision}` });
    await im.processTwice(replayId);
    expect(await db`select 1 from app.approvals where request_id = ${request.requestId}`).toHaveLength(1);
  });

  it("forwards free text to the shared discussion marked as WhatsApp", async () => {
    const { request, sender } = await whatsAppRequest();
    expect((await im.deliver({ channel: "whatsapp", sender, text: "Could we make it shorter?" })).outcome).toBe("forwarded");
    const inputs = await im.inputsOf(request.hostAccountId);
    expect(inputs.at(-1)?.message).toBe(`${WHATSAPP_PREFIX}Could we make it shorter?`);
    const [turn] = await db<{ channel: string }[]>`
      select channel from app.imessage_outbox where host_account_id = ${request.hostAccountId} and kind = 'turn'
    `;
    expect(turn?.channel).toBe("whatsapp");
  });

  it("answers setup and other content in WhatsApp", async () => {
    const host = await seedHost(db, setupDeps, google);
    const { sender } = await im.link(host.hostAccountId, undefined, "whatsapp");
    const setup = await say(sender, "setup");
    expect(setup.delivered.outcome).toBe("command");
    expect(setup.sent[0]?.channel).toBe("whatsapp");
    expect(setup.reply).toContain("Setup selected.");

    const voice = await im.deliver({ channel: "whatsapp", content: { type: "voice" }, sender });
    expect(voice.outcome).toBe("replied");
    const [reply] = await db<{ id: string }[]>`select id from app.imessage_outbox where dedupe_key = ${`receipt:${voice.receiptId}`}`;
    expect(textOf((await im.send(reply!.id)).sent)).toEqual([CHANNEL_TEXTS.textOnly]);
  });

  it("ends the binding on stop, confirms once and sends nothing after", async () => {
    const { request, sender } = await whatsAppRequest();
    const stopped = await say(sender, "STOP");
    expect(stopped.delivered.outcome).toBe("command");
    expect(stopped.reply).toBe(STOP_TEXTS.whatsapp);
    expect(await im.bindingOf(request.hostAccountId)).toMatchObject({ channel: "whatsapp", state: "unlinked" });

    expect((await say(sender, "requests")).reply).toBe(CHANNEL_TEXTS.unlinkedWhatsApp);
  });
});
