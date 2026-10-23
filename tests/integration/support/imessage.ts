import { randomUUID } from "node:crypto";
import type { ConversationRuntime } from "../../../lib/server/conversations";
import type { Database } from "../../../lib/server/database";
import { runCommand } from "../../../lib/server/commands";
import { imessageCommands, readImessageStatus } from "../../../lib/server/imessage-links";
import { createImessageSendHandler, IMESSAGE_SEND_JOB, type ImessageSendDependencies } from "../../../lib/server/imessage-outbox";
import { createImessageReceiptHandler, type ImessageReceiptDependencies } from "../../../lib/server/imessage-receipts";
import { photonConfig } from "../../../lib/server/photon";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../../lib/server/photon-receiver";
import { linkMessage } from "../../../lib/contracts/imessage";
import { createGoogleUser } from "./auth";
import type { FakePhoton } from "./fake-photon";
import { type MessageFixture, messagesEvent, newSender, signedWebhook, TEST_LINE, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "./photon";
import { runJob, testTokenKey } from "./requests";

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
    db,
    env: {},
    tokenKey: testTokenKey,
    tokenKeys: [testTokenKey],
    ...options.receipt?.(),
  });
  const runtime: ConversationRuntime = options.runtime ?? {
    createSession: async () => "unused",
    readEvents: () => (async function* () {})(),
    readRecordedEvents: () => (async function* () {})(),
    sendMessage: async () => undefined,
  };
  const sendDeps = (): ImessageSendDependencies => ({
    config: config(),
    db,
    env: {},
    origin: "http://localhost:3000",
    runtime,
    signingKey: "s".repeat(40),
    tokenKeys: [testTokenKey],
  });
  const commands = (lineDayLimit = 1000) =>
    imessageCommands({ lineDayLimit, lineNumber: TEST_LINE, tokenKey: testTokenKey, tokenKeys: [testTokenKey] });

  return {
    config,
    receiptDeps,
    sendDeps,
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
  return sent.map((send) => (send.content.kind === "text" ? send.content.text : `[${send.content.kind}]`));
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
