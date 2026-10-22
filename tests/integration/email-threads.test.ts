import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentMailTransport, senderHash } from "../../lib/server/agentmail";
import { AdmissionLimitError } from "../../lib/server/conversation-admission";
import { createEmailReceiptHandler, FIXED_REPLIES } from "../../lib/server/email-receipts";
import { EMAIL_RECEIPT_JOB, receiveAgentMailWebhook } from "../../lib/server/agentmail-receiver";
import { testDatabase } from "./support/database";
import { emailHarness } from "./support/email";
import { type FakeAgentMail, receivedMessage, startFakeAgentMail, webhookRequest } from "./support/fake-agentmail";
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
let agentmail: FakeAgentMail;
const email = emailHarness(db, () => agentmail);
const { bindingOf, config, deliver, endTurn, inbox, inputsOf, receiptDeps, repliesFor, replyDeps, runReply, runtime } = email;

beforeAll(async () => {
  agentmail = await startFakeAgentMail();
  await email.register();
});

afterAll(async () => {
  await agentmail?.close();
  await db.end();
});

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

  it("sends the fallback when the session failed for good, and redacts the turn's text", async () => {
    const failed = await startRequest();
    const [input] = await inputsOf(failed.binding.request_id);
    const [waiting] = await repliesFor(failed.message.thread_id);
    await db`update app.agent_sessions set state = 'failed' where session_id = ${input!.session_id}`;
    expect(await runReply(waiting!.id)).toBe("completed");
    expect(agentmail.repliesIn(failed.message.thread_id)[0]!.text).toMatch(/^I could not finish a reply\./);

    const leaky = await startRequest();
    const [leakyInput] = await inputsOf(leaky.binding.request_id);
    const [leakyReply] = await repliesFor(leaky.message.thread_id);
    await endTurn(leakyInput!.id, `Open https://findmeatime.com/booking/${randomUUID()} now.`);
    expect(await runReply(leakyReply!.id)).toBe("completed");
    expect(agentmail.repliesIn(leaky.message.thread_id)[0]!.text).toMatch(/^Open \[removed credential\] now\./);
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

describe("ordering and auto-replies", () => {
  it("ignores auto-replies and bulk mail from the bound sender", async () => {
    const address = uniqueEmail("auto");
    const { binding, message: first } = await startRequest(`Grace <${address}>`);
    const autoHeaders: Record<string, string>[] = [{ "Auto-Submitted": "auto-replied" }, { Precedence: "bulk" }, { "X-Autoreply": "yes" }];
    for (const headers of autoHeaders) {
      const { outcome } = await deliver({ from: `Grace <${address}>`, headers, inReplyTo: first.message_id, text: "I am out of office.", threadId: first.thread_id });
      expect(outcome).toBe("ignored");
    }
    expect(await inputsOf(binding.request_id)).toHaveLength(1);
  });

  it("refuses DMARC that speaks for another domain", async () => {
    const host = await readyHost(db);
    const { outcome } = await deliver({
      authenticationResults: { dmarc: "pass", dmarc_domain: "elsewhere.example" },
      from: `Spoof <${uniqueEmail()}>`,
      subject: `Meeting with @${host.handle}`,
      text: "Hello",
    });
    expect(outcome).toBe("ignored");
  });

  it("holds a reply that arrives before its thread's first message is processed", async () => {
    const host = await readyHost(db);
    const address = uniqueEmail("order");
    const first = receivedMessage(inbox, { from: `Grace <${address}>`, subject: `Meeting with @${host.handle}`, text: "Hello" });
    agentmail.addMessage(first);
    const receiver = { config: { inboxId: inbox, secret: email.secret }, db };
    await receiveAgentMailWebhook(webhookRequest("http://localhost/x", email.secret, first), email.receiverId(), () => receiver);

    // The reply's receipt is processed while the first one still waits.
    const early = await deliver({ from: `Grace <${address}>`, inReplyTo: first.message_id, text: "Also, 30 minutes.", threadId: first.thread_id });
    expect(early.result).toBe("failed");
    expect(early.outcome).toBeNull();

    const [firstReceipt] = await db<{ id: string }[]>`select id from app.email_receipts where message_id = ${first.message_id}`;
    const [firstJob] = await db<{ id: string }[]>`select id from app.jobs where kind = ${EMAIL_RECEIPT_JOB} and dedupe_key = ${`receipt:${firstReceipt!.id}`}`;
    expect(await runJob(db, firstJob!.id, createEmailReceiptHandler(() => receiptDeps()))).toBe("completed");

    await db`update app.jobs set run_after = now() where id = ${early.jobId}`;
    expect(await runJob(db, early.jobId, createEmailReceiptHandler(() => receiptDeps()))).toBe("completed");
    const binding = (await bindingOf(first.thread_id))!;
    expect((await inputsOf(binding.request_id)).map((input) => input.message)).toEqual([expect.stringContaining("Hello"), "Also, 30 minutes."]);
  });

  it("answers a started thread once when its first message could not be processed", async () => {
    const host = await readyHost(db);
    const limited = receiptDeps({
      conversation: { admission: { limits: { scopeHour: 0, scopeMinute: 0 }, serviceKey: `test:${randomUUID()}` }, db, runtime, signingKey: SIGNING_KEY },
    });
    const { jobId, message, receiptId } = await deliver({ from: `Grace <${uniqueEmail("stuck")}>`, subject: `Meeting with @${host.handle}`, text: "Hello" }, limited);
    expect((await bindingOf(message.thread_id))!.origin).toBe("started");

    // The last attempt fails too.
    await db`update app.jobs set attempts = max_attempts - 1, run_after = now() where id = ${jobId}`;
    expect(await runJob(db, jobId, createEmailReceiptHandler(() => limited))).toBe("exhausted");

    const [receipt] = await db<{ outcome: string }[]>`select outcome from app.email_receipts where id = ${receiptId}`;
    expect(receipt!.outcome).toBe("ignored");
    const replies = await repliesFor(message.thread_id);
    expect(replies.map((entry) => entry.kind)).toEqual(["unprocessed"]);
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
