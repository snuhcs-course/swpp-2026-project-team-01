import { describe, expect, it, vi } from "vitest";
import { channelHash } from "./photon-receiver";
import {
  botApiClient,
  callbackDataFor,
  inboundTelegramUpdate,
  normalizeTelegramSender,
  openTelegramText,
  parseCallbackData,
  sealedTelegramText,
  splitTelegramText,
  telegramClient,
  telegramConfig,
  telegramOutcome,
  telegramTransport,
  inlineKeyboard,
  THANKS_REACTION,
  telegramUpdateId,
} from "./telegram";
import type { TokenKey } from "./token-encryption";

// Telegram updates as the Bot API documents them (host-telegram-channel design
// 2 and 3): what counts as a sender, which updates are stored and in what form,
// the separate hash namespace, the sealed envelope and the button data.

const user = { first_name: "Dohyeon", id: 123456789, is_bot: false, username: "dohyeon" };
const privateChat = { first_name: "Dohyeon", id: 123456789, type: "private" };

function messageUpdate(overrides: Record<string, unknown> = {}, updateId = 1001) {
  return { message: { chat: privateChat, date: 1_793_000_000, from: user, message_id: 7, text: "requests", ...overrides }, update_id: updateId };
}

describe("normalizeTelegramSender", () => {
  it("keeps a user's positive numeric ID as a decimal string", () => {
    expect(normalizeTelegramSender(user)).toBe("123456789");
  });

  it("refuses bots, missing is_bot, non-numeric and non-positive IDs", () => {
    expect(normalizeTelegramSender({ ...user, is_bot: true })).toBeNull();
    expect(normalizeTelegramSender({ id: 1 })).toBeNull();
    expect(normalizeTelegramSender({ ...user, id: "123" })).toBeNull();
    expect(normalizeTelegramSender({ ...user, id: 0 })).toBeNull();
    expect(normalizeTelegramSender({ ...user, id: 1.5 })).toBeNull();
    expect(normalizeTelegramSender(null)).toBeNull();
  });
});

describe("inboundTelegramUpdate", () => {
  it("stores a private text message keyed by its update ID, with the profile", () => {
    expect(inboundTelegramUpdate(messageUpdate())).toEqual({
      channel: "telegram",
      contentType: "text",
      messageId: "update:1001",
      sender: "123456789",
      sentAt: new Date(1_793_000_000 * 1000),
      spaceId: "123456789",
      spaceType: "dm",
      telegram: { callbackId: null, callbackMessageId: null, firstName: "Dohyeon", messageId: "7", username: "dohyeon" },
      text: "requests",
    });
  });

  it("marks a leading slash as a command and a message without text by what it carries", () => {
    expect(inboundTelegramUpdate(messageUpdate({ text: "/start FMAT-ABCD-1234" }))?.contentType).toBe("command");
    expect(inboundTelegramUpdate(messageUpdate({ photo: [{}], text: undefined }))).toMatchObject({ contentType: "attachment", text: null });
    expect(inboundTelegramUpdate(messageUpdate({ text: undefined }))).toMatchObject({ contentType: "other", text: null });
  });

  it("creates no work from groups, supergroups, channels, bots or a chat that is not the sender's", () => {
    for (const type of ["group", "supergroup", "channel"]) {
      expect(inboundTelegramUpdate(messageUpdate({ chat: { id: -100123, type } }))).toBeNull();
    }
    expect(inboundTelegramUpdate(messageUpdate({ chat: { id: 987654321, type: "private" } }))).toBeNull();
    expect(inboundTelegramUpdate(messageUpdate({ from: { ...user, is_bot: true } }))).toBeNull();
  });

  it("stores a button tap in the sender's chat with its data and locators", () => {
    const update = {
      callback_query: { chat_instance: "x", data: "a:K7Q2MX-2", from: user, id: "4382bfdwdsb323b2d9", message: { chat: privateChat, message_id: 55 } },
      update_id: 1002,
    };
    expect(inboundTelegramUpdate(update)).toMatchObject({
      contentType: "callback",
      messageId: "update:1002",
      sender: "123456789",
      telegram: { callbackId: "4382bfdwdsb323b2d9", callbackMessageId: "55" },
      text: "a:K7Q2MX-2",
    });
  });

  it("creates no work from a tap on an inline message or in another chat", () => {
    expect(inboundTelegramUpdate({ callback_query: { data: "a:K7Q2MX-2", from: user, id: "1", inline_message_id: "x" }, update_id: 1 })).toBeNull();
    expect(
      inboundTelegramUpdate({ callback_query: { data: "a:K7Q2MX-2", from: user, id: "1", message: { chat: { id: -1, type: "group" }, message_id: 1 } }, update_id: 1 }),
    ).toBeNull();
  });

  it("stores the user blocking the bot, and nothing for other member changes", () => {
    const change = (status: string) => ({
      my_chat_member: { chat: privateChat, date: 1_793_000_000, from: user, new_chat_member: { status, user: { id: 1, is_bot: true } }, old_chat_member: { status: "member" } },
      update_id: 1003,
    });
    expect(inboundTelegramUpdate(change("kicked"))).toMatchObject({ contentType: "blocked", messageId: "update:1003", text: null });
    expect(inboundTelegramUpdate(change("member"))).toBeNull();
  });

  it("creates no work from other update types or a body without an update ID", () => {
    expect(inboundTelegramUpdate({ edited_message: messageUpdate().message, update_id: 1 })).toBeNull();
    expect(inboundTelegramUpdate({ message: messageUpdate().message })).toBeNull();
    expect(telegramUpdateId({ update_id: "1" })).toBeNull();
    expect(telegramUpdateId({ update_id: 0 })).toBe(0);
  });
});

describe("channelHash", () => {
  const key: TokenKey = { id: "k1", key: Buffer.alloc(32, 7) };

  it("hashes Telegram user IDs in their own namespace", () => {
    expect(channelHash(key, "telegram", "sender", "15551234567")).not.toBe(channelHash(key, "whatsapp", "sender", "15551234567"));
    expect(channelHash(key, "telegram", "sender", "15551234567")).not.toBe(channelHash(key, "imessage", "sender", "15551234567"));
    expect(channelHash(key, "imessage", "sender", "+15551234567")).toBe(channelHash(key, "imessage", "sender", "+15551234567"));
  });
});

describe("the sealed envelope", () => {
  it("round-trips the text and the details", () => {
    const details = { callbackId: "cb", callbackMessageId: "9", firstName: "Dohyeon", messageId: null, username: null };
    expect(openTelegramText(sealedTelegramText("hello", details))).toEqual({ details, text: "hello" });
    expect(openTelegramText(sealedTelegramText(null, details))?.text).toBeNull();
    expect(openTelegramText("not json")).toBeNull();
  });
});

describe("parseCallbackData", () => {
  it("names the exact command of each button", () => {
    expect(parseCallbackData("a:K7Q2MX-2")).toEqual({ name: "approve", ref: "K7Q2MX-2" });
    expect(parseCallbackData("d:k7q2mx-12")).toEqual({ name: "decline", ref: "K7Q2MX-12" });
    expect(parseCallbackData("s:K7Q2MX")).toEqual({ name: "request", ref: "K7Q2MX" });
    expect(parseCallbackData("c:0A1B2C3D")).toEqual({ name: "confirm", ref: "0A1B2C3D" });
  });

  it("refuses anything else", () => {
    for (const data of ["a:K7Q2MX", "a:K7Q2MX-0", "a:K7Q2MI-1", "s:K7Q2MX-1", "c:K7Q2MX", "x:K7Q2MX", "approve K7Q2MX-1", "", `s:${"A".repeat(70)}`]) {
      expect(parseCallbackData(data)).toBeNull();
    }
    expect(parseCallbackData(null)).toBeNull();
  });

  it("is the inverse of callbackDataFor", () => {
    expect(callbackDataFor({ name: "approve", ref: "K7Q2MX-2" })).toBe("a:K7Q2MX-2");
    expect(callbackDataFor({ name: "request", ref: "K7Q2MX" })).toBe("s:K7Q2MX");
    expect(callbackDataFor({ name: "share", ref: "K7Q2MX" })).toBeNull();
    expect(callbackDataFor({ name: "help" })).toBeNull();
  });
});

describe("telegramOutcome", () => {
  it("maps the Bot API's answers onto the four outcomes (D11)", () => {
    expect(telegramOutcome(200, { ok: true, result: { message_id: 5 } })).toEqual({ result: { message_id: 5 }, status: "accepted" });
    expect(telegramOutcome(403, { description: "Forbidden: bot was blocked by the user", error_code: 403, ok: false })).toEqual({
      category: "blocked",
      status: "rejected",
    });
    expect(telegramOutcome(400, { description: "Bad Request: chat not found", error_code: 400, ok: false })).toEqual({
      category: "provider_rejected",
      status: "rejected",
    });
    expect(telegramOutcome(401, { error_code: 401, ok: false })).toEqual({ category: "provider_authentication", status: "rejected" });
    expect(telegramOutcome(429, { error_code: 429, ok: false, parameters: { retry_after: 7 } })).toEqual({ retryAfterSeconds: 7, status: "unavailable" });
    expect(telegramOutcome(429, { error_code: 429, ok: false })).toEqual({ retryAfterSeconds: null, status: "unavailable" });
    expect(telegramOutcome(502, null)).toEqual({ status: "uncertain" });
    expect(telegramOutcome(200, { ok: false })).toEqual({ status: "uncertain" });
  });
});

describe("botApiClient", () => {
  const token = "123456:test_token_value";

  it("posts JSON to /bot<token>/<method> and reads the answer", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, result: { message_id: 9 } }));
    const result = await botApiClient("http://127.0.0.1:9/", token, fetcher as unknown as typeof fetch).send({
      method: "sendMessage",
      params: { chat_id: "1", text: "hi" },
    });

    expect(result).toEqual({ result: { message_id: 9 }, status: "accepted" });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:9/bot123456:test_token_value/sendMessage", expect.objectContaining({ body: '{"chat_id":"1","text":"hi"}', method: "POST" }));
  });

  it("is unavailable without a token or when the connection is refused, and uncertain when the answer is lost", async () => {
    const never = vi.fn();
    expect(await botApiClient("http://127.0.0.1:9", "", never as unknown as typeof fetch).send({ method: "sendMessage", params: {} })).toEqual({
      retryAfterSeconds: null,
      status: "unavailable",
    });
    expect(never).not.toHaveBeenCalled();

    const refused = async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    expect(await botApiClient("http://127.0.0.1:9", token, refused as unknown as typeof fetch).send({ method: "sendMessage", params: {} })).toMatchObject({
      status: "unavailable",
    });

    const reset = async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    expect(await botApiClient("http://127.0.0.1:9", token, reset as unknown as typeof fetch).send({ method: "sendMessage", params: {} })).toEqual({
      status: "uncertain",
    });
  });
});

describe("telegramClient", () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true, result: true }));

  it("refuses a preview and a local call toward the real Bot API before any network access", async () => {
    const preview = { TELEGRAM_API_URL: "http://127.0.0.1:4200", TELEGRAM_BOT_TOKEN: "1:x", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };
    await expect(telegramClient(telegramConfig(preview), preview, fetcher as unknown as typeof fetch).send({ method: "getMe", params: {} })).rejects.toMatchObject({
      category: "unavailable_configuration",
    });
    const local = { TELEGRAM_BOT_TOKEN: "1:x" };
    await expect(telegramClient(telegramConfig(local), local, fetcher as unknown as typeof fetch).send({ method: "getMe", params: {} })).rejects.toMatchObject({
      category: "unavailable_configuration",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls the stand-in locally and the Bot API in production, ignoring TELEGRAM_API_URL there", () => {
    expect(telegramClient(telegramConfig({ TELEGRAM_API_URL: "http://127.0.0.1:4200" }), {}).endpoint).toBe("http://127.0.0.1:4200");
    const production = { TELEGRAM_API_URL: "http://127.0.0.1:4200", VERCEL: "1", VERCEL_ENV: "production" };
    expect(telegramClient(telegramConfig(production), production).endpoint).toBe("https://api.telegram.org");
  });
});

describe("splitTelegramText", () => {
  it("keeps text within the limit whole", () => {
    expect(splitTelegramText("short")).toEqual(["short"]);
    expect(splitTelegramText("x".repeat(4096))).toHaveLength(1);
  });

  it("splits longer text at paragraph breaks, then lines, then spaces, in order", () => {
    expect(splitTelegramText("aaaa\n\nbbbb\ncccc", 12)).toEqual(["aaaa", "bbbb\ncccc"]);
    expect(splitTelegramText("aaaa bbbb cccc", 9)).toEqual(["aaaa bbbb", "cccc"]);
    expect(splitTelegramText("x".repeat(10), 4)).toEqual(["xxxx", "xxxx", "xx"]);
    const parts = splitTelegramText(`${"word ".repeat(1000)}\n\n${"next ".repeat(1000)}`);
    expect(parts.every((part) => part.length <= 4096)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(`${"word ".repeat(1000)}${"next ".repeat(1000)}`.trim());
  });
});

describe("telegramTransport", () => {
  const request = (text: string) => ({ channel: "telegram" as const, content: { kind: "text" as const, text }, idempotencyKey: "o1", recipient: { address: "42", spaceId: "42" } });

  it("sends plain text with no parse_mode, split into parts a second apart", async () => {
    const sent: unknown[] = [];
    const waits: number[] = [];
    let id = 0;
    const client = { endpoint: "x", send: async (call: unknown) => (sent.push(call), { result: { message_id: ++id }, status: "accepted" as const }) };
    const result = await telegramTransport(client, async (ms) => waits.push(ms)).send(request(`${"a".repeat(4000)}\n\n${"b".repeat(200)}`));

    expect(result).toEqual({ messageId: "2", spaceId: "42", status: "accepted" });
    expect(sent).toEqual([
      { method: "sendMessage", params: { chat_id: "42", text: "a".repeat(4000) } },
      { method: "sendMessage", params: { chat_id: "42", text: "b".repeat(200) } },
    ]);
    expect(waits).toEqual([1000]);
  });

  it("passes on a first refusal and is uncertain once a part went out", async () => {
    const refusing = { endpoint: "x", send: async () => ({ category: "blocked" as const, status: "rejected" as const }) };
    expect(await telegramTransport(refusing).send(request("hi"))).toEqual({ category: "blocked", status: "rejected" });

    const limited = { endpoint: "x", send: async () => ({ retryAfterSeconds: 3, status: "unavailable" as const }) };
    expect(await telegramTransport(limited).send(request("hi"))).toEqual({ retryAfterSeconds: 3, status: "unavailable" });

    let calls = 0;
    const partly = {
      endpoint: "x",
      send: async () => (++calls === 1 ? { result: { message_id: 1 }, status: "accepted" as const } : { retryAfterSeconds: 3, status: "unavailable" as const }),
    };
    expect(await telegramTransport(partly, async () => undefined).send(request(`${"a".repeat(4096)} b`))).toEqual({ status: "uncertain" });
  });

  it("refuses a recipient that is not a chat ID and content Telegram does not carry", async () => {
    const client = { endpoint: "x", send: vi.fn() };
    expect(await telegramTransport(client).send({ ...request("hi"), recipient: { address: "+15551234567", spaceId: null } })).toEqual({
      category: "invalid_recipient",
      status: "rejected",
    });
    expect(await telegramTransport(client).send({ ...request("hi"), content: { kind: "contact_card" } })).toEqual({ category: "provider_rejected", status: "rejected" });
    expect(client.send).not.toHaveBeenCalled();
  });

  it("puts the buttons on the last part and sends a notice that needs nothing silently", async () => {
    const sent: { method: string; params: Record<string, unknown> }[] = [];
    let id = 0;
    const client = { endpoint: "x", send: async (call: { method: string; params: Record<string, unknown> }) => (sent.push(call), { result: { message_id: ++id }, status: "accepted" as const }) };
    const buttons = { kind: "decision" as const, ref: "K7Q2MX", version: 2 };
    const text = `${"a".repeat(4096)} b`;
    await telegramTransport(client, async () => undefined).send({ ...request(text), content: { buttons, kind: "text", silent: true, text } });

    expect(sent.map((call) => call.params)).toEqual([
      { chat_id: "42", disable_notification: true, text: "a".repeat(4096) },
      { chat_id: "42", disable_notification: true, reply_markup: inlineKeyboard(buttons), text: "b" },
    ]);
  });

  it("removes a message's buttons, answers a tap and reacts to the host's message", async () => {
    const sent: unknown[] = [];
    const client = { endpoint: "x", send: async (call: unknown) => (sent.push(call), { result: true, status: "accepted" as const }) };
    const transport = telegramTransport(client);

    expect(await transport.send({ ...request(""), content: { kind: "edit_markup", messageId: "77" } })).toEqual({ messageId: "77", spaceId: "42", status: "accepted" });
    await transport.send({ ...request(""), content: { answer: null, callbackId: "cb", kind: "callback_answer" } });
    await transport.send({ ...request(""), content: { answer: "Not linked", callbackId: "cb2", kind: "callback_answer" } });
    await transport.send({ ...request(""), content: { kind: "signal", messageId: "9", reaction: THANKS_REACTION, typing: false } });
    await transport.send({ ...request(""), content: { kind: "signal", messageId: null, reaction: null, typing: true } });

    expect(sent).toEqual([
      { method: "editMessageReplyMarkup", params: { chat_id: "42", message_id: 77, reply_markup: { inline_keyboard: [] } } },
      { method: "answerCallbackQuery", params: { callback_query_id: "cb" } },
      { method: "answerCallbackQuery", params: { callback_query_id: "cb2", text: "Not linked" } },
      { method: "setMessageReaction", params: { chat_id: "42", message_id: 9, reaction: [{ emoji: "👍", type: "emoji" }] } },
      { method: "sendChatAction", params: { action: "typing", chat_id: "42" } },
    ]);
  });
});

describe("inlineKeyboard", () => {
  it("names exactly the commands parseCallbackData reads back, each within 64 bytes", () => {
    const decision = inlineKeyboard({ kind: "decision", ref: "K7Q2MX", version: 12 });
    expect(decision.inline_keyboard.flat().map((button) => [button.text, parseCallbackData(button.callback_data)])).toEqual([
      ["Approve", { name: "approve", ref: "K7Q2MX-12" }],
      ["Decline", { name: "decline", ref: "K7Q2MX-12" }],
      ["Show details", { name: "request", ref: "K7Q2MX" }],
    ]);
    const settings = inlineKeyboard({ kind: "settings", ref: "0A1B2C3D" });
    expect(settings.inline_keyboard.flat().map((button) => [button.text, parseCallbackData(button.callback_data)])).toEqual([["Confirm settings", { name: "confirm", ref: "0A1B2C3D" }]]);
    for (const button of [...decision.inline_keyboard.flat(), ...settings.inline_keyboard.flat()]) {
      expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
  });
});
