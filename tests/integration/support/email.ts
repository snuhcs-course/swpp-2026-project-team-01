import { randomBytes, randomUUID } from "node:crypto";
import type { MessageStreamEvent } from "eve/client";
import { agentMailConfigFromEnvironment } from "../../../lib/server/agentmail";
import {
  EMAIL_RECEIPT_JOB,
  receiveAgentMailWebhook,
  type ReceiverDependencies,
  secretFingerprint,
} from "../../../lib/server/agentmail-receiver";
import type { ConversationRuntime } from "../../../lib/server/conversations";
import type { Database } from "../../../lib/server/database";
import { createEmailReceiptHandler, type EmailReceiptDependencies } from "../../../lib/server/email-receipts";
import { createEmailReplyHandler, EMAIL_REPLY_JOB, type EmailReplyDependencies } from "../../../lib/server/email-replies";
import { recordInputReceived, recordTurnEnded } from "../../../lib/server/session-owner";
import { type FakeAgentMail, type InboundEmail, receivedMessage, webhookRequest } from "./fake-agentmail";
import { SIGNING_KEY } from "./guests";
import { runJob, testTokenKey } from "./requests";

// The email channel suites' shared harness: a product inbox with a registered
// receiver, a recording runtime whose sessions can be given recorded turn
// events, and helpers that deliver an email the way AgentMail would (stored at
// the fake, signed to the receiver, then the receipt job run) and run a reply.

export type EmailHarness = ReturnType<typeof emailHarness>;

export function emailHarness(db: Database, agentmail: () => FakeAgentMail) {
  const inbox = `fmat-${randomUUID().slice(0, 8)}@agentmail.test`;
  const secret = `whsec_${randomBytes(24).toString("base64")}`;
  const sessions = new Map<string, { sent: { message: string }[]; events: MessageStreamEvent[] }>();
  let receiverId = "";

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

  const config = () => ({ ...agentMailConfigFromEnvironment({}), apiKey: "am_test_key", baseUrl: agentmail().baseUrl, inboxId: inbox });

  const receiptDeps = (overrides: Partial<EmailReceiptDependencies> = {}): EmailReceiptDependencies => ({
    config: config(),
    conversation: { admission: { serviceKey: `test:${randomUUID()}` }, db, runtime, signingKey: SIGNING_KEY },
    creationLimits: { perSourceDay: 1000, perSourceHour: 1000, serviceDay: 100000 },
    db,
    origin: "http://localhost:3000",
    tokenKey: testTokenKey,
    ...overrides,
  });

  const replyDeps = (overrides: Partial<EmailReplyDependencies> = {}): EmailReplyDependencies => ({
    config: config(),
    db,
    runtime,
    signingKey: SIGNING_KEY,
    tokenKeys: [testTokenKey],
    ...overrides,
  });

  return {
    config,
    inbox,
    receiptDeps,
    replyDeps,
    runtime,
    secret,
    sessions,
    async register() {
      const [row] = await db<{ id: string }[]>`
        select result_receiver_id as id from app.operator_register_email_receiver(${inbox}, 'ep_test', ${secretFingerprint(secret)}, 'tester', 'local')
      `;
      receiverId = row!.id;
      return receiverId;
    },
    // Delivers an email as AgentMail would and runs its receipt job.
    async deliver(email: InboundEmail, deps: EmailReceiptDependencies = receiptDeps()) {
      const message = receivedMessage(inbox, email);
      agentmail().addMessage(message);
      const receiver: ReceiverDependencies = { config: { inboxId: inbox, secret }, db };
      const response = await receiveAgentMailWebhook(webhookRequest("http://localhost/agentmail/webhooks/x", secret, message), receiverId, () => receiver);
      if (response.status !== 204) throw new Error(`The receiver answered ${response.status}.`);

      const [receipt] = await db<{ id: string }[]>`select id from app.email_receipts where inbox_id = ${inbox} and message_id = ${message.message_id}`;
      const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${EMAIL_RECEIPT_JOB} and dedupe_key = ${`receipt:${receipt!.id}`}`;
      const result = await runJob(db, job!.id, createEmailReceiptHandler(() => deps));
      const [after] = await db<{ outcome: string | null }[]>`select outcome from app.email_receipts where id = ${receipt!.id}`;
      return { jobId: job!.id, message, outcome: after!.outcome, receiptId: receipt!.id, result };
    },
    async runReply(replyId: string, deps: EmailReplyDependencies = replyDeps()) {
      const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${EMAIL_REPLY_JOB} and dedupe_key = ${`reply:${replyId}`}`;
      await db`update app.jobs set run_after = now() where id = ${job!.id}`;
      return runJob(db, job!.id, createEmailReplyHandler(() => deps));
    },
    // What the session-owner hook records when the turn that served the input ends.
    async endTurn(inputId: string, finalText: string | null) {
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
    },
    async bindingOf(threadId: string) {
      const [row] = await db<{ id: string; request_id: string; origin: string; sender_hash: string; state: string }[]>`
        select id, request_id, origin, sender_hash, state from app.email_threads where inbox_id = ${inbox} and thread_id = ${threadId} order by bound_at desc limit 1
      `;
      return row ?? null;
    },
    async inputsOf(requestId: string) {
      return db<{ id: string; message: string; state: string; session_id: string | null }[]>`
        select i.id, i.message, i.state, i.session_id from app.conversation_inputs i
        join app.discussions d on d.id = i.discussion_id
        where d.principal_type = 'requester_request' and d.principal_id = ${requestId}
        order by i.accepted_at
      `;
    },
    async repliesFor(threadId: string) {
      return db<{ id: string; kind: string; state: string; text: string | null; input_id: string | null }[]>`
        select e.id, e.kind, e.state, e.text, e.input_id from app.email_replies e
        where e.inbox_id = ${inbox} and e.reply_to_message_id in (select message_id from app.email_receipts where thread_id = ${threadId})
        order by e.created_at
      `;
    },
  };
}
