import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error The operator script is plain JavaScript with no declarations.
import { setUpTelegramWebhook } from "../../scripts/telegram-webhook.mjs";
import { type FakeTelegram, startFakeTelegram } from "./support/fake-telegram";

// npm run telegram:webhook against the Bot API stand-in (host-telegram-channel
// task 2.4): it sets the production webhook with the secret, the three update
// types and ten connections, sets the command menu, prints getWebhookInfo
// without the token, and refuses any other host, a weak secret and a Bot API
// URL that is not a loopback stand-in before calling anything.

const run = promisify(execFile);
const script = fileURLToPath(new URL("../../scripts/telegram-webhook.mjs", import.meta.url));
const TOKEN = "987654:script_stand_in_token";
const SECRET = "s".repeat(40);
let telegram: FakeTelegram;

beforeAll(async () => {
  telegram = await startFakeTelegram();
});

afterAll(async () => {
  await telegram.close();
});

function env(overrides: Record<string, string> = {}) {
  return { PATH: process.env.PATH ?? "", TELEGRAM_API_URL: telegram.baseUrl, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, ...overrides };
}

describe("npm run telegram:webhook", () => {
  it("sets the webhook and the commands, then prints the webhook info without the token", async () => {
    const { stdout } = await run(process.execPath, [script], { env: env() });

    expect(telegram.webhook).toEqual({
      allowedUpdates: ["message", "callback_query", "my_chat_member"],
      maxConnections: 10,
      secretToken: SECRET,
      url: "https://findmeatime.com/telegram/webhook",
    });
    expect(telegram.commands.map((item) => item.command)).toEqual(["requests", "review", "help", "stop"]);
    expect(telegram.calls.map((call) => call.method)).toEqual(["setWebhook", "setMyCommands", "getWebhookInfo"]);
    expect(telegram.calls.every((call) => call.token === TOKEN)).toBe(true);
    expect(stdout).toContain('"url": "https://findmeatime.com/telegram/webhook"');
    expect(stdout).not.toContain(TOKEN);
    expect(stdout).not.toContain(SECRET);
  });

  it("refuses another host, a weak secret, a missing token and a remote API before calling anything", async () => {
    const before = telegram.calls.length;
    const refusals = [
      { argv: ["--origin", "https://staging.findmeatime.com"], env: env() },
      { argv: ["--origin", "http://localhost:3000"], env: env() },
      { argv: ["--origin", "http://findmeatime.com"], env: env() },
      { argv: [], env: env({ TELEGRAM_WEBHOOK_SECRET: "short" }) },
      { argv: [], env: env({ TELEGRAM_BOT_TOKEN: "" }) },
      { argv: [], env: env({ TELEGRAM_API_URL: "https://telegram.example.com" }) },
    ];

    for (const refusal of refusals) {
      await expect(setUpTelegramWebhook({ ...refusal, log: () => undefined })).rejects.toThrow();
    }
    expect(telegram.calls.length).toBe(before);
  });

  it("exits 1 with the token scrubbed when Telegram refuses", async () => {
    telegram.next({ description: `Unauthorized ${TOKEN}`, status: 401 });
    const failed = await run(process.execPath, [script], { env: env() }).catch((error: { code: number; stdout: string; stderr: string }) => error);

    expect(failed).toMatchObject({ code: 1 });
    expect((failed as { stderr: string }).stderr).toContain("setWebhook was refused (401)");
    expect((failed as { stderr: string }).stderr).not.toContain(TOKEN);
  });
});
