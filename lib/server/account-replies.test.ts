import { describe, expect, it } from "vitest";
import { deferredAcknowledgement, placeQuestion, scheduleReply, setupConfirmationReply } from "./account-replies";
import { hostRequestsForModel } from "./host-review-tools";
import { scheduleForModel } from "./host-schedule";
import type { readHostSchedule } from "./host-schedule";

describe("complete account replies", () => {
  it.each(["ko", "en"] as const)("reports approved meetings still being added in %s without calling the week empty", (language) => {
    const now = new Date("2026-11-26T01:00:00Z");
    const schedule = scheduleForModel({ events: [{ source: "thyme", state: "booking", id: "thyme:b", title: "Eunwoo", start: "2026-12-01T01:00:00Z", end: "2026-12-01T01:30:00Z", allDay: false, location: null }], timeZone: "Asia/Seoul", googleWarning: null }, { from: "2026-11-30", last: "2026-12-06" }, now);
    const reply = scheduleReply(schedule, hostRequestsForModel([], "Asia/Seoul", now), language);
    expect(reply.text).toContain(language === "ko" ? "승인됨 · Google Calendar에 추가 중" : "Approved · Adding to Google Calendar");
    expect(reply.text).toContain("Eunwoo");
    expect(reply.text).not.toMatch(/확정|없어요|Booked meeting|No meetings/);
  });

  it("acknowledges the host from the assistant's perspective", () => {
    const ownWords = "음, 좀 생각해볼게";
    const reply = deferredAcknowledgement("ko");
    expect(reply).not.toBe(ownWords);
    expect(reply).toContain("결정해 주세요");
  });
  it("keeps the place question together instead of selecting only meeting mode", () => {
    const question = placeQuestion("ko");
    expect(question).toContain("3/4");
    expect(question).toContain("어디에서");
    expect(question).toContain("온라인");
    expect(question).toContain("이동");
  });
  it("keeps a booking link in the same confirmation reply as completion and the tutorial offer", () => {
    const reply = setupConfirmationReply("ko", "https://findmeatime.test/host", "샘플 연습을 해볼까요?", true);
    expect(reply.parts.map(part => part.kind)).toEqual(["status", "booking_link", "tutorial_offer"]);
    expect(reply.text).toContain("설정이 끝났어요.");
    expect(reply.text).toContain("https://findmeatime.test/host");
    expect(reply.text).toContain("샘플 연습을 해볼까요?");
  });
  it("makes an empty next week and this week's confirmed meeting part of one reply", () => {
    const now = new Date("2026-11-26T01:00:00Z");
    const schedule: Awaited<ReturnType<typeof readHostSchedule>> = { current: { now: "now", thisWeek: "2026-11-23 to 2026-11-29", nextWeek: "2026-11-30 to 2026-12-06" }, period: { from: "2026-11-30", through: "2026-12-06", timezone: "Asia/Seoul" }, entries: [], googleCalendar: "read", dataNote: "data", replyNote: "note" };
    const requests = hostRequestsForModel([{ requestId: "cd498360-13dd-47b6-bde4-cf8efa687ea8", sample: false, requesterName: "박도현", purpose: "투자 상담", state: "booked", needsDecision: false, bookedStart: now.toISOString(), proposalStart: null, updatedAt: now.toISOString() }], "Asia/Seoul", now);
    const reply = scheduleReply(schedule, requests, "ko");
    expect(reply.sections).toMatchObject([{ kind: "requested_period", entries: [] }, { kind: "also_confirmed", received: [{ requester: '"박도현"' }] }]);
    expect(reply.text).toContain("다음 주에 확정된 미팅은 없어요.");
    expect(reply.text).toContain("이번 주");
    expect(reply.text).toContain("박도현");
    expect(reply.text).toContain("투자 상담");
  });
});
