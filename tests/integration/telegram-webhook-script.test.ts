import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error The operator script is plain JavaScript with no declarations.
import { profilePhotoFile, setUpTelegramWebhook } from "../../scripts/telegram-webhook.mjs";
import { type FakeTelegram, type FakeTelegramFile, startFakeTelegram } from "./support/fake-telegram";

// npm run telegram:webhook against the Bot API stand-in (host-telegram-channel
// task 2.4): it sets the production webhook with the secret, the three update
// types and ten connections, sets the command menu and Thyme's profile photo,
// prints getWebhookInfo
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
  it("sets the webhook, the commands and the profile photo, then prints the webhook info without the token", async () => {
    const { stdout } = await run(process.execPath, [script], { env: env() });

    expect(telegram.webhook).toEqual({
      allowedUpdates: ["message", "callback_query", "my_chat_member"],
      maxConnections: 10,
      secretToken: SECRET,
      url: "https://findmeatime.com/telegram/webhook",
    });
    expect(telegram.commands.map((item) => item.command)).toEqual(["requests", "review", "help", "stop"]);
    expect(telegram.calls.map((call) => call.method)).toEqual(["setWebhook", "setMyCommands", "setMyProfilePhoto", "getWebhookInfo"]);
    const [photoCall] = telegram.callsOf("setMyProfilePhoto");
    if (!photoCall) throw new Error("setMyProfilePhoto was not called.");
    const uploaded = photoCall.params.thyme as FakeTelegramFile;
    expect(JSON.parse(String(photoCall.params.photo))).toEqual({ photo: "attach://thyme", type: "static" });
    expect(uploaded).toMatchObject({ name: "blue-profile.jpg", type: "image/jpeg" });
    expect(uploaded.bytes.equals(readFileSync(profilePhotoFile("blue")))).toBe(true);
    expect(telegram.calls.every((call) => call.token === TOKEN)).toBe(true);
    expect(stdout).toContain('"url": "https://findmeatime.com/telegram/webhook"');
    expect(stdout).not.toContain(TOKEN);
    expect(stdout).not.toContain(SECRET);
  });

  it("--photo-only sets only the profile photo and needs no webhook secret", async () => {
    const before = telegram.calls.length;
    const { stdout } = await run(process.execPath, [script, "--photo-only"], { env: env({ TELEGRAM_WEBHOOK_SECRET: "" }) });

    expect(telegram.calls.slice(before).map((call) => call.method)).toEqual(["setMyProfilePhoto"]);
    expect(stdout).toContain("Profile photo set: blue-profile.jpg");
    expect(stdout).not.toContain(TOKEN);
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

  it("generates a missing secret into the env file without printing it, and stops before calling Telegram", async () => {
    const dir = mkdtempSync(join(tmpdir(), "telegram-webhook-"));
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "TELEGRAM_BOT_USERNAME=findmeatime_bot");
    const before = telegram.calls.length;
    const lines: string[] = [];
    try {
      const result = await setUpTelegramWebhook({ env: env({ TELEGRAM_WEBHOOK_SECRET: "" }), envFile, log: (line: string) => lines.push(line) });
      const saved = readFileSync(envFile, "utf8");
      const secret = /^TELEGRAM_WEBHOOK_SECRET=(.+)$/m.exec(saved)?.[1] ?? "";

      expect(result).toEqual({ generated: true });
      expect(saved.startsWith("TELEGRAM_BOT_USERNAME=findmeatime_bot\nTELEGRAM_WEBHOOK_SECRET=")).toBe(true);
      expect(secret).toMatch(/^[A-Za-z0-9_-]{48}$/);
      expect(lines.join("\n")).not.toContain(secret);
      expect(telegram.calls.length).toBe(before);

      // A second run with the line present but not loaded refuses to add another.
      await expect(setUpTelegramWebhook({ env: env({ TELEGRAM_WEBHOOK_SECRET: "" }), envFile, log: () => undefined })).rejects.toThrow(/already has/);
      expect(readFileSync(envFile, "utf8")).toBe(saved);
      expect(statSync(envFile).isFile()).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("exits 1 with the token scrubbed when Telegram refuses", async () => {
    telegram.next({ description: `Unauthorized ${TOKEN}`, status: 401 });
    const failed = await run(process.execPath, [script], { env: env() }).catch((error: { code: number; stdout: string; stderr: string }) => error);

    expect(failed).toMatchObject({ code: 1 });
    expect((failed as { stderr: string }).stderr).toContain("setWebhook was refused (401)");
    expect((failed as { stderr: string }).stderr).not.toContain(TOKEN);
  });
});
