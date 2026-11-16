// `npm run telegram:webhook [-- --origin https://findmeatime.com]`: registers the
// Telegram bot's webhook and command menu (host-telegram-channel design 2 and 8,
// D2, D10). An operator step, like registering the Photon webhook. In order:
//   1. setWebhook with url {origin}/telegram/webhook, the secret_token
//      TELEGRAM_WEBHOOK_SECRET, allowed_updates message, callback_query and
//      my_chat_member, and max_connections 10;
//   2. setMyCommands with requests, review, help and stop;
//   3. getWebhookInfo, printed without the token.
// It refuses any origin but the production host, so no preview, staging or local
// URL ever receives the bot's updates, and any TELEGRAM_API_URL that is not a
// loopback stand-in, so the token only ever goes to Telegram or a local stand-in.
// The token is read from TELEGRAM_BOT_TOKEN and never printed: every message it
// could appear in is scrubbed first.
// When TELEGRAM_WEBHOOK_SECRET is unset, it generates one, appends it to the
// checkout's .env without printing it, and stops before calling Telegram: the
// same value must reach Vercel Production, and production must be redeployed,
// before the webhook is registered with it.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_ORIGIN = "https://findmeatime.com";
export const TELEGRAM_API = "https://api.telegram.org";
export const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"];
export const MAX_CONNECTIONS = 10;
export const COMMANDS = [
  { command: "requests", description: "Your open requests" },
  { command: "review", description: "The current proposal, or your settings in setup" },
  { command: "help", description: "What you can send here" },
  { command: "stop", description: "Unlink this chat from Find Me a Time" },
];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Telegram accepts 1 to 256 of these; the operator generates 32 or more.
const SECRET = /^[A-Za-z0-9_-]{32,256}$/;

export class WebhookSetupError extends Error {}

// 36 random bytes as base64url: 48 characters of A-Z a-z 0-9 _ -.
export function generateSecret() {
  return randomBytes(36).toString("base64url");
}

// Appends TELEGRAM_WEBHOOK_SECRET to the env file, refusing to add a second line.
export function saveSecret(envFile, secret) {
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  if (/^TELEGRAM_WEBHOOK_SECRET=./m.test(current)) {
    throw new WebhookSetupError(`${envFile} already has TELEGRAM_WEBHOOK_SECRET; it was not loaded, so check the file.`);
  }
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  appendFileSync(envFile, `${separator}TELEGRAM_WEBHOOK_SECRET=${secret}\n`, { mode: 0o600 });
}

function originArgument(argv) {
  const index = argv.indexOf("--origin");
  if (index < 0) return PRODUCTION_ORIGIN;
  const value = argv[index + 1];
  if (!value) throw new WebhookSetupError("--origin needs a value.");
  return value;
}

// The webhook URL, or a refusal unless it is on the production host over HTTPS.
export function webhookUrl(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new WebhookSetupError("The origin is not a URL.");
  }
  if (url.origin !== PRODUCTION_ORIGIN) {
    throw new WebhookSetupError(`Refusing ${url.origin}: the webhook is registered only on ${PRODUCTION_ORIGIN}.`);
  }
  return `${PRODUCTION_ORIGIN}/telegram/webhook`;
}

// The Bot API base: Telegram, or a loopback stand-in for tests and local runs.
export function apiBase(env) {
  const configured = env.TELEGRAM_API_URL?.trim();
  if (!configured) return TELEGRAM_API;
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new WebhookSetupError("TELEGRAM_API_URL is not a URL.");
  }
  if (!LOOPBACK.has(url.hostname.toLowerCase())) {
    throw new WebhookSetupError("TELEGRAM_API_URL must be a loopback stand-in; unset it to use the Bot API.");
  }
  return configured.replace(/\/+$/, "");
}

export async function setUpTelegramWebhook({
  env = process.env,
  argv = [],
  fetcher = fetch,
  log = console.log,
  envFile = resolve(process.cwd(), ".env"),
} = {}) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  const scrub = (text) => (token ? String(text).split(token).join("<token>") : String(text));

  if (!token) throw new WebhookSetupError("TELEGRAM_BOT_TOKEN is not set.");
  if (!secret) {
    webhookUrl(originArgument(argv));
    apiBase(env);
    saveSecret(envFile, generateSecret());
    log(`Generated TELEGRAM_WEBHOOK_SECRET and saved it to ${envFile}; it was not printed.`);
    log("Next: set the same value on Vercel Production, redeploy, then run npm run telegram:webhook again.");
    log(`  grep '^TELEGRAM_WEBHOOK_SECRET=' '${envFile}' | cut -d= -f2- | tr -d '\\n' | vercel env add TELEGRAM_WEBHOOK_SECRET production`);
    return { generated: true };
  }
  if (!SECRET.test(secret)) throw new WebhookSetupError("TELEGRAM_WEBHOOK_SECRET must be 32 to 256 letters, digits, _ or -.");

  const url = webhookUrl(originArgument(argv));
  const base = apiBase(env);

  async function call(method, params) {
    let response;
    try {
      response = await fetcher(`${base}/bot${token}/${method}`, {
        body: JSON.stringify(params),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new WebhookSetupError(scrub(`${method} failed: ${error instanceof Error ? error.message : error}`));
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      throw new WebhookSetupError(scrub(`${method} was refused (${body?.error_code ?? response.status}): ${body?.description ?? "no description"}`));
    }
    return body.result;
  }

  await call("setWebhook", { allowed_updates: ALLOWED_UPDATES, max_connections: MAX_CONNECTIONS, secret_token: secret, url });
  log(`Webhook set: ${url}`);
  await call("setMyCommands", { commands: COMMANDS });
  log(`Commands set: ${COMMANDS.map((item) => `/${item.command}`).join(", ")}`);

  const info = await call("getWebhookInfo", {});
  const shown = {
    allowed_updates: info?.allowed_updates ?? [],
    last_error_date: info?.last_error_date ?? null,
    last_error_message: info?.last_error_message ?? null,
    max_connections: info?.max_connections ?? null,
    pending_update_count: info?.pending_update_count ?? 0,
    url: info?.url ?? "",
  };
  log(scrub(JSON.stringify(shown, null, 2)));
  return shown;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  setUpTelegramWebhook({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof WebhookSetupError ? error.message : "The webhook setup failed.");
    process.exitCode = 1;
  });
}
