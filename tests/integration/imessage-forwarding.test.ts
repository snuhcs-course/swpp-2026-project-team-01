import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestRef } from "../../lib/server/imessage-commands";
import { TURN_FALLBACK } from "../../lib/server/imessage-outbox";
import { IMESSAGE_RECEIPT_JOB } from "../../lib/server/photon-receiver";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";

// Forwarding a linked host's free text (host-imessage-channel task 4.3): it
// becomes one accepted input of the selected discussion, marked as iMessage,
// under the same admission as /app; the turn's final text is sent back to the
// linked conversation, or a fixed fallback when the turn gives none; a retried
// receipt finds the same input; and an admission refusal defers the receipt a
// minute without letting later messages overtake it.

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

// A loopback URL nothing listens on, so a connection is refused.
async function closedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

async function turnRowOf(hostAccountId: string) {
  const rows = await im.outbox({ hostAccountId, kind: "turn" });
  return rows.at(-1)!;
}

describe("forwarding free text", () => {
  it("forwards to setup by default and sends the turn's reply back", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);

    const delivered = await im.deliver({ sender, text: "I prefer mornings" });
    expect(delivered.outcome).toBe("forwarded");
    const [input] = await im.inputsOf(hostAccountId);
    expect(input).toMatchObject({ message: "[iMessage] I prefer mornings", request_id: null });

    const turn = await turnRowOf(hostAccountId);
    expect(turn.state).toBe("waiting");
    expect((await im.send(turn.id)).result).toBe("failed");

    await im.endTurn(input!.id, "Got it: mornings. Shall I set 9 am to noon on weekdays?");
    expect(textOf((await im.send(turn.id)).sent)).toEqual(["Got it: mornings. Shall I set 9 am to noon on weekdays?"]);
  });

  it("forwards to the selected request's private discussion", async () => {
    const request = await agreedRequest(db, google);
    const { sender } = await im.link(request.hostAccountId);
    await im.deliver({ sender, text: `request ${requestRef(request.requestId)}` });

    expect((await im.deliver({ sender, text: "Is the requester flexible on Tuesday?" })).outcome).toBe("forwarded");
    const inputs = await im.inputsOf(request.hostAccountId);
    expect(inputs.at(-1)).toMatchObject({ message: "[iMessage] Is the requester flexible on Tuesday?", request_id: request.requestId });
  });

  it("sends the fallback when the turn gives no text, and finds the same input on a retry", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);
    // A restart before the receipt's job committed: the retry finds the same
    // input and records one reply.
    const receiptId = await im.store({ sender, text: "hello" });
    await im.processTwice(receiptId);
    expect(await im.inputsOf(hostAccountId)).toHaveLength(1);
    expect(await im.outbox({ hostAccountId, kind: "turn" })).toHaveLength(1);

    const [input] = await im.inputsOf(hostAccountId);
    await im.endTurn(input!.id, null);
    expect(textOf((await im.send((await turnRowOf(hostAccountId)).id)).sent)).toEqual([TURN_FALLBACK]);
  });

  it("sends a turn reply frozen by an attempt that found Photon unavailable", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);
    await im.deliver({ sender, text: "Are Fridays free?" });
    const [input] = await im.inputsOf(hostAccountId);
    await im.endTurn(input!.id, "Fridays after 2 pm are free.");

    const turn = await turnRowOf(hostAccountId);
    const down = { ...im.sendDeps(), config: { ...im.sendDeps().config, apiUrl: await closedPort() } };
    expect((await im.send(turn.id, down)).result).toBe("failed");
    expect((await im.outbox({ hostAccountId, kind: "turn" }))[0]).toMatchObject({ state: "queued" });

    expect(textOf((await im.send(turn.id)).sent)).toEqual(["Fridays after 2 pm are free."]);
  });

  it("refuses an over-long message with a fixed reply", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);
    expect((await im.deliver({ sender, text: "x".repeat(8_000) })).outcome).toBe("replied");
    expect(await im.inputsOf(hostAccountId)).toHaveLength(0);
  });

  it("defers a message an admission budget refuses by at least a minute, keeping later ones behind it", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);
    const limited = { ...im.receiptDeps(), conversation: { ...im.receiptDeps().conversation, admission: { limits: { scopeMinute: 0 } } } };

    const first = await im.deliver({ sender, text: "first" }, limited);
    expect(first.outcome).toBeNull();
    const [deferred] = await db<{ run_after: Date; payload: { deferrals: number } }[]>`
      select run_after, payload from app.jobs where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${first.receiptId}:deferred:1`}
    `;
    expect(deferred!.payload.deferrals).toBe(1);
    expect(deferred!.run_after.getTime() - Date.now()).toBeGreaterThan(55_000);

    const second = await im.deliver({ sender, text: "second" });
    expect(second.result).toBe("completed");
    expect(second.outcome).toBeNull();
    expect(await im.inputsOf(hostAccountId)).toHaveLength(0);
  });
});
