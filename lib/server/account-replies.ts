import type { ChannelLanguage } from "./channel-language";
import type { hostRequestsForModel } from "./host-review-tools";
import type { readHostSchedule } from "./host-schedule";
import { setupStepLine } from "../contracts/setup-progress";

export function deferredAcknowledgement(language: ChannelLanguage) {
  return language === "ko" ? "알겠어요. 편하실 때 결정해 주세요." : "Of course. Take your time deciding.";
}

export function placeQuestion(language: ChannelLanguage) {
  return language === "ko"
    ? `${setupStepLine("ko", "place")}\n주로 어디에서 만나시나요? '강남역 근처'처럼 대략적인 지역이면 돼요. 온라인 미팅도 괜찮으신지, 주로 어떻게 이동하시는지도 알려주세요.`
    : `${setupStepLine("en", "place")}\nWhere do you usually meet? A nearby area or station is enough. Do online meetings also work, and how do you usually get around?`;
}

type Schedule = Awaited<ReturnType<typeof readHostSchedule>>;
type Requests = ReturnType<typeof hostRequestsForModel>;
// Reply coverage is one value: an empty requested period cannot hide the
// separately confirmed appointments that the week-comparison contract needs.
export function scheduleReply(schedule: Schedule, requests: Requests, language: ChannelLanguage) {
  const present = new Set(schedule.entries.map(item => item.ref));
  const otherReceived = requests.requests.filter(item => item.booked && ["this_week", "next_week"].includes(item.booked.week) && !present.has(item.ref));
  const otherSent = requests.sent.filter(item => item.booked && ["this_week", "next_week"].includes(item.booked.week) && !present.has(item.ref));
  const kinds = language === "ko" ? { booked_meeting: "확정 미팅", calendar_event: "캘린더 일정", request_to_decide: "승인 대기 요청", sent_request: "보낸 요청" }
    : { booked_meeting: "Booked meeting", calendar_event: "Calendar event", request_to_decide: "Awaiting approval", sent_request: "Sent request" };
  const requested = schedule.entries.map(item => `${kinds[item.kind]}: ${item.title} · ${item.start ?? item.date}${item.end ? `–${item.end}` : item.lastDate && item.lastDate !== item.date ? `–${item.lastDate}` : ""}${item.place ? ` · ${item.place}` : ""}`);
  const period = `${schedule.period.from} to ${schedule.period.through}`;
  const label = period === schedule.current.nextWeek ? (language === "ko" ? "다음 주" : "Next week") : period === schedule.current.thisWeek ? (language === "ko" ? "이번 주" : "This week") : `${schedule.period.from}–${schedule.period.through}`;
  const empty = language === "ko" ? `${label}에 확정된 미팅은 없어요.` : `No meetings are booked for ${label}.`;
  const week = (value: string) => value === "this_week" ? (language === "ko" ? "이번 주" : "This week") : (language === "ko" ? "다음 주" : "Next week");
  const other = [
    ...otherReceived.map(item => `${week(item.booked!.week)}: ${item.requester} · ${item.purpose ?? ""} · ${item.booked!.time}`),
    ...otherSent.map(item => `${week(item.booked!.week)}: ${item.host} · ${item.purpose ?? ""} · ${item.booked!.time}`),
  ];
  return { kind: "schedule", sections: [
    { kind: "requested_period", period: schedule.period, entries: schedule.entries },
    { kind: "also_confirmed", received: otherReceived, sent: otherSent },
  ], text: [...(schedule.entries.some(item => item.kind === "booked_meeting" || item.kind === "sent_request" && item.state === "booked") ? [] : [empty]), ...requested, ...other,
    ...(schedule.googleCalendar === "unavailable" ? [language === "ko" ? "Google Calendar를 읽지 못했어요. Find Me a Time 기록만 표시했어요." : "Google Calendar could not be read; only Find Me a Time records are shown."] : []),
  ].join("\n") };
}

export function setupConfirmationReply(language: ChannelLanguage, bookingLink: string, tutorialOffer: string | null, firstSave: boolean) {
  const status = language === "ko" ? firstSave ? "설정이 끝났어요." : "설정을 저장했어요." : firstSave ? "Setup is done." : "Settings saved.";
  const parts = [{ kind: "status", text: status }, { kind: "booking_link", text: bookingLink }, ...(tutorialOffer ? [{ kind: "tutorial_offer", text: tutorialOffer }] : [])];
  return { kind: "setup_saved", parts, text: parts.map(part => part.text).join("\n\n") };
}
