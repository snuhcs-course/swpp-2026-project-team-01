import { randomBytes, randomUUID } from "node:crypto";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentMailConfigFromEnvironment, agentMailTransport, senderHash } from "../../lib/server/agentmail";
import {
  EMAIL_RECEIPT_JOB,
  receiveAgentMailWebhook,
  type ReceiverDependencies,
  secretFingerprint,
} from "../../lib/server/agentmail-receiver";
import { AdmissionLimitError } from "../../lib/server/conversation-admission";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { createEmailReceiptHandler, type EmailReceiptDependencies, FIXED_REPLIES } from "../../lib/server/email-receipts";
import { createEmailReplyHandler, EMAIL_REPLY_JOB, type EmailReplyDependencies } from "../../lib/server/email-replies";
import { recordInputReceived, recordTurnEnded } from "../../lib/server/session-owner";
import { testDatabase } from "./support/database";
import { type FakeAgentMail, type InboundEmail, receivedMessage, startFakeAgentMail, webhookRequest } from "./support/fake-agentmail";
import { readyHost, SIGNING_KEY } from "./support/guests";
import { closeTestRequest, runJob, testTokenKey, uniqueEmail } from "./support/requests";

// The requester email channel's Lane B against the local stack and a fake
// AgentMail (tasks 3.1 to 3.3): an authenticated email naming a ready host
// starts an identified request and binds its thread; the bound sender's replies
// become inputs of the same requester discussion, each answered in the thread
// with its turn's final text once the turn ends; other senders, spoofed mail,
// replies in unbound threads and our own messages do nothing; closed requests,
// over-long messages and unknown hosts get one fixed reply; a lost reply
// response is retried with the same Idempotency-Key, never past 23 hours; and
// the messaging gate refuses a preview before any provider call. The runtime is
// a recording stand-in; tests/integration/email-journey.test.ts runs a real eve.

const db = testDatabase();
const inbox = `fmat-${randomUUID().slice(0, 8)}@agentmail.test`;
const secret = `whsec_${randomBytes(24).toString("base64")}`;
let agentmail: FakeAgentMail;
let receiverId: string;

type Session = { sent: { message: string }[]; events: MessageStreamEvent[] };
const sessions = new Map<string, Session>();

const runtime: ConversationRuntime = {
  createSession: async () => {
    const id = `wrun_${randomUUID()}`;
    sessions.set(id, { events: [], sent: [] });
    return id;
  },
  readEvents: () => (async function* () {})(),
  readRecordedEvents: (sessionId) =>
    (async function* () {
      yield* sessions.get(sessionId)?.events ?? [];
    })(),
  sendMessage: async (sessionId, _bearer, message) => {
    sessions.get(sessionId)!.sent.push({ message });
  },
};

const config = () => ({ ...agentMailConfigFromEnvironment({}), apiKey: "am_test_key", baseUrl: agentmail.baseUrl, inboxId: inbox });

function receiptDeps(overrides: Partial<EmailReceiptDependencies> = {}): EmailReceiptDependencies {
  return {
    config: config(),
    conversation: { admission: { serviceKey: `test:${randomUUID()}` }, db, runtime, signingKey: SIGNING_KEY },
    creationLimits: { perSourceDay: 1000, perSourceHour: 1000, serviceDay: 100000 },
    db,
    origin: "http://localhost:3000",
    tokenKey: testTokenKey,
    ...overrides,
  };
}

function replyDeps(overrides: Partial<EmailReplyDependencies> = {}): EmailReplyDependencies {
  return { config: config(), db, runtime, signingKey: SIGNING_KEY, tokenKeys: [testTokenKey], ...overrides };
}

beforeAll(async () => {
  agentmail = await startFakeAgentMail();
  const [row] = await db<{ id: string }[]>`
    select result_receiver_id as id from app.operator_register_email_receiver(${inbox}, 'ep_test', ${secretFingerprint(secret)}, 'tester', 'local')
  `;
  receiverId = row!.id;
});

afterAll(async () => {
  await agentmail?.close();
  await db.end();
});

// Delivers an email as AgentMail would: stored at the fake, sent to the
// receiver, then the receipt job runs. Returns the message and the outcome.
async function deliver(email: InboundEmail, deps: EmailReceiptDependencies = receiptDeps()) {
  const message = receivedMessage(inbox, email);
  agentmail.addMessage(message);
  const receiver: ReceiverDependencies = { config: { inboxId: inbox, secret }, db };
  const response = await receiveAgentMailWebhook(webhookRequest("http://localhost/agentmail/webhooks/x", secret, message), receiverId, () => receiver);
  expect(response.status).toBe(204);

  const [receipt] = await db<{ id: string }[]>`select id from app.email_receipts where inbox_id = ${inbox} and message_id = ${message.message_id}`;
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${EMAIL_RECEIPT_JOB} and dedupe_key = ${`receipt:${receipt!.id}`}`;
  const result = await runJob(db, job!.id, createEmailReceiptHandler(() => deps));
  const [after] = await db<{ outcome: string | null }[]>`select outcome from app.email_receipts where id = ${receipt!.id}`;
  return { jobId: job!.id, message, outcome: after!.outcome, receiptId: receipt!.id, result };
}

async function bindingOf(threadId: string) {
  const [row] = await db<{ id: string; request_id: string; origin: string; sender_hash: string; state: string }[]>`
    select id, request_id, origin, sender_hash, state from app.email_threads where inbox_id = ${inbox} and thread_id = ${threadId}
  `;
  return row ?? null;
}

async function inputsOf(requestId: string) {
  return db<{ id: string; message: string; state: string; session_id: string | null }[]>`
    select i.id, i.message, i.state, i.session_id from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'requester_request' and d.principal_id = ${requestId}
    order by i.accepted_at
  `;
}

async function repliesFor(threadId: string) {
  return db<{ id: string; kind: string; state: string; text: string | null; input_id: string | null }[]>`
    select e.id, e.kind, e.state, e.text, e.input_id from app.email_replies e
    where e.inbox_id = ${inbox} and e.reply_to_message_id in (select message_id from app.email_receipts where thread_id = ${threadId})
    order by e.created_at
  `;
}

// What the session-owner hook records when the turn that served the input ends.
async function endTurn(inputId: string, finalText: string | null) {
  const [input] = await db<{ session_id: string }[]>`select session_id from app.conversation_inputs where id = ${inputId}`;
  const sessionId = input!.session_id;
  const deliveryId = `dlv_${randomUUID()}`;
  await recordInputReceived(db, sessionId, [deliveryId]);
  const meta = { at: new Date().toISOString(), deliveryIds: [deliveryId] };
  const events = sessions.get(sessionId)!.events;
  events.push({ data: { finishReason: "tool-calls", message: "Let me check.", sequence: 0, stepIndex: 0, turnId: "t" }, meta, type: "message.completed" } as unknown as MessageStreamEvent);
  if (finalText) {
    events.push({ data: { finishReason: "stop", message: finalText, sequence: 1, stepIndex: 1, turnId: "t" }, meta, type: "message.completed" } as unknown as MessageStreamEvent);
  }
  await recordTurnEnded(db, sessionId);
}

async function runReply(replyId: string, deps: EmailReplyDependencies = replyDeps()) {
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${EMAIL_REPLY_JOB} and dedupe_key = ${`reply:${replyId}`}`;
  await db`update app.jobs set run_after = now() where id = ${job!.id}`;
  return runJob(db, job!.id, createEmailReplyHandler(() => deps));
}

async function startRequest(from = `Grace Hopper <${uniqueEmail()}>`, text = "Could we meet for 30 minutes next week?") {
  const host = await readyHost(db);
  const delivered = await deliver({ from, subject: `Meeting with @${host.handle}`, text });
  const binding = await bindingOf(delivered.message.thread_id);
  return { ...delivered, binding: binding!, host };
}

describe("starting by email", () => {
  it("creates an identified request, binds the thread and forwards the first message", async () => {
    const address = uniqueEmail("starter");
    const { binding, host, message, outcome, receiptId } = await startRequest(`Grace Hopper <${address}>`);

    expect(outcome).toBe("started");
    expect(binding.origin).toBe("started");
    expect(binding.sender_hash).toBe(senderHash(testTokenKey, address));

    const [request] = await db<{ state: string; requester_name: string; contact_email: string; contact_confirmed_email: string | null; host_account_id: string }[]>`
      select state, requester_name, contact_email, contact_confirmed_email, host_account_id from app.requests where id = ${binding.request_id}
    `;
    expect(request).toMatchObject({ contact_confirmed_email: null, contact_email: address, host_account_id: host.hostAccountId, requester_name: "Grace Hopper", state: "gathering" });

    // The Phase 3 creation email goes to the sender's address.
    const deliveries = await db<{ kind: string; recipients: string[] }[]>`select kind, recipients from app.email_deliveries where request_id = ${binding.request_id}`;
    expect(deliveries).toEqual([{ kind: "request_creation", recipients: [address] }]);

    const inputs = await inputsOf(binding.request_id);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.message).toBe(`Subject: Meeting with @${host.handle}\n\nCould we meet for 30 minutes next week?`);
    expect(inputs[0]!.state).toBe("sent");
    const [clientInput] = await db<{ client_input_id: string }[]>`select client_input_id from app.conversation_inputs where id = ${inputs[0]!.id}`;
    expect(clientInput!.client_input_id).toBe(receiptId);

    const replies = await repliesFor(message.thread_id);
    expect(replies).toMatchObject([{ input_id: inputs[0]!.id, kind: "turn", state: "waiting" }]);
  });

  it("answers in the same thread with the turn's final text once the turn ends", async () => {
    const { binding, message } = await startRequest();
    const [input] = await inputsOf(binding.request_id);
    const [waiting] = await repliesFor(message.thread_id);

    // Before the turn ends the job only waits.
    expect(await runReply(waiting!.id)).toBe("failed");
    expect(agentmail.repliesIn(message.thread_id)).toHaveLength(0);

    await endTurn(input!.id, "Happy to help. How long should the meeting be?");
    expect(await runReply(waiting!.id)).toBe("completed");

    const [sent] = agentmail.repliesIn(message.thread_id);
    expect(sent!.inReplyTo).toBe(message.message_id);
    expect(sent!.idempotencyKey).toBe(waiting!.id);
    expect(sent!.text).toMatch(/^Happy to help\. How long should the meeting be\?\n\n--\nTo pick a time/);
    expect(sent!.text).not.toContain("Let me check");
    expect(sent!.text).not.toMatch(/booking\/[0-9a-f-]{36}/);

    const [after] = await repliesFor(message.thread_id);
    expect(after).toMatchObject({ state: "accepted", text: null });
  });

  it("sends a fixed fallback when the turn produced no final text", async () => {
    const { binding, message } = await startRequest();
    const [input] = await inputsOf(binding.request_id);
    const [waiting] = await repliesFor(message.thread_id);
    await endTurn(input!.id, null);
    expect(await runReply(waiting!.id)).toBe("completed");
    expect(agentmail.repliesIn(message.thread_id)[0]!.text).toMatch(/^I could not finish a reply\./);
  });

  it("replies once and creates nothing when no ready host is named", async () => {
    const before = await db<{ count: number }[]>`select count(*)::int as count from app.requests`;
    const { message, outcome } = await deliver({ from: `Someone <${uniqueEmail()}>`, subject: "Meeting with @nobody-here-at-all", text: "Hello" });
    expect(outcome).toBe("replied");
    const after = await db<{ count: number }[]>`select count(*)::int as count from app.requests`;
    expect(after[0]!.count).toBe(before[0]!.count);
    expect(await bindingOf(message.thread_id)).toBeNull();

    const [refusal] = await repliesFor(message.thread_id);
    expect(refusal!.kind).toBe("start_refusal");
    expect(await runReply(refusal!.id)).toBe("completed");
    expect(agentmail.repliesIn(message.thread_id)[0]!.text).toBe(FIXED_REPLIES.unknownHost.en);
  });

  it("starts nothing for an unauthenticated sender, our own inbox or a reply in an unbound thread", async () => {
    const host = await readyHost(db);
    const subject = `Meeting with @${host.handle}`;

    for (const email of [
      { authenticated: false, from: `Spoof <${uniqueEmail()}>`, subject, text: "Hello" },
      { from: `Spam <${uniqueEmail()}>`, labels: ["received", "spam"], subject, text: "Hello" },
      { from: `Find Me a Time <${inbox}>`, subject, text: "Loop" },
      { from: `Late <${uniqueEmail()}>`, inReplyTo: "<earlier@example.test>", subject, text: "Re: hello" },
    ]) {
      const { message, outcome } = await deliver(email);
      expect(outcome).toBe("ignored");
      expect(await bindingOf(message.thread_id)).toBeNull();
      expect(await repliesFor(message.thread_id)).toEqual([]);
    }
  });
});

describe("a bound thread", () => {
  it("forwards the bound sender's replies into the same discussion, once per receipt", async () => {
    const address = uniqueEmail("bound");
    const { binding, message: first } = await startRequest(`Grace <${address}>`);
    const { message, outcome, receiptId } = await deliver({
      from: `Grace <${address}>`,
      inReplyTo: first.message_id,
      subject: "Re: Meeting",
      text: "Thirty minutes, online.",
      threadId: first.thread_id,
    });
    expect(outcome).toBe("forwarded");

    // The job is retried after it forwarded but before it recorded its outcome.
    await db`update app.email_receipts set outcome = null, processed_at = null where id = ${receiptId}`;
    await db.begin((tx) => createEmailReceiptHandler(() => receiptDeps())(tx, { attempts: 1, fence: 0, id: randomUUID(), kind: EMAIL_RECEIPT_JOB, maxAttempts: 10, payload: { receiptId } }));

    const inputs = await inputsOf(binding.request_id);
    expect(inputs.map((input) => input.message)).toEqual([expect.stringContaining("Subject:"), "Thirty minutes, online."]);
    const replies = (await repliesFor(first.thread_id)).filter((entry) => entry.kind === "turn");
    expect(replies).toHaveLength(2);
    const [row] = await db<{ last_message_id: string }[]>`select last_message_id from app.email_threads where id = ${binding.id}`;
    expect(row!.last_message_id).toBe(message.message_id);
  });

  it("forwards nothing from another sender, a spoofed sender or after unlinking", async () => {
    const address = uniqueEmail("bound");
    const { binding, message: first } = await startRequest(`Grace <${address}>`);
    const reply = (from: string, authenticated = true) =>
      deliver({ authenticated, from, inReplyTo: first.message_id, subject: "Re: Meeting", text: "Book the 3pm slot.", threadId: first.thread_id });

    expect((await reply(`Copied <${uniqueEmail("cc")}>`)).outcome).toBe("ignored");
    expect((await reply(`Grace <${address}>`, false)).outcome).toBe("ignored");

    await db`update app.email_threads set state = 'unlinked', ended_at = now() where id = ${binding.id}`;
    expect((await reply(`Grace <${address}>`)).outcome).toBe("ignored");

    expect(await inputsOf(binding.request_id)).toHaveLength(1);
  });

  it("answers a closed request's thread once", async () => {
    const address = uniqueEmail("closed");
    const { binding, message: first } = await startRequest(`Grace <${address}>`);
    await closeTestRequest(db, binding.request_id);
    const reply = () => deliver({ from: `Grace <${address}>`, inReplyTo: first.message_id, text: "Still there?", threadId: first.thread_id });

    expect((await reply()).outcome).toBe("replied");
    expect((await reply()).outcome).toBe("ignored");
    const closed = (await repliesFor(first.thread_id)).filter((entry) => entry.kind === "closed");
    expect(closed).toHaveLength(1);
    expect(await inputsOf(binding.request_id)).toHaveLength(1);
  });

  it("asks for a shorter message instead of forwarding an over-long one", async () => {
    const address = uniqueEmail("long");
    const { binding, message: first } = await startRequest(`Grace <${address}>`);
    const { outcome } = await deliver({ from: `Grace <${address}>`, inReplyTo: first.message_id, text: "x".repeat(8001), threadId: first.thread_id });
    expect(outcome).toBe("replied");
    expect((await repliesFor(first.thread_id)).map((entry) => entry.kind)).toContain("too_long");
    expect(await inputsOf(binding.request_id)).toHaveLength(1);
  });

  it("keeps the receipt for a later attempt when admission is exhausted", async () => {
    const address = uniqueEmail("busy");
    const { binding, message: first } = await startRequest(`Grace <${address}>`);
    const limited = receiptDeps({
      conversation: { admission: { limits: { scopeHour: 0, scopeMinute: 0 }, serviceKey: `test:${randomUUID()}` }, db, runtime, signingKey: SIGNING_KEY },
    });
    const { jobId, outcome, result } = await deliver({ from: `Grace <${address}>`, inReplyTo: first.message_id, text: "One more thing.", threadId: first.thread_id }, limited);

    expect(result).toBe("failed");
    expect(outcome).toBeNull();
    const [job] = await db<{ state: string }[]>`select state from app.jobs where id = ${jobId}`;
    expect(job!.state).toBe("pending");
    expect(await inputsOf(binding.request_id)).toHaveLength(1);

    // The same error class the conversation path throws.
    expect(new AdmissionLimitError(60)).toBeInstanceOf(Error);
  });
});

describe("replies", () => {
  async function readyReply() {
    const { binding, message } = await startRequest();
    const [input] = await inputsOf(binding.request_id);
    const [waiting] = await repliesFor(message.thread_id);
    await endTurn(input!.id, "When are you free?");
    return { message, replyId: waiting!.id };
  }

  it("retries a lost response with the same key and sends one email", async () => {
    const { message, replyId } = await readyReply();
    agentmail.nextReply("drop");
    expect(await runReply(replyId)).toBe("failed");
    const [dispatching] = await db<{ state: string; text: string }[]>`select state, text from app.email_replies where id = ${replyId}`;
    expect(dispatching!.state).toBe("dispatching");

    expect(await runReply(replyId)).toBe("completed");
    expect(agentmail.attempts.filter((attempt) => attempt.idempotencyKey === replyId)).toHaveLength(2);
    expect(agentmail.repliesIn(message.thread_id)).toHaveLength(1);
    const [after] = await db<{ state: string; provider_message_id: string }[]>`select state, provider_message_id from app.email_replies where id = ${replyId}`;
    expect(after).toEqual({ provider_message_id: agentmail.repliesIn(message.thread_id)[0]!.messageId, state: "accepted" });
  });

  it("records uncertain without sending once the retry horizon passed", async () => {
    const { message, replyId } = await readyReply();
    agentmail.nextReply("drop");
    await runReply(replyId);
    await db`update app.email_replies set first_dispatched_at = now() - interval '24 hours' where id = ${replyId}`;
    const before = agentmail.attempts.length;

    expect(await runReply(replyId)).toBe("completed");
    expect(agentmail.attempts.length).toBe(before);
    const [after] = await db<{ state: string; text: string | null }[]>`select state, text from app.email_replies where id = ${replyId}`;
    expect(after).toEqual({ state: "uncertain", text: null });
    expect(agentmail.repliesIn(message.thread_id)).toHaveLength(1);
  });

  it("records a refusal as rejected", async () => {
    const { replyId } = await readyReply();
    agentmail.nextReply({ status: 403 });
    expect(await runReply(replyId)).toBe("completed");
    const [after] = await db<{ state: string }[]>`select state from app.email_replies where id = ${replyId}`;
    expect(after!.state).toBe("rejected");
  });

  it("suppresses a reply whose thread was unlinked", async () => {
    const { message, replyId } = await readyReply();
    await db`update app.email_threads set state = 'unlinked', ended_at = now() where inbox_id = ${inbox} and thread_id = ${message.thread_id}`;
    expect(await runReply(replyId)).toBe("completed");
    const [after] = await db<{ state: string }[]>`select state from app.email_replies where id = ${replyId}`;
    expect(after!.state).toBe("suppressed");
    expect(agentmail.repliesIn(message.thread_id)).toHaveLength(0);
  });

  it("is refused before any provider call in a preview, and leaves the reply untouched", async () => {
    const { message, replyId } = await readyReply();
    const preview = { VERCEL: "1", VERCEL_ENV: "preview" };
    expect(await runReply(replyId, replyDeps({ env: preview }))).toBe("failed");
    const [after] = await db<{ state: string; first_dispatched_at: Date | null }[]>`select state, first_dispatched_at from app.email_replies where id = ${replyId}`;
    expect(after).toEqual({ first_dispatched_at: null, state: "waiting" });
    expect(agentmail.repliesIn(message.thread_id)).toHaveLength(0);

    // The adapter refuses on its own as well.
    const transport = agentMailTransport(config(), preview);
    await expect(transport.reply(inbox, message.message_id, "x", randomUUID())).rejects.toThrow();
    await expect(transport.getMessage(inbox, message.message_id)).rejects.toThrow();
  });
});
