import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A loopback stand-in for the Telegram Bot API (host-telegram-channel design 9),
// so tests and local runs drive the real client, transport and outbox with
// TELEGRAM_API_URL pointed here. It answers POST /bot<token>/<method> for
// sendMessage, sendPhoto (multipart, the photo recorded as its name, type,
// size and bytes), editMessageReplyMarkup, answerCallbackQuery, sendChatAction, setMessageReaction,
// setWebhook, setMyCommands, setMyProfilePhoto (multipart, a static photo whose
// attach:// name must be an uploaded file) and getWebhookInfo as the Bot API does, records
// every call with the token it named, and keeps the webhook and commands set.
// The next call can be told to answer 403 (blocked), 429 with retry_after, 400,
// a 5xx, or to drop its answer after recording it.

export type FakeTelegramCall = {
  readonly method: string;
  readonly token: string;
  readonly params: Record<string, unknown>;
};

export type FakeTelegramBehavior =
  | "drop"
  | "blocked"
  | { readonly status: number; readonly description?: string; readonly retryAfter?: number };

export type FakeTelegram = {
  readonly baseUrl: string;
  readonly calls: FakeTelegramCall[];
  // Calls of one method, in order.
  callsOf(method: string): FakeTelegramCall[];
  // The next call (of any method) is recorded and then answered as given.
  next(behavior: FakeTelegramBehavior): void;
  // Every later sendMessage or sendPhoto to this chat answers 403, as after the user blocked the bot.
  block(chatId: string): void;
  readonly webhook: { url: string; secretToken: string | null; allowedUpdates: string[]; maxConnections: number | null };
  readonly commands: { command: string; description: string }[];
  close(): Promise<void>;
};

// A file a multipart call uploaded, as the stand-in records it under its field.
export type FakeTelegramFile = { readonly name: string; readonly type: string; readonly size: number; readonly bytes: Buffer };

const METHODS = new Set(["sendMessage", "sendPhoto", "editMessageReplyMarkup", "answerCallbackQuery", "sendChatAction", "setMessageReaction", "setWebhook", "setMyCommands", "setMyProfilePhoto", "getWebhookInfo"]);

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function refusal(response: ServerResponse, status: number, description: string, parameters?: Record<string, unknown>) {
  json(response, status, { description, error_code: status, ok: false, ...(parameters ? { parameters } : {}) });
}

// A JSON body as its object; a multipart one with each text field as a string
// and each file as a FakeTelegramFile.
async function paramsOf(contentType: string, raw: Buffer): Promise<Record<string, unknown>> {
  if (!contentType.startsWith("multipart/form-data")) return raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
  const form = await new Request("http://fake-telegram", { body: new Uint8Array(raw), headers: { "content-type": contentType }, method: "POST" }).formData();
  const params: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) {
    params[name] =
      typeof value === "string" ? value : { bytes: Buffer.from(await value.arrayBuffer()), name: value.name, size: value.size, type: value.type };
  }
  return params;
}

export async function startFakeTelegram(options: { readonly port?: number } = {}): Promise<FakeTelegram> {
  const calls: FakeTelegramCall[] = [];
  const behaviors: FakeTelegramBehavior[] = [];
  const blocked = new Set<string>();
  const webhook: FakeTelegram["webhook"] = { allowedUpdates: [], maxConnections: null, secretToken: null, url: "" };
  const commands: FakeTelegram["commands"] = [];
  let messageId = 100;

  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", "http://fake-telegram");

    // Test control from another process.
    if (request.method === "GET" && url.pathname === "/__calls") {
      json(response, 200, calls);
      return;
    }

    const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    if (request.method !== "POST" || !match || !METHODS.has(match[2]!)) {
      refusal(response, 404, "Not Found");
      return;
    }

    const [, token, method] = match as unknown as [string, string, string];
    const params = await paramsOf(request.headers["content-type"] ?? "", raw);
    calls.push({ method, params, token });
    const behavior = behaviors.shift();

    if (behavior === "drop") {
      request.socket.destroy();
      return;
    }
    if (behavior === "blocked" || ((method === "sendMessage" || method === "sendPhoto") && blocked.has(String(params.chat_id)))) {
      refusal(response, 403, "Forbidden: bot was blocked by the user");
      return;
    }
    if (behavior) {
      if (behavior.status === 429) {
        refusal(response, 429, `Too Many Requests: retry after ${behavior.retryAfter ?? 1}`, { retry_after: behavior.retryAfter ?? 1 });
      } else {
        refusal(response, behavior.status, behavior.description ?? (behavior.status === 400 ? "Bad Request: chat not found" : "Internal Server Error"));
      }
      return;
    }

    switch (method) {
      case "sendMessage":
        messageId += 1;
        json(response, 200, {
          ok: true,
          result: { chat: { id: Number(params.chat_id), type: "private" }, date: Math.floor(Date.now() / 1000), message_id: messageId, text: params.text },
        });
        return;
      case "sendPhoto":
        if (!params.photo || typeof params.photo !== "object") {
          refusal(response, 400, "Bad Request: there is no photo in the request");
          return;
        }
        messageId += 1;
        json(response, 200, {
          ok: true,
          result: {
            caption: params.caption,
            chat: { id: Number(params.chat_id), type: "private" },
            date: Math.floor(Date.now() / 1000),
            message_id: messageId,
            photo: [{ file_id: `photo-${messageId}`, file_unique_id: `p${messageId}`, height: 900, width: 1600 }],
          },
        });
        return;
      case "setWebhook":
        webhook.url = String(params.url ?? "");
        webhook.secretToken = typeof params.secret_token === "string" ? params.secret_token : null;
        webhook.allowedUpdates = Array.isArray(params.allowed_updates) ? (params.allowed_updates as string[]) : [];
        webhook.maxConnections = typeof params.max_connections === "number" ? params.max_connections : null;
        json(response, 200, { description: "Webhook was set", ok: true, result: true });
        return;
      case "setMyCommands":
        commands.splice(0, commands.length, ...((params.commands as FakeTelegram["commands"]) ?? []));
        json(response, 200, { ok: true, result: true });
        return;
      case "setMyProfilePhoto": {
        let photo: { type?: unknown; photo?: unknown } | null = null;
        try {
          photo = typeof params.photo === "string" ? (JSON.parse(params.photo) as { type?: unknown; photo?: unknown }) : null;
        } catch {
          photo = null;
        }
        const attached = typeof photo?.photo === "string" && photo.photo.startsWith("attach://") ? params[photo.photo.slice("attach://".length)] : undefined;
        if (photo?.type !== "static" || !attached || typeof attached !== "object") {
          refusal(response, 400, "Bad Request: the profile photo must be a static photo uploaded as a new file");
          return;
        }
        json(response, 200, { ok: true, result: true });
        return;
      }
      case "getWebhookInfo":
        json(response, 200, {
          ok: true,
          result: {
            allowed_updates: webhook.allowedUpdates,
            has_custom_certificate: false,
            max_connections: webhook.maxConnections ?? 40,
            pending_update_count: 0,
            url: webhook.url,
          },
        });
        return;
      default:
        json(response, 200, { ok: true, result: true });
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    block: (chatId) => blocked.add(chatId),
    calls,
    callsOf: (method) => calls.filter((call) => call.method === method),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    commands,
    next: (behavior) => behaviors.push(behavior),
    webhook,
  };
}
