import { createHash, timingSafeEqual } from "node:crypto";
import { database } from "./database";
import { type ReceiverDependencies, storeReceipt } from "./photon-receiver";
import { inboundTelegramUpdate, telegramUpdateId } from "./telegram";
import { tokenKeyFromEnvironment } from "./token-encryption";

// The Telegram webhook receiver (host-telegram-channel design 2, D2).
// agent/channels/telegram.ts routes POST /telegram/webhook here. In order:
//   1. the deployment names its webhook secret (TELEGRAM_WEBHOOK_SECRET) and the
//      request's X-Telegram-Bot-Api-Secret-Token equals it, compared in constant
//      time; otherwise 401. Telegram sends no other signature;
//   2. the body is at most 256 KB of JSON with a numeric update_id; otherwise
//      400, which Telegram drops;
//   3. a message, a button tap or a blocking update from the sender's own
//      private chat is stored as one receipt (channel telegram, message ID
//      update:<update_id>) with its imessage_receipt job, in one transaction,
//      before 200. A failure to store answers 500, so Telegram retries.
// Every other update is answered 200 with nothing stored. Telegram redelivers an
// unacknowledged update with the same update_id, so a duplicate answers 200 and
// creates no second receipt or job, whatever its payload: the update ID is the
// bot's own, and a 409 would only make Telegram retry it for a day. From the
// receipt on, Telegram shares the Photon receipt pipeline.

export const TELEGRAM_WEBHOOK_ID = "telegram";
export const MAX_TELEGRAM_WEBHOOK_BYTES = 256 * 1024;
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

type Environment = Readonly<Record<string, string | undefined>>;

export type TelegramReceiverConfig = {
  // The secret_token given to setWebhook (TELEGRAM_WEBHOOK_SECRET).
  readonly secret: string;
};

export function telegramReceiverConfig(env: Environment = process.env): TelegramReceiverConfig {
  return { secret: env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "" };
}

export type TelegramReceiverDependencies = Pick<ReceiverDependencies, "db" | "tokenKey"> & {
  readonly config: TelegramReceiverConfig;
};

// Both sides are hashed first, so the comparison takes the same time whatever
// the presented value's length.
export function telegramSecretMatches(secret: string, presented: string | null) {
  if (!secret || presented === null) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(secret), digest(presented));
}

function receiverDependenciesFromEnvironment(): TelegramReceiverDependencies {
  return {
    config: telegramReceiverConfig(),
    get db() {
      return database();
    },
    get tokenKey() {
      return tokenKeyFromEnvironment();
    },
  };
}

function answer(status: number) {
  return new Response(null, { headers: { "cache-control": "no-store" }, status });
}

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_TELEGRAM_WEBHOOK_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_TELEGRAM_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function receiveTelegramWebhook(
  request: Request,
  load: () => TelegramReceiverDependencies = receiverDependenciesFromEnvironment,
): Promise<Response> {
  const deps = load();

  if (!telegramSecretMatches(deps.config.secret, request.headers.get(TELEGRAM_SECRET_HEADER))) return answer(401);

  const body = await readBody(request);
  if (body === null) return answer(400);

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return answer(400);
  }

  if (telegramUpdateId(payload) === null) return answer(400);

  const message = inboundTelegramUpdate(payload);
  if (!message) return answer(200);

  try {
    await storeReceipt(deps, TELEGRAM_WEBHOOK_ID, message, createHash("sha256").update(body, "utf8").digest("hex"));
  } catch {
    return answer(500);
  }

  return answer(200);
}
