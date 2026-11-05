import { randomUUID } from "node:crypto";
import type { Database } from "../../../lib/server/database";
import { bindingContext } from "../../../lib/server/imessage-links";
import { createImessageNoticeHandler } from "../../../lib/server/imessage-notice-job";
import { IMESSAGE_NOTICE_JOB, TELEGRAM_BUTTONS_JOB } from "../../../lib/server/imessage-notices";
import { createImessageSendHandler, IMESSAGE_SEND_JOB, type ImessageSendDependencies } from "../../../lib/server/imessage-outbox";
import { channelHash, IMESSAGE_RECEIPT_JOB } from "../../../lib/server/photon-receiver";
import { telegramConfig } from "../../../lib/server/telegram";
import { createTelegramButtonsHandler, createTelegramTypingHandler, TELEGRAM_TYPING_JOB } from "../../../lib/server/telegram-jobs";
import { receiveTelegramWebhook } from "../../../lib/server/telegram-receiver";
import { sealToken } from "../../../lib/server/token-encryption";
import type { FakeTelegram, FakeTelegramCall } from "./fake-telegram";
import type { ImessageHarness } from "./imessage";
import { runJob, testTokenKey } from "./requests";
import { newTelegramUser, telegramDelivery, TEST_TELEGRAM_SECRET } from "./telegram";

// The Telegram suites' harness (host-telegram-channel Lane C): binds a Telegram
// account to a host as **Confirm and link** leaves it (linking itself is Lane
// B's), delivers updates through the real webhook receiver and runs their receipt
// job, runs Telegram's follow-up jobs, and sends outbox rows through the Bot API
// stand-in. The one-second chat spacing is covered by the outbox suite, so sends
// here start without waiting for it.

export const TEST_BOT_TOKEN = "123456:lane_c_stand_in_token";

export function telegramHarness(db: Database, im: ImessageHarness, telegram: () => FakeTelegram) {
  const sendDeps = (): ImessageSendDependencies => ({
    ...im.sendDeps(),
    telegram: telegramConfig({ TELEGRAM_API_URL: telegram().baseUrl, TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN }),
  });
  const receiver = () => ({ config: { secret: TEST_TELEGRAM_SECRET }, db, tokenKey: testTokenKey });
  const jobDeps = () => ({ db, tokenKey: testTokenKey, tokenKeys: [testTokenKey] });

  async function due(kind: string, where: string) {
    return db<{ id: string }[]>`
      select id from app.jobs where kind = ${kind} and state = 'pending' and (dedupe_key = ${where} or payload ->> 'requestId' = ${where}
        or payload ->> 'hostAccountId' = ${where} or payload ->> 'turnOutboxId' = ${where})
      order by created_at
    `;
  }

  return {
    sendDeps,
    hash: (userId: number | string) => channelHash(testTokenKey, "telegram", "sender", String(userId)),
    // An active Telegram binding for the host, as confirmation leaves it.
    async bind(hostAccountId: string, userId: number = newTelegramUser()) {
      const chatId = String(userId);
      const id = randomUUID();
      await db`
        insert into app.imessage_bindings (id, channel, host_account_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id)
        values (${id}, 'telegram', ${hostAccountId}, ${channelHash(testTokenKey, "telegram", "sender", chatId)},
                ${sealToken(testTokenKey, chatId, bindingContext(id)).ciphertext}, ${sealToken(testTokenKey, chatId, bindingContext(id)).ciphertext},
                ${testTokenKey.id})
      `;
      return { bindingId: id, chatId, userId };
    },
    // Stores an update as the webhook would, without running its job.
    async store(body: string) {
      const response = await receiveTelegramWebhook(telegramDelivery(body), receiver);
      if (response.status !== 200) throw new Error(`The receiver answered ${response.status}.`);
      const updateId = (JSON.parse(body) as { update_id: number }).update_id;
      const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${`update:${updateId}`}`;
      return receipt?.id ?? null;
    },
    // Delivers an update through the webhook and runs its receipt job once.
    async deliver(body: string) {
      const receiptId = await this.store(body);
      if (!receiptId) return { outcome: null, receiptId: null };
      await im.runReceipt(receiptId);
      const [after] = await db<{ outcome: string | null }[]>`select outcome from app.imessage_receipts where id = ${receiptId}`;
      return { outcome: after!.outcome, receiptId };
    },
    // Puts a processed receipt back as a rolled-back job would leave it and runs it again.
    async processTwice(receiptId: string) {
      const [before] = await db<{ text_ciphertext: string | null; sender_ciphertext: string; space_ciphertext: string }[]>`
        select text_ciphertext, sender_ciphertext, space_ciphertext from app.imessage_receipts where id = ${receiptId}
      `;
      await im.runReceipt(receiptId);
      await db`
        update app.imessage_receipts
        set outcome = null, processed_at = null, text_ciphertext = ${before!.text_ciphertext},
            sender_ciphertext = ${before!.sender_ciphertext}, space_ciphertext = ${before!.space_ciphertext}
        where id = ${receiptId}
      `;
      await db`update app.jobs set state = 'pending' where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receiptId}`}`;
      return im.runReceipt(receiptId);
    },
    // Runs the pending host notice jobs of a request.
    async runNotices(requestId: string) {
      const handler = createImessageNoticeHandler(() => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] }));
      for (const job of await due(IMESSAGE_NOTICE_JOB, requestId)) await runJob(db, job.id, handler);
    },
    // Runs the pending button-retirement jobs of a request or a host.
    async runRetirement(requestOrHostId: string) {
      const jobs = await due(TELEGRAM_BUTTONS_JOB, requestOrHostId);
      for (const job of jobs) await runJob(db, job.id, createTelegramButtonsHandler(jobDeps));
      return jobs.length;
    },
    // Runs the due typing repeats of a waiting reply, as the worker would every five seconds.
    async runTyping(turnOutboxId: string) {
      const jobs = await due(TELEGRAM_TYPING_JOB, turnOutboxId);
      for (const job of jobs) {
        await db`update app.jobs set run_after = now() where id = ${job.id}`;
        await runJob(db, job.id, createTelegramTypingHandler(jobDeps));
      }
      return jobs.length;
    },
    // Sends one outbox row through the stand-in and returns the Bot API calls it made.
    async send(outboxId: string): Promise<FakeTelegramCall[]> {
      const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${outboxId}`}`;
      await db`update app.jobs set run_after = now() where id = ${job!.id} and state = 'pending'`;
      await db`update app.imessage_outbox set dispatched_at = dispatched_at - interval '1 minute' where channel = 'telegram' and dispatched_at is not null`;
      const before = telegram().calls.length;
      await runJob(db, job!.id, createImessageSendHandler(sendDeps));
      return telegram().calls.slice(before);
    },
    // Sends every queued row to the user, in the order recorded, and returns the calls made.
    async flush(userId: number | string) {
      const rows = await db<{ id: string }[]>`
        select id from app.imessage_outbox
        where recipient_hash = ${channelHash(testTokenKey, "telegram", "sender", String(userId))} and state = 'queued'
        order by created_at, id
      `;
      const calls: FakeTelegramCall[] = [];
      for (const row of rows) calls.push(...(await this.send(row.id)));
      return calls;
    },
    async outbox(userId: number | string) {
      return db<{ id: string; kind: string; state: string; dedupe_key: string; buttons: unknown; provider_message_id: string | null; failure_category: string | null }[]>`
        select id, kind, state, dedupe_key, buttons, provider_message_id, failure_category from app.imessage_outbox
        where recipient_hash = ${channelHash(testTokenKey, "telegram", "sender", String(userId))}
        order by created_at, id
      `;
    },
  };
}

// The text of each sendMessage call.
export function sentTexts(calls: readonly FakeTelegramCall[]) {
  return calls.filter((call) => call.method === "sendMessage").map((call) => String(call.params.text));
}
