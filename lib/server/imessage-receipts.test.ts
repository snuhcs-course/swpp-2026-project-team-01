import { describe, expect, it } from "vitest";
import { requestRef } from "./imessage-commands";
import { isOnlyThanks, namedConversation } from "./imessage-receipts";

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

describe("namedConversation", () => {
  const ada = { host_name: "Ada Lovelace", request_id: "7b0e0a7e-0d5f-4b7e-9d0f-3c1b2a4d5e6f" };
  const grace = { host_name: "이은우", request_id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" };

  it("names the host's own conversation when the sender says they are the host (#137)", () => {
    expect(namedConversation("먼소리야. 호스트인데 나", [ada], true)).toBe("host");
    expect(namedConversation("back to my settings", [ada], true)).toBe("host");
    // Only a sender who is a host has that conversation.
    expect(namedConversation("as a host", [ada, grace], false)).toBeNull();
  });

  it("names a guest request by its host, the host's given name or its reference", () => {
    expect(namedConversation("Ada, is Friday possible?", [ada, grace], true)).toBe(ada);
    expect(namedConversation("은우님 요청 말이야", [ada, grace], false)).toBe(grace);
    expect(namedConversation(`about ${requestRef(grace.request_id)}`, [ada, grace], false)).toBe(grace);
    expect(namedConversation("my guest request", [ada], true)).toBe(ada);
  });

  it("names nothing when the message is unclear or names two", () => {
    expect(namedConversation("Is Friday possible?", [ada, grace], true)).toBeNull();
    expect(namedConversation("Ada or 은우?", [ada, grace], false)).toBeNull();
    expect(namedConversation("Ada, my host settings", [ada], true)).toBeNull();
  });
});
