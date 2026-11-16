import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SlotPreview } from "../../lib/contracts/slot-preview";
import { channelReplies } from "../../lib/server/channel-texts";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { bindingContext } from "../../lib/server/imessage-links";
import { createImessageSendHandler, IMESSAGE_SEND_JOB, type ImessageSendDependencies, recordOutbound } from "../../lib/server/imessage-outbox";
import { photonConfig } from "../../lib/server/photon";
import { channelHash } from "../../lib/server/photon-receiver";
import { telegramClient, telegramConfig, telegramTransport } from "../../lib/server/telegram";
import { sealToken } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { type FakeTelegram, startFakeTelegram } from "./support/fake-telegram";
import { runJob, testTokenKey } from "./support/requests";
import { newTelegramUser } from "./support/telegram";

// Telegram sends through the outbox and the Bot API stand-in (host-telegram-
// channel task 2.3): a Telegram row goes out with sendMessage as plain text and
// keeps Telegram's message ID; a 403 fails it as blocked and ends its binding,
// suppressing what was queued; a 400 is a final refusal; a 429 returns the row
// and a new job sends it after retry_after without spending an attempt; a
// refused connection is unavailable and a lost answer uncertain, never resent;
// sends to one chat are a second apart; a preview is refused before any
// network access; and the slot preview goes out with sendPhoto as the timetable
// PNG with its caption, or as the caption alone, uncertain, when the image
// cannot be rendered (issue #211).

const db = testDatabase();
let photon: FakePhoton;
let telegram: FakeTelegram;
const TOKEN = "123456:stand_in_token";

beforeAll(async () => {
  photon = await startFakePhoton();
  telegram = await startFakeTelegram();
});

afterAll(async () => {
  await photon.close();
  await telegram.close();
  await db.end();
});

const runtime: ConversationRuntime = {
  createSession: async () => "unused",
  readEvents: () => (async function* () {})(),
  readRecordedEvents: () => (async function* () {})(),
  sendMessage: async () => undefined,
};

function deps(overrides: Partial<ImessageSendDependencies> = {}): ImessageSendDependencies {
  return {
    config: { ...photonConfig({}), apiUrl: photon.baseUrl },
    db,
    env: {},
    origin: "http://localhost:3000",
    runtime,
    signingKey: "x".repeat(40),
    telegram: telegramConfig({ TELEGRAM_API_URL: telegram.baseUrl, TELEGRAM_BOT_TOKEN: TOKEN }),
    tokenKeys: [testTokenKey],
    ...overrides,
  };
}

// An active Telegram binding for a new host, as confirmation leaves it.
async function bound() {
  const chatId = String(newTelegramUser());
  const [host] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;
  const id = randomUUID();
  const sealed = sealToken(testTokenKey, chatId, bindingContext(id));
  await db`
    insert into app.imessage_bindings (id, channel, host_account_id, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id)
    values (${id}, 'telegram', ${host!.id}, ${channelHash(testTokenKey, "telegram", "sender", chatId)}, ${sealed.ciphertext},
            ${sealToken(testTokenKey, chatId, bindingContext(id)).ciphertext}, ${testTokenKey.id})
  `;
  return { bindingId: id, chatId, hostAccountId: host!.id };
}

async function queue(text: string, to?: { bindingId: string; chatId: string; hostAccountId: string }) {
  const target = to ?? (await bound());
  const { id } = await db.begin((tx) =>
    recordOutbound(tx, {
      bindingId: target.bindingId,
      dedupeKey: `test:${randomUUID()}`,
      hostAccountId: target.hostAccountId,
      kind: "notice",
      recipient: { address: target.chatId, spaceId: target.chatId },
      recipientHash: channelHash(testTokenKey, "telegram", "sender", target.chatId),
      text,
      tokenKey: testTokenKey,
    }),
  );
  return { ...target, id };
}

const preview: SlotPreview = {
  days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((weekday, i) => ({
    date: `2026-11-${16 + i}`,
    open: i < 5 ? [{ end: "12:00", start: "10:00" }] : [],
    weekday: weekday as SlotPreview["days"][number]["weekday"],
  })),
  durationMinutes: 30,
  grid: { end: "22:00", start: "09:00" },
  meetingMode: "online",
  place: null,
  reviewRef: "AB12CD",
  timezone: "Asia/Seoul",
  travelMode: null,
  weekStart: "2026-11-16",
};

async function queueImage() {
  const target = await bound();
  const { id } = await db.begin((tx) =>
    recordOutbound(tx, {
      bindingId: target.bindingId,
      dedupeKey: `test:${randomUUID()}`,
      hostAccountId: target.hostAccountId,
      image: { language: "en", preview },
      kind: "image",
      recipient: { address: target.chatId, spaceId: target.chatId },
      recipientHash: channelHash(testTokenKey, "telegram", "sender", target.chatId),
      reviewHash: "a".repeat(64),
      tokenKey: testTokenKey,
    }),
  );
  return { ...target, id };
}

async function run(outboxId: string, dependencies = deps(), dedupeKey = `outbox:${outboxId}`) {
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${dedupeKey}`;
  await db`update app.jobs set run_after = now() where id = ${job!.id}`;
  return runJob(db, job!.id, createImessageSendHandler(() => dependencies));
}

async function rowOf(id: string) {
  const [row] = await db<{ channel: string; state: string; failure_category: string | null; provider_message_id: string | null }[]>`
    select channel, state, failure_category, provider_message_id from app.imessage_outbox where id = ${id}
  `;
  return row!;
}

const sentTo = (chatId: string) => telegram.callsOf("sendMessage").filter((call) => call.params.chat_id === chatId);

describe("imessage_send on Telegram", () => {
  it("sends a Telegram row with sendMessage as plain text and keeps its message ID", async () => {
    const { chatId, id } = await queue("Proposal K7Q2MX-2 is ready. <b>not bold</b>");
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ channel: "telegram", provider_message_id: expect.stringMatching(/^\d+$/), state: "accepted" });
    expect(sentTo(chatId)).toEqual([{ method: "sendMessage", params: { chat_id: chatId, text: "Proposal K7Q2MX-2 is ready. <b>not bold</b>" }, token: TOKEN }]);
    expect(photon.sends).toHaveLength(0);
  });

  it("fails a blocked send, ends the binding and suppresses what was queued for it", async () => {
    const first = await queue("One");
    const second = await queue("Two", first);
    telegram.block(first.chatId);

    expect(await run(first.id)).toBe("completed");
    expect(await rowOf(first.id)).toMatchObject({ failure_category: "blocked", state: "failed" });
    expect(await rowOf(second.id)).toMatchObject({ failure_category: "blocked", state: "suppressed" });
    const [binding] = await db<{ state: string; sender_ciphertext: string | null }[]>`
      select state, sender_ciphertext from app.imessage_bindings where id = ${first.bindingId}
    `;
    expect(binding).toEqual({ sender_ciphertext: null, state: "unlinked" });
    expect(await run(second.id)).toBe("completed");
    expect(sentTo(first.chatId)).toHaveLength(1);
  });

  it("records a 400 as a final refusal", async () => {
    const { id } = await queue("Hello");
    telegram.next({ status: 400 });
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ failure_category: "provider_rejected", state: "failed" });
    expect(await run(id)).toBe("not_due");
  });

  it("returns a rate-limited row and sends it once after retry_after, spending no attempt", async () => {
    const { chatId, id } = await queue("Hello");
    telegram.next({ retryAfter: 5, status: 429 });
    const before = Date.now();

    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ failure_category: "rate_limited", state: "queued" });
    const [retry] = await db<{ run_after: Date; attempts: number; payload: { rateLimits: number } }[]>`
      select run_after, attempts, payload from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${id}:rate:1`}
    `;
    expect(retry!.run_after.getTime()).toBeGreaterThanOrEqual(before + 4_000);
    expect(retry).toMatchObject({ attempts: 0, payload: { rateLimits: 1 } });

    expect(await run(id, deps(), `outbox:${id}:rate:1`)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ state: "accepted" });
    expect(sentTo(chatId)).toHaveLength(2);
  });

  it("returns the row when the Bot API refuses the connection, and never resends a lost answer", async () => {
    const refused = await queue("Hello");
    const vacant = await startFakeTelegram();
    await vacant.close();
    const closed = deps({ telegram: telegramConfig({ TELEGRAM_API_URL: vacant.baseUrl, TELEGRAM_BOT_TOKEN: TOKEN }) });
    expect(await run(refused.id, closed)).toBe("failed");
    expect(await rowOf(refused.id)).toMatchObject({ failure_category: "unavailable", state: "queued" });

    const lost = await queue("Hello");
    telegram.next("drop");
    expect(await run(lost.id)).toBe("completed");
    expect(await rowOf(lost.id)).toMatchObject({ state: "uncertain" });
    expect(sentTo(lost.chatId)).toHaveLength(1);

    const failing = await queue("Hello");
    telegram.next({ status: 502 });
    expect(await run(failing.id)).toBe("completed");
    expect(await rowOf(failing.id)).toMatchObject({ state: "uncertain" });
  });

  it("spaces consecutive sends to one chat at least a second apart", async () => {
    const first = await queue("One");
    const second = await queue("Two", first);
    const started = Date.now();

    await Promise.all([run(first.id), run(second.id)]);

    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(sentTo(first.chatId).map((call) => call.params.text).sort()).toEqual(["One", "Two"]);
  });

  it("sends the slot preview as the timetable PNG with sendPhoto and its caption", async () => {
    const { chatId, id } = await queueImage();
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ channel: "telegram", provider_message_id: expect.stringMatching(/^\d+$/), state: "accepted" });

    const photos = telegram.callsOf("sendPhoto").filter((call) => call.params.chat_id === chatId);
    expect(photos).toHaveLength(1);
    const photo = photos[0]!.params.photo as { name: string; type: string; bytes: Buffer };
    expect(photos[0]!.params.caption).toBe(channelReplies("en").onboarding.slotCaption(preview));
    expect(photos[0]!.params).not.toHaveProperty("parse_mode");
    expect({ name: photo.name, type: photo.type }).toEqual({ name: "slots-2026-11-16.png", type: "image/png" });
    expect(photo.bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(sentTo(chatId)).toHaveLength(0);
  });

  it("sends the caption alone and leaves the row uncertain when the image cannot be rendered", async () => {
    const { chatId, id } = await queueImage();
    const client = telegramClient(telegramConfig({ TELEGRAM_API_URL: telegram.baseUrl, TELEGRAM_BOT_TOKEN: TOKEN }), {});
    const broken = telegramTransport(client, undefined, async () => Promise.reject(new Error("no fonts")));

    expect(await run(id, deps({ telegramTransport: broken }))).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ state: "uncertain" });
    expect(sentTo(chatId).map((call) => call.params.text)).toEqual([channelReplies("en").onboarding.slotCaption(preview)]);
    expect(telegram.callsOf("sendPhoto").filter((call) => call.params.chat_id === chatId)).toHaveLength(0);
  });

  it("fails a slot preview the host blocked the bot for", async () => {
    const { chatId, id } = await queueImage();
    telegram.block(chatId);
    expect(await run(id)).toBe("completed");
    expect(await rowOf(id)).toMatchObject({ failure_category: "blocked", state: "failed" });
  });

  it("refuses a preview before any network access or outbound state", async () => {
    const { chatId, id } = await queue("Hello");
    const preview = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };
    expect(await run(id, deps({ env: preview }))).toBe("failed");
    expect(await rowOf(id)).toMatchObject({ state: "queued" });
    expect(sentTo(chatId)).toHaveLength(0);
  });
});
