import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkMessage } from "../../lib/contracts/imessage";
import { approveCommand } from "../../lib/server/bookings";
import { eveRuntime } from "../../lib/server/conversations";
import { requestRef, reviewRef } from "../../lib/server/imessage-commands";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { agreeCommand } from "../../lib/server/request-proposals";
import { suggestChangesCommand } from "../../lib/server/shared-changes";
import { agreedRequest, asHost, bookingDeps, bookingOf, runBooking } from "./support/booking";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { runJob, testNotices, testTokenKey } from "./support/requests";
import { asRequester, evaluationDeps, revisionOf, runEvaluation, seoul } from "./support/scheduling";
import { IMESSAGE_SEND_JOB } from "../../lib/server/imessage-outbox";
import { clearServiceWindow, testDatabase } from "./support/database";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";
import { messagesEvent, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "./support/photon";

// The Phase 6 join (task 5.1) against a real `eve dev` whose model is the local
// OpenAI stand-in, the local stack, the fake Google and the Photon stand-in.
// Photon's signed webhook reaches the agent service's photon channel; the
// receipt job links, runs commands or forwards text into the host's
// discussions; turns run in eve and the session-owner hook makes their replies
// due; the send job delivers to the linked conversation. A host links by the
// one-time code and confirms in the browser's command, selects a request, asks a
// private question, shares a revised time, approves the new version (the old
// one is refused) and is told the booking is confirmed (AC-16); a second request
// is declined with no event; a group conversation, an unlinked sender and a
// plain "yes" decide nothing (AC-17); a replayed approval after a restart and a
// web approval leave one booking, and a failed delivery shows on the web while
// the request stays booked (AC-18).

const db = testDatabase();
let photon: FakePhoton;
let fake: FakeOpenAI;
let server: EveServer;
let google: FakeGoogle;

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
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
  await google?.close();
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

// Runs the request's notice jobs and sends the summaries they queued.
async function summaries(hostAccountId: string, requestId: string) {
  const jobs = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and state = 'pending' and payload ->> 'requestId' = ${requestId} order by created_at
  `;
  const deps = { db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] };
  for (const job of jobs) await runJob(db, job.id, createImessageNoticeHandler(() => deps));
  return sendCommandReplies(hostAccountId, "notice");
}

// Sends the host's queued replies of a kind and returns their texts.
async function sendCommandReplies(hostAccountId: string, kind = "command") {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = ${kind} and state = 'queued' order by created_at
  `;
  const texts: string[] = [];
  for (const row of rows) texts.push(...textOf((await im.send(row.id)).sent));
  return texts;
}

describe("the Phase 6 join", () => {
  it("links, discusses, revises, approves and books from iMessage, and declines another request", async () => {
    let sender = "";
    const request = await agreedRequest(db, google, {
      beforeAgree: async (seeded) => {
        // The card makes a code; the host sends it to the agent service's channel.
        await im.command(seeded.hostAccountId, "imessage.link.create");
        const pending = await im.status(seeded.hostAccountId);
        if (pending.state !== "pending") throw new Error("Expected a pending code.");
        sender = `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
        expect((await arrive(sender, linkMessage(pending.code))).outcome).toBe("link_received");
        const received = await im.status(seeded.hostAccountId);
        if (received.state !== "received") throw new Error("Expected the received sender.");
        expect((await im.command(seeded.hostAccountId, "imessage.link.confirm", { linkId: received.linkId })).ok).toBe(true);
      },
    });
    const host = request.hostAccountId;
    const ref = requestRef(request.requestId);

    // The awaiting-approval summary arrives with its exact commands.
    const [summary] = await summaries(host, request.requestId);
    expect(summary).toContain(`approve ${reviewRef(request.requestId, 1)}`);

    // Select the request and ask a private question; the turn runs in eve.
    expect((await arrive(sender, `request ${ref}`)).outcome).toBe("command");
    fake.rules.push({ includes: "Could we do half an hour later", reply: { kind: "text", text: "I'll suggest 10:30 instead. Send changes to see it." } });
    expect((await arrive(sender, "Could we do half an hour later?")).outcome).toBe("forwarded");
    expect(await answer(host)).toEqual(["I'll suggest 10:30 instead. Send changes to see it."]);
    const [question] = (await im.inputsOf(host)).filter((input) => input.message.includes("half an hour later"));
    expect(question).toMatchObject({ request_id: request.requestId, state: "completed" });

    // The assistant's propose_shared_changes records this suggestion; the host
    // shares it by its exact reference, and the requester agrees to version 2.
    await asHost(db, host, request.requestId, suggestChangesCommand("assistant"), { changes: { start: seoul("10:30") } });
    expect((await arrive(sender, "changes")).outcome).toBe("command");
    expect((await sendCommandReplies(host)).join("\n")).toContain(`share ${ref}-S1`);
    expect((await arrive(sender, `share ${ref}-S1`)).outcome).toBe("command");
    const [evaluation] = await db<{ id: string }[]>`select id from app.evaluations where request_id = ${request.requestId} order by created_at desc limit 1`;
    await runEvaluation(db, { ...evaluationDeps(db, google), notices: testNotices }, evaluation!.id);
    const agreed = await asRequester(db, request.requestId, agreeCommand, { version: 2 }, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(agreed.ok).toBe(true);
    expect((await summaries(host, request.requestId))[0]).toContain(`approve ${reviewRef(request.requestId, 2)}`);

    // The old version cannot be approved; a plain yes decides nothing.
    expect((await arrive(sender, `approve ${reviewRef(request.requestId, 1)}`)).outcome).toBe("command");
    expect((await sendCommandReplies(host)).join("\n")).toContain(`The current one is ${reviewRef(request.requestId, 2)}`);
    fake.rules.push({ includes: "[iMessage] yes", reply: { kind: "text", text: "To approve, send the exact approve command from the summary." } });
    expect((await arrive(sender, "yes")).outcome).toBe("forwarded");
    await answer(host);
    expect(await db`select 1 from app.approvals where request_id = ${request.requestId}`).toHaveLength(0);

    // Approve version 2; the booking is confirmed and reported.
    const approval = await arrive(sender, `approve ${reviewRef(request.requestId, 2)}`);
    expect((await sendCommandReplies(host))[0]).toBe("Approved. I'm adding it to your calendar and will tell you when it's confirmed.");

    // A restart replays the same receipt, and a web approval arrives meanwhile.
    const replay = await im.store({ sender, text: `approve ${reviewRef(request.requestId, 2)}` });
    await im.processTwice(replay);
    const web = await asHost(db, host, request.requestId, approveCommand, { version: 2 }, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(web.ok).toBe(true);
    const bookings = await db<{ id: string }[]>`select id from app.bookings where request_id = ${request.requestId}`;
    expect(bookings).toHaveLength(1);
    expect(approval.outcome).toBe("command");

    await runBooking(db, bookingDeps(db, google), bookings[0]!.id);
    expect(await bookingOf(db, bookings[0]!.id)).toMatchObject({ state: "confirmed" });

    // A failed delivery of the booked summary shows on the web; the request stays booked.
    const [booked] = await db<{ id: string }[]>`
      select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and state = 'pending' and payload ->> 'requestId' = ${request.requestId}
    `;
    await runJob(db, booked!.id, createImessageNoticeHandler(() => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] })));
    const [bookedRow] = await db<{ id: string }[]>`select id from app.imessage_outbox where request_id = ${request.requestId} and kind = 'notice' and state = 'queued'`;
    photon.nextSend({ category: "not_imessage", status: 422 });
    await im.send(bookedRow!.id);
    expect(await im.status(host)).toMatchObject({ delivery: { state: "failed" }, state: "linked" });
    expect((await db<{ state: string }[]>`select state from app.requests where id = ${request.requestId}`)[0]!.state).toBe("booked");

    // A second request of the same host is declined from iMessage with no event.
    const second = await agreedRequest(db, google);
    await db`update app.requests set host_account_id = ${host} where id = ${second.requestId}`;
    const declined = await arrive(sender, `decline ${reviewRef(second.requestId, 1)}`);
    expect(declined.outcome).toBe("command");
    expect((await sendCommandReplies(host)).at(-1)).toBe("Declined. The requester will be told; nothing was booked.");
    expect(await db`select 1 from app.bookings where request_id = ${second.requestId}`).toHaveLength(0);
  });

  it("gives an unlinked sender and a group conversation nothing private", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const { sender } = await im.link(hostAccountId);
    const stranger = `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    expect((await arrive(stranger, "requests")).outcome).toBe("unlinked_reply");

    const id = `msg_${randomUUID()}`;
    const group = await fetch(signedWebhook(messagesEvent({ id, sender, spaceType: "group", text: "requests" }), { url: `${server.url}/photon/webhook` }));
    expect(group.status).toBe(200);
    const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`;
    await im.runReceipt(receipt!.id);
    expect((await db<{ outcome: string }[]>`select outcome from app.imessage_receipts where id = ${receipt!.id}`)[0]!.outcome).toBe("ignored");
    expect(await im.outbox({ hostAccountId, kind: "command" })).toHaveLength(0);
  });
});
