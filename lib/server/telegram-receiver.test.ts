import { describe, expect, it } from "vitest";
import type { Database } from "./database";
import { receiveTelegramWebhook, TELEGRAM_SECRET_HEADER, type TelegramReceiverDependencies, telegramSecretMatches } from "./telegram-receiver";

// The Telegram webhook's checks before anything is stored (host-telegram-channel
// design 2): the secret header, the body, and updates that create no work. The
// database is never touched on these paths; storing and duplicates run against
// the local stack in tests/integration/telegram-receiver.test.ts.

const secret = "tg_webhook_secret_0123456789_abcdefghij";

const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error("The database was touched.");
    },
  },
) as Database;

const load = (configured = secret) => (): TelegramReceiverDependencies => ({
  config: { secret: configured },
  db: untouched,
  tokenKey: { id: "k1", key: Buffer.alloc(32, 1) },
});

function delivery(body: string, header: string | null = secret) {
  return new Request("https://findmeatime.com/telegram/webhook", {
    body,
    headers: { "content-type": "application/json", ...(header === null ? {} : { [TELEGRAM_SECRET_HEADER]: header }) },
    method: "POST",
  });
}

describe("telegramSecretMatches", () => {
  it("accepts only the configured secret", () => {
    expect(telegramSecretMatches(secret, secret)).toBe(true);
    expect(telegramSecretMatches(secret, `${secret}x`)).toBe(false);
    expect(telegramSecretMatches(secret, "")).toBe(false);
    expect(telegramSecretMatches(secret, null)).toBe(false);
    expect(telegramSecretMatches("", "")).toBe(false);
  });
});

describe("receiveTelegramWebhook", () => {
  const group = JSON.stringify({ message: { chat: { id: -1, type: "group" }, from: { id: 1, is_bot: false }, text: "hi" }, update_id: 5 });

  it("answers 401 to a missing or wrong secret and to an unconfigured deployment", async () => {
    expect((await receiveTelegramWebhook(delivery(group, null), load())).status).toBe(401);
    expect((await receiveTelegramWebhook(delivery(group, "wrong"), load())).status).toBe(401);
    expect((await receiveTelegramWebhook(delivery(group, ""), load(""))).status).toBe(401);
  });

  it("answers 400 to a body that is not an update or is too large", async () => {
    expect((await receiveTelegramWebhook(delivery("not json"), load())).status).toBe(400);
    expect((await receiveTelegramWebhook(delivery('{"message":{}}'), load())).status).toBe(400);
    expect((await receiveTelegramWebhook(delivery(JSON.stringify({ pad: "x".repeat(300 * 1024), update_id: 1 })), load())).status).toBe(400);
  });

  it("answers 200 and stores nothing for groups and other update types", async () => {
    expect((await receiveTelegramWebhook(delivery(group), load())).status).toBe(200);
    expect((await receiveTelegramWebhook(delivery(JSON.stringify({ edited_message: {}, update_id: 6 })), load())).status).toBe(200);
  });
});
