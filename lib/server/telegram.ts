import { deploymentEnvironment } from "./deployment";
import type { ParsedCommand } from "./imessage-commands";
import { gateTransport, type MessagingTransport } from "./messaging";
import type { PhotonSendRequest, PhotonSendResult, PhotonTransport, WhatsAppButtons } from "./photon";
import type { InboundMessage } from "./photon-receiver";

// The Telegram Bot API, called directly (host-telegram-channel design 1 to 3,
// D1 to D3). Photon's Telegram provider receives updates only over a persistent
// WebSocket that a Vercel Function cannot hold, so the bot's own webhook
// delivers updates to agent/channels/telegram.ts and this module reads them.
//
// An update counts only from a private chat whose ID is the sender's user ID,
// from a user who is not a bot. Three kinds are stored:
//   - a message (content type text, command, attachment or other);
//   - a button tap, a callback_query on a message in that chat (callback);
//   - the user blocking the bot, a my_chat_member update whose new status is
//     kicked (blocked).
// Every other update creates no work. The receipt's message ID is
// update:<update_id>, since a callback has no message of its own. The sender's
// first name and @username, and a callback's ID and message, are sealed with
// the text as one JSON envelope, so the receipts table needs no new column.

// Telegram's caps: a message's text, and a button's callback_data in bytes.
export const TELEGRAM_TEXT_LIMIT = 4096;
export const CALLBACK_DATA_BYTES = 64;

export type TelegramDetails = {
  readonly firstName: string | null;
  readonly username: string | null;
  // A callback's ID, which answerCallbackQuery names, and the bot message the tapped button was on.
  readonly callbackId: string | null;
  readonly callbackMessageId: string | null;
  // The host's own message, which setMessageReaction names (host-telegram-channel task 4.2).
  readonly messageId: string | null;
};

type User = { id?: unknown; is_bot?: unknown; first_name?: unknown; username?: unknown };
type Chat = { id?: unknown; type?: unknown };

// The update's ID, or null when the body is not an update.
export function telegramUpdateId(payload: unknown) {
  const id = (payload as { update_id?: unknown } | null)?.update_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? id : null;
}

// The Telegram sender (D3): a user who is not a bot, by their positive numeric
// ID as a decimal string. Anything else is not a sender.
export function normalizeTelegramSender(from: unknown) {
  if (!from || typeof from !== "object") return null;
  const user = from as User;
  if (user.is_bot !== false) return null;
  return typeof user.id === "number" && Number.isSafeInteger(user.id) && user.id > 0 ? String(user.id) : null;
}

// A one-to-one chat with the bot: private, and its ID is the sender's.
function isPrivateChatOf(chat: unknown, sender: string) {
  if (!chat || typeof chat !== "object") return false;
  const { id, type } = chat as Chat;
  return type === "private" && typeof id === "number" && String(id) === sender;
}

function profile(from: unknown) {
  const user = from as User;
  const name = typeof user.first_name === "string" ? user.first_name.trim().slice(0, 64) : "";
  const username = typeof user.username === "string" && /^[A-Za-z0-9_]{4,32}$/.test(user.username) ? user.username : null;
  return { firstName: name || null, username };
}

const MEDIA = ["photo", "video", "voice", "audio", "document", "sticker", "animation", "video_note", "location", "contact", "venue", "poll", "dice"];

function message(updateId: number, value: unknown): InboundMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { from?: unknown; chat?: unknown; date?: unknown; text?: unknown; message_id?: unknown };
  const sender = normalizeTelegramSender(item.from);
  if (!sender || !isPrivateChatOf(item.chat, sender)) return null;

  const text = typeof item.text === "string" && item.text.length > 0 && item.text.length <= TELEGRAM_TEXT_LIMIT ? item.text : null;
  const contentType = text !== null ? (text.startsWith("/") ? "command" : "text") : MEDIA.some((key) => key in item) ? "attachment" : "other";
  const sentAt = typeof item.date === "number" && item.date > 0 ? new Date(item.date * 1000) : null;

  return {
    channel: "telegram",
    contentType,
    messageId: `update:${updateId}`,
    sender,
    sentAt,
    spaceId: sender,
    spaceType: "dm",
    telegram: {
      ...profile(item.from),
      callbackId: null,
      callbackMessageId: null,
      messageId: typeof item.message_id === "number" && Number.isSafeInteger(item.message_id) ? String(item.message_id) : null,
    },
    text,
  };
}

function callback(updateId: number, value: unknown): InboundMessage | null {
  if (!value || typeof value !== "object") return null;
  const query = value as { id?: unknown; from?: unknown; message?: { message_id?: unknown; chat?: unknown } | null; data?: unknown };
  const sender = normalizeTelegramSender(query.from);
  // A tap on an inline-mode message has no chat; only buttons the bot sent in the host's chat count.
  if (!sender || !query.message || !isPrivateChatOf(query.message.chat, sender)) return null;
  if (typeof query.id !== "string" || query.id.length === 0 || query.id.length > 200) return null;

  const messageId = query.message.message_id;
  const data = typeof query.data === "string" && Buffer.byteLength(query.data, "utf8") <= CALLBACK_DATA_BYTES ? query.data : null;

  return {
    channel: "telegram",
    contentType: "callback",
    messageId: `update:${updateId}`,
    sender,
    sentAt: null,
    spaceId: sender,
    spaceType: "dm",
    telegram: {
      ...profile(query.from),
      callbackId: query.id,
      callbackMessageId: typeof messageId === "number" && Number.isSafeInteger(messageId) ? String(messageId) : null,
      messageId: null,
    },
    text: data,
  };
}

// The user blocked the bot (design 9): stored so the job ends the binding.
function blocked(updateId: number, value: unknown): InboundMessage | null {
  if (!value || typeof value !== "object") return null;
  const update = value as { from?: unknown; chat?: unknown; date?: unknown; new_chat_member?: { status?: unknown } | null };
  if (update.new_chat_member?.status !== "kicked") return null;
  const sender = normalizeTelegramSender(update.from);
  if (!sender || !isPrivateChatOf(update.chat, sender)) return null;

  return {
    channel: "telegram",
    contentType: "blocked",
    messageId: `update:${updateId}`,
    sender,
    sentAt: typeof update.date === "number" && update.date > 0 ? new Date(update.date * 1000) : null,
    spaceId: sender,
    spaceType: "dm",
    telegram: { ...profile(update.from), callbackId: null, callbackMessageId: null, messageId: null },
    text: null,
  };
}

// The stored form of an update, or null for an update that creates no work:
// another update type, a group, supergroup or channel, a bot, or a chat that is
// not the sender's own.
export function inboundTelegramUpdate(payload: unknown): InboundMessage | null {
  const updateId = telegramUpdateId(payload);
  if (updateId === null) return null;
  const update = payload as { message?: unknown; callback_query?: unknown; my_chat_member?: unknown };

  if (update.message !== undefined) return message(updateId, update.message);
  if (update.callback_query !== undefined) return callback(updateId, update.callback_query);
  if (update.my_chat_member !== undefined) return blocked(updateId, update.my_chat_member);
  return null;
}

// The text a Telegram receipt seals: the message text (or callback data) with
// the update's details, as one JSON envelope.
export function sealedTelegramText(text: string | null, details: TelegramDetails) {
  return JSON.stringify({ ...details, text });
}

// The envelope read back when the receipt is opened, or null when it is not one.
export function openTelegramText(sealed: string): { readonly text: string | null; readonly details: TelegramDetails } | null {
  let value: unknown;
  try {
    value = JSON.parse(sealed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  const field = (name: string) => (typeof envelope[name] === "string" ? (envelope[name] as string) : null);
  return {
    details: {
      callbackId: field("callbackId"),
      callbackMessageId: field("callbackMessageId"),
      firstName: field("firstName"),
      messageId: field("messageId"),
      username: field("username"),
    },
    text: field("text"),
  };
}

// ---------------------------------------------------------------------------
// Buttons (design 7, D8)

const REQUEST_REF = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const VERSION = /^[1-9]\d{0,5}$/;
const SETTINGS_REF = /^[0-9A-F]{8}$/;

// The exact command a button's callback_data names, never its label:
//   - a:<ref>-<version> is approve <ref>-<version>;
//   - d:<ref>-<version> is decline <ref>-<version>;
//   - s:<ref> is request <ref>;
//   - c:<settingsRef> is confirm <settingsRef>.
// Anything else names no command.
export function parseCallbackData(data: string | null): ParsedCommand | null {
  if (data === null || Buffer.byteLength(data, "utf8") > CALLBACK_DATA_BYTES) return null;
  const match = /^([adsc]):(.+)$/.exec(data);
  if (!match) return null;
  const [, action, value] = match as unknown as [string, "a" | "d" | "s" | "c", string];
  const ref = value.toUpperCase();

  if (action === "a" || action === "d") {
    const dash = ref.lastIndexOf("-");
    if (dash < 0 || !REQUEST_REF.test(ref.slice(0, dash)) || !VERSION.test(ref.slice(dash + 1))) return null;
    return { name: action === "a" ? "approve" : "decline", ref };
  }
  if (action === "s") return REQUEST_REF.test(ref) ? { name: "request", ref } : null;
  return SETTINGS_REF.test(ref) ? { name: "confirm", ref } : null;
}

// The callback_data of a button for the command it names (the inverse above).
export function callbackDataFor(command: ParsedCommand): string | null {
  if (!("ref" in command)) return null;
  const prefix = { approve: "a", confirm: "c", decline: "d", request: "s" }[command.name as "approve" | "confirm" | "decline" | "request"];
  if (!prefix) return null;
  const data = `${prefix}:${command.ref}`;
  return parseCallbackData(data) ? data : null;
}

// ---------------------------------------------------------------------------
// The Bot API client (design 1 and 9, D1, D11)

type Environment = Readonly<Record<string, string | undefined>>;

export const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_TIMEOUT_MS = 10_000;
// Telegram allows about one message per second in one chat.
export const TELEGRAM_CHAT_SPACING_MS = 1_000;

export type TelegramConfig = {
  // The bot's token (TELEGRAM_BOT_TOKEN). Never logged, printed or returned.
  readonly token: string;
  // The bot's username without "@" (TELEGRAM_BOT_USERNAME), for the t.me link.
  readonly username: string;
  // The stand-in's base URL (TELEGRAM_API_URL), honored outside production only.
  readonly apiUrl: string | null;
};

export function telegramConfig(env: Environment = process.env): TelegramConfig {
  return {
    apiUrl: env.TELEGRAM_API_URL?.trim() || null,
    token: env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
    username: env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") ?? "",
  };
}

// One Bot API method call with its JSON parameters.
export type TelegramCall = { readonly method: string; readonly params: Readonly<Record<string, unknown>> };

export type TelegramRejection = "blocked" | "provider_rejected" | "provider_authentication";

// The four outcomes of the messaging transports (design 9):
//   - accepted: ok, with the method's result;
//   - rejected: a definitive refusal; a 403 means the user blocked or deleted
//     the bot (blocked), a 401 or 404 a bad token, any other 4xx a bad request;
//   - unavailable: nothing was sent; a 429 names how long to wait;
//   - uncertain: the request was written and its answer was lost, timed out or
//     was a 5xx, so it may have gone out.
export type TelegramResult =
  | { readonly status: "accepted"; readonly result: unknown }
  | { readonly status: "rejected"; readonly category: TelegramRejection }
  | { readonly status: "unavailable"; readonly retryAfterSeconds: number | null }
  | { readonly status: "uncertain" };

export type TelegramClient = MessagingTransport<TelegramCall, TelegramResult>;

function refusedBeforeSending(error: unknown) {
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

// The answer's HTTP status and Telegram's error_code, description and
// parameters.retry_after mapped onto the four outcomes.
export function telegramOutcome(status: number, body: unknown): TelegramResult {
  const answer = (body && typeof body === "object" ? body : {}) as {
    ok?: unknown;
    result?: unknown;
    error_code?: unknown;
    parameters?: { retry_after?: unknown } | null;
  };
  if (status >= 200 && status < 300 && answer.ok === true) return { result: answer.result ?? null, status: "accepted" };

  const code = typeof answer.error_code === "number" ? answer.error_code : status;
  if (code === 429) {
    const after = answer.parameters?.retry_after;
    return { retryAfterSeconds: typeof after === "number" && after >= 0 ? Math.ceil(after) : null, status: "unavailable" };
  }
  if (code === 403) return { category: "blocked", status: "rejected" };
  if (code === 401 || code === 404) return { category: "provider_authentication", status: "rejected" };
  if (code >= 400 && code < 500) return { category: "provider_rejected", status: "rejected" };
  return { status: "uncertain" };
}

// The raw client, POST {endpoint}/bot{token}/{method} with a JSON body and a
// ten-second timeout. The token is only ever part of the request URL.
export function botApiClient(endpoint: string, token: string, fetcher: typeof fetch = fetch): TelegramClient {
  const base = endpoint.replace(/\/+$/, "");

  return {
    endpoint: base,
    async send(call) {
      if (!token || !/^[A-Za-z0-9_]+$/.test(call.method)) return { retryAfterSeconds: null, status: "unavailable" };
      let response: Response;

      try {
        response = await fetcher(`${base}/bot${token}/${call.method}`, {
          body: JSON.stringify(call.params),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        });
      } catch (error) {
        return refusedBeforeSending(error) ? { retryAfterSeconds: null, status: "unavailable" } : { status: "uncertain" };
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // A lost or unreadable answer to an accepted request may have gone out.
        if (response.ok) return { status: "uncertain" };
      }
      return telegramOutcome(response.status, body);
    },
  };
}

// The deployment's client behind the messaging gate: the Bot API in production,
// the stand-in where TELEGRAM_API_URL is set elsewhere, else the Bot API (which
// the gate refuses outside production).
export function telegramClient(config: TelegramConfig = telegramConfig(), env: Environment = process.env, fetcher: typeof fetch = fetch): TelegramClient {
  const endpoint = deploymentEnvironment(env) !== "production" && config.apiUrl ? config.apiUrl : TELEGRAM_API;
  return gateTransport(botApiClient(endpoint, config.token, fetcher), env);
}

// Text over Telegram's limit split into ordered parts: at the last paragraph
// break that fits, else the last line break, else the last space, else hard.
export function splitTelegramText(text: string, limit: number = TELEGRAM_TEXT_LIMIT) {
  const parts: string[] = [];
  let rest = text;

  while (Array.from(rest).length > limit) {
    const window = Array.from(rest).slice(0, limit).join("");
    // A window that ends where a break follows is a whole part already.
    const cut = /^\s/.test(rest.slice(window.length))
      ? window.length
      : ([window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")].find((index) => index > 0) ?? window.length);
    parts.push(window.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest.length > 0 || parts.length === 0) parts.push(rest);
  return parts;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The inline keyboard an outbox row was sent with (design 7, D8): the decision a
// proposal summary asks for, or the settings review's confirmation. Stored on
// the row, so a later edit can remove it once the proposal is no longer current.
export type TelegramButtons =
  | { readonly kind: "decision"; readonly ref: string; readonly version: number }
  | { readonly kind: "settings"; readonly ref: string };

export const BUTTON_LABELS = { approve: "Approve", confirm: "Confirm settings", decline: "Decline", details: "Show details" } as const;

// The keyboard a summary's buttons make on Telegram. The commands build one set
// of buttons for every channel, whose IDs are this change's callback data
// (host-whatsapp-channel D17 took the format from here); Telegram keeps only
// what they decide, so retirement can find the version.
export function telegramButtonsOf(buttons: WhatsAppButtons): TelegramButtons | null {
  for (const item of buttons.items) {
    const command = parseCallbackData(item.id);
    if (command?.name === "approve") {
      const dash = command.ref.lastIndexOf("-");
      return { kind: "decision", ref: command.ref.slice(0, dash), version: Number(command.ref.slice(dash + 1)) };
    }
    if (command?.name === "confirm") return { kind: "settings", ref: command.ref };
  }
  return null;
}

// The reply_markup for the buttons; every callback_data is one parseCallbackData reads back.
export function inlineKeyboard(buttons: TelegramButtons) {
  if (buttons.kind === "settings") return { inline_keyboard: [[{ callback_data: `c:${buttons.ref}`, text: BUTTON_LABELS.confirm }]] };
  const decision = `${buttons.ref}-${buttons.version}`;
  return {
    inline_keyboard: [
      [
        { callback_data: `a:${decision}`, text: BUTTON_LABELS.approve },
        { callback_data: `d:${decision}`, text: BUTTON_LABELS.decline },
      ],
      [{ callback_data: `s:${buttons.ref}`, text: BUTTON_LABELS.details }],
    ],
  };
}

// Messages may be edited for 48 hours (D9); an edit is never tried after that.
export const TELEGRAM_EDIT_HOURS = 48;

// The reaction that answers a message that only says thanks, as iMessage's tapback does.
export const THANKS_REACTION = "👍";

// Telegram as a messaging transport for the outbox (design 9): text goes out
// with sendMessage in plain text (no parse_mode, D10), split into ordered parts
// one second apart; the last part carries the row's buttons, and a notice that
// needs nothing is sent with disable_notification. A signal is setMessageReaction
// on the host's message and sendChatAction typing. An edit removes a sent
// message's buttons, and a callback answer stops a tapped button's spinner.
// Anything else is not a Telegram message. The recipient address is the chat ID.
// Once one part was accepted, a later failure is uncertain, since resending
// would repeat parts.
export function telegramTransport(client: TelegramClient, wait: (ms: number) => Promise<unknown> = sleep): PhotonTransport {
  return {
    endpoint: client.endpoint,
    async send(request: PhotonSendRequest): Promise<PhotonSendResult> {
      const chatId = request.recipient.address;
      if (!/^[1-9]\d{0,19}$/.test(chatId)) return { category: "invalid_recipient", status: "rejected" };
      const content = request.content;

      if (content.kind === "signal") {
        if (content.reaction && content.messageId) {
          const reacted = await client.send({
            method: "setMessageReaction",
            params: { chat_id: chatId, message_id: Number(content.messageId), reaction: [{ emoji: content.reaction, type: "emoji" }] },
          });
          if (reacted.status !== "accepted" || !content.typing) return fromTelegram(reacted, chatId, null);
        }
        if (!content.typing) return { messageId: null, spaceId: chatId, status: "accepted" };
        return fromTelegram(await client.send({ method: "sendChatAction", params: { action: "typing", chat_id: chatId } }), chatId, null);
      }
      if (content.kind === "edit_markup") {
        const params = { chat_id: chatId, message_id: Number(content.messageId), reply_markup: { inline_keyboard: [] } };
        return fromTelegram(await client.send({ method: "editMessageReplyMarkup", params }), chatId, content.messageId);
      }
      if (content.kind === "callback_answer") {
        const params = { callback_query_id: content.callbackId, ...(content.answer ? { text: content.answer } : {}) };
        return fromTelegram(await client.send({ method: "answerCallbackQuery", params }), chatId, null);
      }
      if (content.kind !== "text") return { category: "provider_rejected", status: "rejected" };

      const parts = splitTelegramText(content.text);
      let last: string | null = null;

      for (const [index, part] of parts.entries()) {
        if (index > 0) await wait(TELEGRAM_CHAT_SPACING_MS);
        const params = {
          chat_id: chatId,
          text: part,
          ...(content.silent ? { disable_notification: true } : {}),
          ...(content.keyboard && index === parts.length - 1 ? { reply_markup: inlineKeyboard(content.keyboard) } : {}),
        };
        const result = await client.send({ method: "sendMessage", params });
        if (result.status !== "accepted") return index > 0 ? { status: "uncertain" } : fromTelegram(result, chatId, null);
        last = messageIdOf(result.result);
      }
      return { messageId: last, spaceId: chatId, status: "accepted" };
    },
  };
}

function messageIdOf(result: unknown) {
  const id = (result as { message_id?: unknown } | null)?.message_id;
  return typeof id === "number" ? String(id) : null;
}

function fromTelegram(result: TelegramResult, chatId: string, messageId: string | null): PhotonSendResult {
  if (result.status === "accepted") return { messageId, spaceId: chatId, status: "accepted" };
  if (result.status === "rejected") return { category: result.category, status: "rejected" };
  if (result.status === "unavailable") return { retryAfterSeconds: result.retryAfterSeconds, status: "unavailable" };
  return { status: "uncertain" };
}
