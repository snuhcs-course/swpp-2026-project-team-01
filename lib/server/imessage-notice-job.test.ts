import { describe, expect, it } from "vitest";
import { followsText, GUEST_NOTICE_TEXTS, hostQuestionNoticeText, weeklyLimitHoldText } from "./imessage-notice-job";
import { guestNoticeKey, noticeKey } from "./imessage-notices";

describe("weekly-limit hold notice", () => {
  it("names the request and offers a one-request waiver in both languages", () => {
    expect(weeklyLimitHoldText("en", "R-ABC123", "Ada", 2)).toContain("Request R-ABC123 · Ada");
    expect(weeklyLimitHoldText("en", "R-ABC123", "Ada", 2)).toContain("Allow this request beyond the weekly limit?");
    expect(weeklyLimitHoldText("ko", "R-ABC123", "에이다", 2)).toContain("이번 요청만 한도를 넘어 진행할까요?");
    expect(weeklyLimitHoldText("ko", "R-ABC123", "에이다", 2)).not.toContain("설정에서");
  });

  it("dedupes a retry but keys a changed request or settings revision separately", () => {
    const hold = { kind: "weekly_limit_hold" as const, requestRevision: 3, settingsRevision: 4, weeklyLimit: 2 };
    expect(noticeKey("request", hold)).toBe(noticeKey("request", hold));
    expect(noticeKey("request", hold)).not.toBe(noticeKey("request", { ...hold, requestRevision: 5 }));
    expect(noticeKey("request", hold)).not.toBe(noticeKey("request", { ...hold, settingsRevision: 5 }));
  });
});

describe("provisional host question notice (#327)", () => {
  it("keeps the host's question and tells the guest where to answer", () => {
    expect(hostQuestionNoticeText("en", "Do you need parking?")).toBe(
      "The meeting host asks about: Do you need parking?\nReply here or in your booking page conversation.",
    );
    expect(hostQuestionNoticeText("ko", "주차가 필요하세요?")).toContain("미팅 호스트가 묻습니다: 주차가 필요하세요?");
    expect(guestNoticeKey("request", { kind: "host_question", inputId: "input" })).toBe("guest-notice:host_question:request:input");
  });
});

// The guest's new-version notice in their linked conversation mirrors the
// email (#179) and lists what the host changed (#198).

describe("the guest's new-version notice", () => {
  it("lists each changed field on its own line", () => {
    const text = GUEST_NOTICE_TEXTS.en.status_new_version("Ada Lovelace", "Mon, Nov 2, 10:00 AM–10:30 AM (Asia/Seoul)", [
      "Place: Cafe Onion (was: Seoul Station)",
    ]);

    expect(text).toBe(
      "Ada Lovelace sent back changed meeting details:\n- Place: Cafe Onion (was: Seoul Station)\nNothing is agreed yet. Reply here to agree or to ask for something else.",
    );
  });

  it("keeps the new time in the sentence without a list of changes", () => {
    expect(GUEST_NOTICE_TEXTS.ko.status_new_version("Ada", "11월 2일 (월), 오전 10:00~10:30 (Asia/Seoul)")).toContain(
      "다시 보냈습니다: 11월 2일 (월)",
    );
  });
});

// The host's approval summary of a revised request names the earlier request
// and how it ended, including the guest's withdrawal (#59).

describe("the host's revised-request sentence", () => {
  it("names a withdrawn earlier request", () => {
    expect(followsText({ revisedFrom: { outcome: "withdrawn", ref: "R-ABC123" } }, "en")).toBe("It follows request R-ABC123, which the guest withdrew.");
    expect(followsText({ revisedFrom: { outcome: "withdrawn", ref: "R-ABC123" } }, "ko")).toBe("게스트가 철회한 요청 R-ABC123에 이어진 요청이에요.");
  });

  it("keeps the decline and expiry sentences", () => {
    expect(followsText({ revisedFrom: { outcome: "declined", ref: "R-ABC123" } }, "en")).toBe("It follows your decline of request R-ABC123.");
    expect(followsText({ revisedFrom: { outcome: "expired", ref: "R-ABC123" } }, "en")).toBe("It follows request R-ABC123, which expired.");
  });

  it("says nothing for a request that follows none", () => {
    expect(followsText({ revisedFrom: null }, "en")).toBe("");
  });
});
