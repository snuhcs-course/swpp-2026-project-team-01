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
  const eunwoo = { host_name: "이은우", request_id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" };
  const ed = { host_name: "Ed Kim", request_id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a" };
  const hana = { host_name: "김하나", request_id: "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b" };

  it("names the host's own account when the sender says they are the host (#137)", () => {
    expect(namedConversation("먼소리야. 호스트인데 나", [ada], true)).toBe("host");
    expect(namedConversation("I'm the host here", [ada], true)).toBe("host");
    expect(namedConversation("settings", [ada], true)).toBe("host");
    // Only a sender who is a host has that conversation.
    expect(namedConversation("I'm the host", [ada, eunwoo], false)).toBeNull();
  });

  it("names nothing when a guest talks about their host", () => {
    expect(namedConversation("can you ask the host if Friday works?", [ed, hana], true)).toBeNull();
    expect(namedConversation("호스트님께 여쭤봐 주세요", [ed, hana], true)).toBeNull();
    expect(namedConversation("the requester wants Tuesday", [ada], true)).toBeNull();
  });

  it("names a guest request by a word of its host's name, a Korean name or its reference", () => {
    expect(namedConversation("Ada, is Friday possible?", [ada, eunwoo], true)).toBe(ada);
    expect(namedConversation("이은우 요청 말이야", [ada, eunwoo], false)).toBe(eunwoo);
    expect(namedConversation("은우님 요청 말이야", [ada, eunwoo], false)).toBe(eunwoo);
    expect(namedConversation(`about ${requestRef(eunwoo.request_id)}`, [ada, eunwoo], false)).toBe(eunwoo);
    expect(namedConversation("guest", [ada], true)).toBe(ada);
  });

  it("does not match a name inside another word", () => {
    expect(namedConversation("I need it really soon", [ed, ada], false)).toBeNull();
    expect(namedConversation("하나 더 물어볼게요", [hana, ada], false)).toBeNull();
  });

  it("names nothing when the message names two", () => {
    expect(namedConversation("Ada or 은우님?", [ada, eunwoo], false)).toBeNull();
    expect(namedConversation("Ada, I'm the host", [ada], true)).toBeNull();
  });
});
