import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CARD_AFTER_WELCOME_SECONDS } from "../../lib/server/imessage-links";
import { THANKS_TAPBACK } from "../../lib/server/imessage-receipts";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness } from "./support/imessage";

// Read marks, typing and a tapback for thanks (host-imessage-channel D20–D22,
// design 18): a linked host's text on iMessage records one best-effort signal,
// a read mark with typing while a turn's reply waits or the read mark alone
// beside a command's reply; a message that only says thanks gets a tapback and
// no turn; a signal that fails is final and hides nothing; the card waits
// behind the welcome; WhatsApp gets no signal and no contact card.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

async function signalsOf(hostAccountId: string) {
  return im.outbox({ hostAccountId, kind: "signal" });
}

describe("signals", () => {
  it("marks the host's message read and shows typing while the turn's reply waits", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);

    const delivered = await im.deliver({ sender, text: "I prefer mornings" });
    expect(delivered.outcome).toBe("forwarded");

    const [signal] = await signalsOf(hostAccountId);
    expect(await im.outbox({ hostAccountId, kind: "turn" })).toMatchObject([{ state: "waiting" }]);

    const { sent } = await im.send(signal!.id);
    expect(sent.map((send) => send.content)).toEqual([{ kind: "signal", messageId: delivered.messageId, reaction: null, typing: true }]);
    expect(sent[0]!.recipient).toEqual({ address: sender, spaceId: `any;-;${sender}` });
    expect((await signalsOf(hostAccountId))[0]).toMatchObject({ state: "accepted" });
  });

  it("answers a message that only says thanks with a tapback and starts no turn", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);

    const delivered = await im.deliver({ sender, text: "Thanks! 🙏" });
    expect(delivered.outcome).toBe("replied");
    expect(await im.inputsOf(hostAccountId)).toEqual([]);
    expect(await im.outbox({ hostAccountId, kind: "turn" })).toEqual([]);

    const [signal] = await signalsOf(hostAccountId);
    const { sent } = await im.send(signal!.id);
    expect(sent.map((send) => send.content)).toEqual([{ kind: "signal", messageId: delivered.messageId, reaction: THANKS_TAPBACK, typing: false }]);
  });

  it("still forwards ok, yes and 👍, which can answer Thyme", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);

    for (const text of ["ok", "yes", "👍"]) {
      expect((await im.deliver({ sender, text })).outcome).toBe("forwarded");
    }
    expect((await im.inputsOf(hostAccountId)).map((input) => input.message)).toEqual(["[iMessage] ok", "[iMessage] yes", "[iMessage] 👍"]);
  });

  it("makes a refused or lost signal final, without retry and without a delivery problem", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);

    await im.deliver({ sender, text: "Which days work?" });
    await im.deliver({ sender, text: "Mornings only" });
    const [refused, lost] = await signalsOf(hostAccountId);

    photon.nextSend({ category: "provider_rejected", status: 400 });
    await im.send(refused!.id);
    photon.nextSend({ status: 503 });
    await im.send(lost!.id);

    expect(await signalsOf(hostAccountId)).toMatchObject([{ state: "failed" }, { state: "failed" }]);
    const failures = await db<{ failure_category: string }[]>`
      select failure_category from app.imessage_outbox where id in (${refused!.id}, ${lost!.id}) order by created_at
    `;
    expect(failures.map((row) => row.failure_category)).toEqual(["provider_rejected", "uncertain"]);
    const jobs = await db<{ state: string }[]>`
      select state from app.jobs where dedupe_key in (${`outbox:${refused!.id}`}, ${`outbox:${lost!.id}`})
    `;
    expect(jobs.every((job) => job.state !== "pending")).toBe(true);
    expect(await im.status(hostAccountId)).toMatchObject({ delivery: null, state: "linked" });
  });
});

describe("the contact card after linking", () => {
  it("queues one card that waits behind the welcome on iMessage", async () => {
    const { hostAccountId } = await hostWithUser(db);
    await im.link(hostAccountId);

    const [linked] = await im.outbox({ hostAccountId, kind: "linked" });
    const cards = await im.outbox({ hostAccountId, kind: "contact_card" });
    expect(cards).toHaveLength(1);
    const runAfter = async (outboxId: string) => {
      const [job] = await db<{ run_after: Date }[]>`select run_after from app.jobs where dedupe_key = ${`outbox:${outboxId}`}`;
      return job!.run_after.getTime();
    };
    expect(await runAfter(cards[0]!.id)).toBeGreaterThanOrEqual((await runAfter(linked!.id)) + (CARD_AFTER_WELCOME_SECONDS - 1) * 1000);
  });

  it("marks a command read without typing, since its reply is immediate", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);

    const delivered = await im.deliver({ sender, text: "help" });
    expect(delivered.outcome).toBe("command");
    const [signal] = await signalsOf(hostAccountId);
    const { sent } = await im.send(signal!.id);
    expect(sent.map((send) => send.content)).toEqual([{ kind: "signal", messageId: delivered.messageId, reaction: null, typing: false }]);
  });

  it("sends neither a card nor signals on WhatsApp", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId, undefined, "whatsapp");

    expect((await im.deliver({ channel: "whatsapp", sender, text: "Thanks!" })).outcome).not.toBe("replied");
    expect(await im.outbox({ hostAccountId, kind: "contact_card" })).toEqual([]);
    expect(await signalsOf(hostAccountId)).toEqual([]);
  });
});
