import { describe, expect, it } from "vitest";
import { callsAssistant, contextLine, GROUP_NAMES, groupInput, groupSettings, isGroupChatSession } from "./kakaotalk-groups";

// KakaoTalk group chats (kakaotalk-group-conversations designs 3 to 6): when a
// member's message calls the assistant, how a call reads to the model, the
// daily limits, and which sessions get the group instructions.

describe("calls", () => {
  it("counts a message that starts with @ or names the account or the assistant", () => {
    for (const text of ["@ 다음 주 언제 돼?", "이브야 화요일 어때", "타임래빗한테 물어보자", "Eve, are you there?", "hey TIMERABBIT", "eve?"]) {
      expect(callsAssistant(text)).toBe(true);
    }
  });

  it("does not count a Latin name inside another word, or a message that names no one", () => {
    for (const text of ["every evening works", "seven people", "never mind", "다음 주에 다같이 밥 먹을까?", "email me@x.com"]) {
      expect(callsAssistant(text)).toBe(false);
    }
  });

  it("takes the names from the environment, and the defaults when it names none", () => {
    expect(groupSettings({}).names).toEqual(GROUP_NAMES);
    expect(groupSettings({ KAKAOTALK_GROUP_NAMES: " 비서 , Helper " }).names).toEqual(["비서", "Helper"]);
    expect(callsAssistant("비서야", ["비서"])).toBe(true);
    expect(groupSettings({ KAKAOTALK_GROUP_DAILY_REPLIES: "5", KAKAOTALK_GROUPS_DAILY_REPLIES: "x" })).toMatchObject({ groupDailyReplies: 5, groupsDailyReplies: 300 });
  });
});

describe("the model input", () => {
  it("names the group, lists the earlier messages and then the call", () => {
    expect(groupInput("테스트 그룹", [contextLine("Kim", "밥 먹자"), contextLine(null, "좋아\n화요일")], contextLine("Lee", "이브 어때?"))).toBe(
      "[KakaoTalk group] 테스트 그룹\nEarlier messages:\nKim: 밥 먹자\n?: 좋아 화요일\n\nMessage to you:\nLee: 이브 어때?",
    );
    expect(groupInput(null, [], "Lee: @ hi")).toBe("[KakaoTalk group]\nMessage to you:\nLee: @ hi");
  });
});

describe("group sessions", () => {
  it("gives the group instructions only to a group_chat session of a group principal", () => {
    const auth = (audience: string, principalId: string) => ({ attributes: { audience }, authenticator: "findmeatime", issuer: "findmeatime", principalId, principalType: "user" }) as never;
    expect(isGroupChatSession(auth("group_chat", "group:1"))).toBe(true);
    expect(isGroupChatSession(auth("requester", "group:1"))).toBe(false);
    expect(isGroupChatSession(auth("group_chat", "request:1"))).toBe(false);
    expect(isGroupChatSession(null)).toBe(false);
  });
});
