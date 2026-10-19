import { describe, expect, it } from "vitest";
import {
  assertChatMessageLength,
  getChatMessageLength,
  getChatMessageLengthError,
  MAX_CHAT_MESSAGE_CHARS,
} from "./chat-message";

describe("chat message length", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(getChatMessageLength("시간")).toBe(2);
    expect(getChatMessageLength("🗓️")).toBe(2);
    expect(getChatMessageLength("📅")).toBe(1);
  });

  it("accepts a trimmed message at the limit", () => {
    const message = ` ${"a".repeat(MAX_CHAT_MESSAGE_CHARS)} `;

    expect(getChatMessageLengthError(message)).toBeNull();
    expect(() => assertChatMessageLength(message)).not.toThrow();
  });

  it("rejects a message one character over the limit", () => {
    const message = "a".repeat(MAX_CHAT_MESSAGE_CHARS + 1);

    expect(getChatMessageLengthError(message)).toBe("Messages must be 8,000 characters or fewer.");
    expect(() => assertChatMessageLength(message)).toThrow("8,000 characters or fewer");
  });
});
