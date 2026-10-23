import { randomUUID } from "node:crypto";
import type { MessageStreamEvent } from "eve/client";
import type { ConversationRuntime } from "../../../lib/server/conversations";
import type { Database } from "../../../lib/server/database";
import { runCommand } from "../../../lib/server/commands";
import { imessageCommands, readImessageStatus } from "../../../lib/server/imessage-links";
import { createImessageSendHandler, IMESSAGE_SEND_JOB, type ImessageSendDependencies, wakeImessageReplies } from "../../../lib/server/imessage-outbox";
import { recordInputReceived, recordTurnEnded } from "../../../lib/server/session-owner";
import { createImessageReceiptHandler, type ImessageReceiptDependencies } from "../../../lib/server/imessage-receipts";
import { photonConfig } from "../../../lib/server/photon";
import type { SetupDependencies } from "../../../lib/server/setup";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../../lib/server/photon-receiver";
import { linkMessage } from "../../../lib/contracts/imessage";
import { createGoogleUser } from "./auth";
import { SIGNING_KEY } from "./guests";
import type { FakePhoton } from "./fake-photon";
import { type MessageFixture, messagesEvent, newSender, signedWebhook, TEST_LINE, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "./photon";
import { runJob, testNotices, testTokenKey } from "./requests";

// The iMessage suites' shared harness: delivers a message the way Photon would
// (signed to the receiver, then the receipt job run), runs the card's commands
// as a host, reads the card's status, and runs outbound sends against the
// stand-in.

export type ImessageHarness = ReturnType<typeof imessageHarness>;

export function imessageHarness(
  db: Database,
  photon: () => FakePhoton,
  options: { readonly runtime?: ConversationRuntime; readonly receipt?: () => Partial<ImessageReceiptDependencies> } = {},
) {
  const config = () => ({ ...photonConfig({}), apiUrl: photon().baseUrl, lineNumber: TEST_LINE });
  const receiptDeps = (): ImessageReceiptDependencies => ({
    config: config(),
    conversation: { admission: { serviceKey: admissionKey }, db, runtime, signingKey: SIGNING_KEY },
    db,
    env: {},
    notices: testNotices,
    origin: "http://localhost:3000",
    setup: unreachableSetup(db),
    tokenKey: testTokenKey,
    tokenKeys: [testTokenKey],
    ...options.receipt?.(),
  });
  // A recording runtime whose sessions can be given a turn's recorded events.
  const sessions = new Map<string, { sent: { message: string }[]; events: MessageStreamEvent[] }>();
  const runtime: ConversationRuntime = options.runtime ?? {
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
      sessions.get(sessionId)?.sent.push({ message });
    },
  };
  const admissionKey = `test:${randomUUID()}`;
  const sendDeps = (): ImessageSendDependencies => ({
    config: config(),
    db,
    env: {},
    origin: "http://localhost:3000",
    runtime,
    signingKey: SIGNING_KEY,
    tokenKeys: [testTokenKey],
  });
  const commands = (lineDayLimit = 1000) =>
    imessageCommands({ lineDayLimit, lineNumber: TEST_LINE, tokenKey: testTokenKey, tokenKeys: [testTokenKey] });

  return {
    config,
    receiptDeps,
    runtime,
    sendDeps,
    sessions,
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
      await wakeImessageReplies(db, sessionId);
    },
    async inputsOf(hostAccountId: string) {
      return db<{ id: string; message: string; state: string; session_id: string | null; request_id: string | null }[]>`
        select i.id, i.message, i.state, i.session_id, d.request_id from app.conversation_inputs i
        join app.discussions d on d.id = i.discussion_id
        where d.principal_type = 'host_account' and d.principal_id = ${hostAccountId}
        order by i.accepted_at
      `;
    },
    // Stores a message as the receiver would, without running its job.
    async store(fixture: MessageFixture & { readonly sender: string }) {
      const id = fixture.id ?? `msg_${randomUUID()}`;
      const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ ...fixture, id })), () => ({
        config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID },
        db,
        tokenKey: testTokenKey,
      }));
      if (response.status !== 200) throw new Error(`The receiver answered ${response.status}.`);
      return (await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`)[0]!.id;
    },
    // Processes a stored receipt, then puts it back as a rolled-back job would
    // leave it (unprocessed, its sealed values intact) and processes it again.
    async processTwice(receiptId: string) {
      const [before] = await db<{ text_ciphertext: string | null; sender_ciphertext: string; space_ciphertext: string }[]>`
        select text_ciphertext, sender_ciphertext, space_ciphertext from app.imessage_receipts where id = ${receiptId}
      `;
      await this.runReceipt(receiptId);
      await db`
        update app.imessage_receipts
        set outcome = null, processed_at = null, text_ciphertext = ${before!.text_ciphertext},
            sender_ciphertext = ${before!.sender_ciphertext}, space_ciphertext = ${before!.space_ciphertext}
        where id = ${receiptId}
      `;
      await db`update app.jobs set state = 'pending' where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receiptId}`}`;
      return this.runReceipt(receiptId);
    },
    // Delivers a message as Photon would and runs its receipt job once.
    async deliver(fixture: MessageFixture & { readonly sender: string }, deps: ImessageReceiptDependencies = receiptDeps()) {
      const id = fixture.id ?? `msg_${randomUUID()}`;
      const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ ...fixture, id })), () => ({
        config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID },
        db,
        tokenKey: testTokenKey,
      }));
      if (response.status !== 200) throw new Error(`The receiver answered ${response.status}.`);
      const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`;
      const result = await this.runReceipt(receipt!.id, deps);
      const [after] = await db<{ outcome: string | null }[]>`select outcome from app.imessage_receipts where id = ${receipt!.id}`;
      return { messageId: id, outcome: after!.outcome, receiptId: receipt!.id, result };
    },
    async runReceipt(receiptId: string, deps: ImessageReceiptDependencies = receiptDeps()) {
      const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receiptId}`}`;
      await db`update app.jobs set run_after = now() where id = ${job!.id} and state = 'pending'`;
      return runJob(db, job!.id, createImessageReceiptHandler(() => deps));
    },
    async command(hostAccountId: string, operation: string, input: unknown = {}, retryKey: string = randomUUID(), lineDayLimit?: number) {
      return runCommand(
        { authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db },
        commands(lineDayLimit)[operation]!,
        { input, resourceId: hostAccountId, retryKey },
      );
    },
    status(hostAccountId: string) {
      return readImessageStatus(db, [testTokenKey], hostAccountId, TEST_LINE);
    },
    async outbox(where: { readonly hostAccountId?: string; readonly kind?: string; readonly recipientHash?: string } = {}) {
      return db<{ id: string; kind: string; state: string; binding_id: string | null; request_id: string | null; created_at: Date }[]>`
        select id, kind, state, binding_id, request_id, created_at from app.imessage_outbox
        where (${where.hostAccountId ?? null}::uuid is null or host_account_id = ${where.hostAccountId ?? null})
          and (${where.kind ?? null}::text is null or kind = ${where.kind ?? null})
          and (${where.recipientHash ?? null}::text is null or recipient_hash = ${where.recipientHash ?? null})
        order by created_at
      `;
    },
    // Sends one queued outbox message through the stand-in and returns what it sent.
    async send(outboxId: string, deps: ImessageSendDependencies = sendDeps()) {
      const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${outboxId}`}`;
      await db`update app.jobs set run_after = now() where id = ${job!.id} and state = 'pending'`;
      const before = photon().sends.length;
      const result = await runJob(db, job!.id, createImessageSendHandler(() => deps));
      return { result, sent: photon().sends.slice(before) };
    },
    // Links a sender to the host the way the card and the host's message do.
    async link(hostAccountId: string, sender: string = newSender()) {
      await this.command(hostAccountId, "imessage.link.create");
      const pending = await this.status(hostAccountId);
      if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
      await this.deliver({ sender, text: linkMessage(pending.code) });
      const received = await this.status(hostAccountId);
      if (received.state !== "received") throw new Error(`Expected a received code, got ${received.state}.`);
      const confirmed = await this.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId });
      if (!confirmed.ok) throw new Error("Confirming the link failed.");
      return { hostAccountId, message: linkMessage(pending.code), sender };
    },
    async bindingOf(hostAccountId: string) {
      const [row] = await db<{ id: string; state: string; sender_hash: string; space_ciphertext: string | null; selected_request_id: string | null }[]>`
        select id, state, sender_hash, space_ciphertext, selected_request_id from app.imessage_bindings
        where host_account_id = ${hostAccountId} order by linked_at desc limit 1
      `;
      return row ?? null;
    },
  };
}

export function textOf(sent: { readonly content: { readonly kind: string; readonly text?: string } }[]) {
  return sent.map((send) => (send.content.kind === "text" ? (send.content.text ?? "") : `[${send.content.kind}]`));
}

// A host account behind a real local Auth user and Google identity, as sign-in
// leaves it, so the channel can act as that host's user.
export async function hostWithUser(db: Database) {
  const user = await createGoogleUser(db);
  const [account] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;
  await db`
    insert into app.google_identities (google_subject, host_account_id, auth_user_id, email)
    values (${user.googleSubject}, ${account!.id}, ${user.userId}, ${user.email})
  `;
  return { hostAccountId: account!.id, userId: user.userId };
}

// Setup dependencies whose Google endpoints refuse connections, for suites that
// never read a calendar; suites that confirm settings pass a fake Google's.
export function unreachableSetup(db: Database): SetupDependencies {
  return {
    appOrigin: "http://localhost:3000",
    calendar: {
      config: { apiBaseUrl: "http://127.0.0.1:9/calendar/v3", clientId: "client", clientSecret: "secret", timeoutMs: 1_000, tokenUrl: "http://127.0.0.1:9/token" },
      db,
      tokenKeys: [testTokenKey],
    },
    db,
  };
}
