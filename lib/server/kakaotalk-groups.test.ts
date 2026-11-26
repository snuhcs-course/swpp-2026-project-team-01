import { describe, expect, it } from "vitest";
import { callsAssistant, contextLine, GROUP_NAMES, groupInput, groupSettings, isGroupChatSession } from "./kakaotalk-groups";

// KakaoTalk group chats (kakaotalk-group-conversations designs 3 to 6): when a
// member's message calls the assistant, how a call reads to the model, the
// daily limits, and which sessions get the group instructions.

describe("calls", () => {
  it("counts a message that names the account, with or without @", () => {
    for (const text of ["@타임래빗 다음 주 언제 돼?", "타임래빗아 화요일 어때", "타임래빗, 화요일 저녁 괜찮을까?", "타임래빗한테 물어보자", "타임래빗님 안녕", "TimeRabbit, are you there?", "hey TIMERABBIT", "@TimeRabbit 안녕", "timerabbit?"]) {
      expect(callsAssistant(text), text).toBe(true);
    }
  });

  it("does not count the name inside another word, the assistant's old names, or an @ before someone else", () => {
    for (const text of [
      "TimeRabbits are cute",
      "MyTimeRabbit",
      "다음 주에 다같이 밥 먹을까?",
      "email me@x.com",
      "이브야 화요일 어때",
      "eve, are you there?",
      "새타임래빗",
      "타임래빗츠",
      "@김철수 언제와",
      "@ 다음 주 언제 돼?",
    ]) {
      expect(callsAssistant(text), text).toBe(false);
    }
  });

  it("matches a configured Korean name only with a particle or nothing after it", () => {
    expect(callsAssistant("이브야 안녕", ["이브"])).toBe(true);
    expect(callsAssistant("드라이브 가자", ["이브"])).toBe(false);
    expect(callsAssistant("크리스마스 이브에 뭐해", ["이브"])).toBe(false);
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
