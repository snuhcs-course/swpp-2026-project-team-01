import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUTTON_TITLES, requestRef, reviewRef, settingsRef } from "../../lib/server/imessage-commands";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { recordOutbound } from "../../lib/server/imessage-outbox";
import { THANKS_TAPBACK } from "../../lib/server/imessage-receipts";
import { MAX_INTERACTIVE_BODY } from "../../lib/server/photon";
import { computeSetupProposal } from "../../lib/server/setup";
import { previewNextWeekForTool } from "../../lib/server/setup-channel-tools";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness } from "./support/imessage";
import { newWhatsAppSender } from "./support/photon";
import { runJob, testTokenKey } from "./support/requests";
import { prepareReviewableHost, seedHost, setupDependencies } from "./support/setup-host";

// Read marks, typing, reactions and decision buttons on WhatsApp
// (host-whatsapp-channel D15–D17, design 11, tasks 7.3 and 7.4): a linked host's
// text records one best-effort signal, read with typing for a turn, read alone
// for a command, read with ❤️ and no turn for thanks; a failed signal is final
// and hidden from the card. Decision summaries carry reply buttons inside the
// window when WHATSAPP_BUTTONS=1, a long one is split, a template carries none;
// a tap runs the exact command its ID names, only from the bound sender, and a
// stale tap decides nothing and shows the current proposal.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
let setupDeps: ReturnType<typeof setupDependencies>;
const im = imessageHarness(db, () => photon, { receipt: () => ({ setup: setupDeps }) });
const buttonsOn = () => ({ ...im.sendDeps(), env: { WHATSAPP_BUTTONS: "1" } });

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
  const setup = setupDependencies(db, google);
  setupDeps = { ...setup, calendar: { ...setup.calendar, tokenKeys: [testTokenKey, setup.tokenKey] } };
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

const noticeDeps = () => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] });

async function whatsAppHost() {
  const { hostAccountId } = await hostWithUser(db);
  const { sender } = await im.link(hostAccountId, undefined, "whatsapp");
  return { hostAccountId, sender };
}

async function whatsAppAgreed() {
  let sender = "";
  const request = await agreedRequest(db, google, {
    beforeAgree: async (seeded) => {
      sender = (await im.link(seeded.hostAccountId, undefined, "whatsapp")).sender;
    },
  });
  const jobs = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and state = 'pending' and payload ->> 'requestId' = ${request.requestId}
  `;
  for (const job of jobs) await runJob(db, job.id, createImessageNoticeHandler(noticeDeps));
  const [notice] = await im.outbox({ hostAccountId: request.hostAccountId, kind: "notice" });
  return { notice: notice!, request, sender };
}

async function tap(sender: string, id: string) {
  return im.deliver({
    channel: "whatsapp",
    content: { raw: { reply: { id, title: "Approve" }, type: "button_reply", whatsapp_type: "interactive" }, type: "custom" },
    sender,
  });
}

async function replyTo(receiptId: string) {
  const [row] = await db<{ id: string }[]>`
    select id from app.imessage_outbox where dedupe_key in (${`receipt:${receiptId}`}, ${`host-selection:${receiptId}`}) and kind = 'command'
  `;
  return row!.id;
}

describe("WhatsApp signals", () => {
  it("marks a message read and shows typing while the turn's reply waits", async () => {
    const { hostAccountId, sender } = await whatsAppHost();
    const delivered = await im.deliver({ channel: "whatsapp", sender, text: "I prefer mornings" });
    expect(delivered.outcome).toBe("forwarded");

    const [signal] = await im.outbox({ hostAccountId, kind: "signal" });
    const { sent } = await im.send(signal!.id);
    expect(sent).toMatchObject([{ channel: "whatsapp", content: { kind: "signal", messageId: delivered.messageId, reaction: null, typing: true } }]);
    expect(sent[0]!.recipient.address).toBe(sender);
  });

  it("marks a command read without typing", async () => {
    const { hostAccountId, sender } = await whatsAppHost();
    const delivered = await im.deliver({ channel: "whatsapp", sender, text: "requests" });
    expect(delivered.outcome).toBe("command");

    const [signal] = await im.outbox({ hostAccountId, kind: "signal" });
    expect((await im.send(signal!.id)).sent.map((send) => send.content)).toEqual([
      { kind: "signal", messageId: delivered.messageId, reaction: null, typing: false },
    ]);
  });

  it("answers thanks with a read mark and ❤️, and starts no turn", async () => {
    const { hostAccountId, sender } = await whatsAppHost();
    const delivered = await im.deliver({ channel: "whatsapp", sender, text: "Thank you!" });
    expect(delivered.outcome).toBe("replied");
    expect(await im.inputsOf(hostAccountId)).toEqual([]);

    const [signal] = await im.outbox({ hostAccountId, kind: "signal" });
    expect((await im.send(signal!.id)).sent.map((send) => send.content)).toEqual([
      { kind: "signal", messageId: delivered.messageId, reaction: THANKS_TAPBACK, typing: false },
    ]);
  });

  it("makes a failed signal final, never retried and never shown on the card", async () => {
    const { hostAccountId, sender } = await whatsAppHost();
    await im.deliver({ channel: "whatsapp", sender, text: "Which days work?" });
    const [signal] = await im.outbox({ hostAccountId, kind: "signal" });

    photon.nextSend({ category: "provider_rejected", status: 400 });
    await im.send(signal!.id);
    expect(await im.outbox({ hostAccountId, kind: "signal" })).toMatchObject([{ state: "failed" }]);
    const [job] = await db<{ state: string }[]>`select state from app.jobs where dedupe_key = ${`outbox:${signal!.id}`}`;
    expect(job!.state).not.toBe("pending");
    expect(await im.status(hostAccountId)).toMatchObject({ delivery: null, state: "linked" });
  });

  it("ignores the host's reactions to Thyme's messages", async () => {
    const { hostAccountId, sender } = await whatsAppHost();
    const reacted = await im.deliver({ channel: "whatsapp", content: { emoji: "👍", type: "reaction" }, sender });
    expect(reacted.outcome).toBe("ignored");
    expect(await im.outbox({ hostAccountId, kind: "signal" })).toEqual([]);
  });
});

describe("WhatsApp decision buttons", () => {
  it("sends the awaiting-approval summary as one interactive message with the three buttons", async () => {
    const { notice, request } = await whatsAppAgreed();
    const decision = reviewRef(request.requestId, 1);

    const { sent } = await im.send(notice.id, buttonsOn());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).toMatchObject({
      body: expect.stringMatching(/^Ready for your approval\./),
      buttons: [
        { id: `a:${decision}`, title: BUTTON_TITLES.approve },
        { id: `d:${decision}`, title: BUTTON_TITLES.decline },
        { id: `s:${requestRef(request.requestId)}`, title: BUTTON_TITLES.details },
      ],
      kind: "interactive",
    });
    const [row] = await db<{ provider_message_id: string }[]>`select provider_message_id from app.imessage_outbox where id = ${notice.id}`;
    expect(row!.provider_message_id).toMatch(/^wamid\./);
  });

  it("sends plain text when WHATSAPP_BUTTONS is unset", async () => {
    const { notice } = await whatsAppAgreed();
    const { sent } = await im.send(notice.id);
    expect(sent.map((send) => send.content.kind)).toEqual(["text"]);
    expect(sent[0]!.content).not.toHaveProperty("buttons");
  });

  it("sends a template with no buttons once the window closed", async () => {
    const { notice, request } = await whatsAppAgreed();
    await db`update app.imessage_bindings set last_inbound_at = now() - interval '24 hours' where host_account_id = ${request.hostAccountId} and state = 'active'`;

    await im.send(notice.id, buttonsOn());
    const [template] = await im.outbox({ hostAccountId: request.hostAccountId, kind: "template" });
    const { sent } = await im.send(template!.id, buttonsOn());
    expect(sent.map((send) => send.content.kind)).toEqual(["template"]);
    expect(sent[0]!.content).not.toHaveProperty("buttons");
  });

  it("approves the current proposal once from a button, as approve <ref>-<version>", async () => {
    const { request, sender } = await whatsAppAgreed();
    const tapped = await tap(sender, `a:${reviewRef(request.requestId, 1)}`);
    expect(tapped.outcome).toBe("command");
    expect(await db`select 1 from app.approvals where request_id = ${request.requestId}`).toHaveLength(1);

    const { sent } = await im.send(await replyTo(tapped.receiptId), buttonsOn());
    expect(sent[0]!.content).toMatchObject({ kind: "text", text: "Approved. I'm adding it to your calendar and will tell you when it's confirmed." });

    // The tap is read like any command: a read mark, no typing.
    const signals = await im.outbox({ hostAccountId: request.hostAccountId, kind: "signal" });
    expect((await im.send(signals.at(-1)!.id)).sent[0]!.content).toMatchObject({ messageId: tapped.messageId, typing: false });
  });

  it("decides nothing on a stale tap and shows the current proposal with its buttons", async () => {
    const { request, sender } = await whatsAppAgreed();
    const tapped = await tap(sender, `a:${reviewRef(request.requestId, 2)}`);
    expect(tapped.outcome).toBe("command");
    expect(await db`select 1 from app.approvals where request_id = ${request.requestId}`).toHaveLength(0);

    const { sent } = await im.send(await replyTo(tapped.receiptId), buttonsOn());
    expect(sent[0]!.content).toMatchObject({
      body: expect.stringMatching(/^This proposal has changed\.\nRequest /),
      buttons: expect.arrayContaining([{ id: `a:${reviewRef(request.requestId, 1)}`, title: BUTTON_TITLES.approve }]),
      kind: "interactive",
    });
  });

  it("admits a tap only from the bound sender", async () => {
    const { request } = await whatsAppAgreed();
    const stranger = newWhatsAppSender();
    expect((await tap(stranger, `a:${reviewRef(request.requestId, 1)}`)).outcome).toBe("unlinked_reply");
    expect(await db`select 1 from app.approvals where request_id = ${request.requestId}`).toHaveLength(0);
  });

  it("never forwards a tap whose ID names no command", async () => {
    const { request, sender } = await whatsAppAgreed();
    const tapped = await tap(sender, "opt_0");
    expect(tapped.outcome).toBe("replied");
    expect(await im.inputsOf(request.hostAccountId)).toEqual([]);
    expect(await db`select 1 from app.approvals where request_id = ${request.requestId}`).toHaveLength(0);
  });

  it("offers Confirm settings under the setup review, and a tap confirms them", async () => {
    const host = await seedHost(db, setupDeps, google);
    await prepareReviewableHost(db, host);
    const { sender } = await im.link(host.hostAccountId, undefined, "whatsapp");
    const ref = settingsRef((await computeSetupProposal(db, host.hostAccountId))!.proposalHash);

    const review = await im.deliver({ channel: "whatsapp", sender, text: "review" });
    const { sent } = await im.send(await replyTo(review.receiptId), buttonsOn());
    expect(sent.at(-1)!.content).toMatchObject({ buttons: [{ id: `c:${ref}`, title: BUTTON_TITLES.confirm }], kind: "interactive" });

    expect((await tap(sender, `c:${ref}`)).outcome).toBe("command");
    expect(await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`).toHaveLength(0);

    expect((await im.deliver({ channel: "whatsapp", sender, text: "Show next week" })).outcome).toBe("forwarded");
    const [input] = await db<{ id: string }[]>`select id from app.conversation_inputs where discussion_id = ${host.discussionId} order by accepted_at desc limit 1`;
    await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${host.sessionId}`;
    expect(await previewNextWeekForTool(setupDeps, {
      auth: { principalId: host.hostAccountId, principalType: "user", attributes: { audience: "host_setup" } },
      sessionId: host.sessionId, callId: randomUUID(),
    })).toMatchObject({ queued: true });
    const [image] = await im.outbox({ hostAccountId: host.hostAccountId, kind: "image" });
    await im.send(image!.id, buttonsOn());

    expect((await tap(sender, `c:${ref}`)).outcome).toBe("command");
    expect(await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`).toHaveLength(1);
  });

  it("splits a long summary into text and a short question with the buttons, accepted on the interactive's ID", async () => {
    const { hostAccountId, sender } = await whatsAppHost();
    const binding = (await im.bindingOf(hostAccountId))!;
    const ref = "K7Q2MX";
    const buttons = { items: [{ id: `a:${ref}-1`, title: BUTTON_TITLES.approve }], prompt: `Decide on request ${ref}?` };
    const record = (dedupeKey: string) =>
      db.begin((tx) =>
        recordOutbound(tx, {
          bindingId: binding.id,
          buttons,
          dedupeKey,
          hostAccountId,
          kind: "notice",
          recipient: { address: sender, spaceId: sender },
          recipientHash: binding.sender_hash,
          text: "x".repeat(MAX_INTERACTIVE_BODY + 1),
          tokenKey: testTokenKey,
        }),
      );

    const split = await record(`notice:test:${binding.id}:split`);
    const { sent } = await im.send(split.id, buttonsOn());
    expect(sent.map((send) => send.content.kind)).toEqual(["text", "interactive"]);
    expect(sent[1]!.content).toEqual({ body: `Decide on request ${ref}?`, buttons: buttons.items, kind: "interactive" });
    const [accepted] = await db<{ state: string; provider_message_id: string }[]>`
      select state, provider_message_id from app.imessage_outbox where id = ${split.id}
    `;
    expect(accepted).toEqual({ provider_message_id: sent[1]!.messageId.replace("pmsg_", "wamid."), state: "accepted" });

    // The buttons fail after the text went out: the row stays accepted.
    photon.interactiveUnavailable();
    try {
      const partial = await record(`notice:test:${binding.id}:partial`);
      const { sent: partialSent } = await im.send(partial.id, buttonsOn());
      expect(partialSent.map((send) => send.content.kind)).toEqual(["text"]);
      expect((await db<{ state: string }[]>`select state from app.imessage_outbox where id = ${partial.id}`)[0]!.state).toBe("accepted");
    } finally {
      photon.interactiveUnavailable(false);
    }
  });
});
