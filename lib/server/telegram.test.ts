import { describe, expect, it } from "vitest";
import { channelHash } from "./photon-receiver";
import {
  callbackDataFor,
  inboundTelegramUpdate,
  normalizeTelegramSender,
  openTelegramText,
  parseCallbackData,
  sealedTelegramText,
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
      telegram: { callbackId: null, callbackMessageId: null, firstName: "Dohyeon", username: "dohyeon" },
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
    const details = { callbackId: "cb", callbackMessageId: "9", firstName: "Dohyeon", username: null };
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
