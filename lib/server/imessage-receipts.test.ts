import { describe, expect, it } from "vitest";
import { isOnlyThanks } from "./imessage-receipts";

// A host message that only says thanks gets a tapback instead of a turn
// (host-imessage-channel design 18); anything that could answer a question
// Thyme asked still reaches the conversation.

describe("isOnlyThanks", () => {
  it.each(["thanks", "Thanks!", "thank you", "Thank you so much 🙏", "thx", "ty", "many thanks", "thanks again!!", "thank", "고마워", "고마워요", "고맙습니다", "감사합니다!", "감사해요 😊", "땡큐"])(
    "takes %j as thanks",
    (text) => {
      expect(isOnlyThanks(text)).toBe(true);
    },
  );

  it.each(["ok", "yes", "👍", "", "thanks, but can we do Tuesday?", "no thanks", "thanks for nothing", "approve K7Q2MX", "감사합니다 화요일로 바꿔주세요"])(
    "does not take %j as thanks",
    (text) => {
      expect(isOnlyThanks(text)).toBe(false);
    },
  );

  it("does not take a missing text as thanks", () => {
    expect(isOnlyThanks(null)).toBe(false);
  });
});
