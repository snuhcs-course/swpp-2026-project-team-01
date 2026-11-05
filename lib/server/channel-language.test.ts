import { describe, expect, it } from "vitest";
import { textLanguage } from "./channel-language";

describe("textLanguage", () => {
  it("reads Korean from Hangul and English from other letters, past the channel prefix", () => {
    expect(textLanguage("[iMessage] 들어온 예약 있어?")).toBe("ko");
    expect(textLanguage("Is Friday possible? 금요일")).toBe("ko");
    expect(textLanguage("[Telegram] Looks good, book it")).toBe("en");
  });

  it("says nothing for a message without letters", () => {
    expect(textLanguage("👍")).toBeNull();
    expect(textLanguage("[WhatsApp] 10:30")).toBeNull();
    expect(textLanguage(null)).toBeNull();
  });
});
