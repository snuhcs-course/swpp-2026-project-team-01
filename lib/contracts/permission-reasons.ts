// Why each piece of access or data is asked for, and how far it reaches (issue
// #203). One line per ask, shared by the web and the linked chats so the two
// cannot drift: the web shows the English line under the Google button, on the
// calendar cards and on the note review page; the chats add the line in the
// conversation's language to the message that carries the same ask.
//
// Keep each line true to the code: the Google scopes are in google-scopes.ts
// (the calendar list and events; nothing else), the analysis reads only the
// conflict calendars, and a freed note is marked free in Google Calendar
// (transparency), never deleted.

export type PermissionAsk = "googleSignIn" | "calendarRoles" | "noteReview";

export const PERMISSION_REASONS = {
  en: {
    googleSignIn:
      "Why Google: Thyme reads your calendars to find when you're busy and suggest your hours, and adds only the meetings you approve. Guests never see your events.",
    calendarRoles:
      "Why: Thyme reads only the calendars you choose, to find your busy times, and adds bookings only to the one you pick.",
    noteReview:
      "Why: notes like birthdays or deadlines would block your open times. Only the entries you check are marked free in Google Calendar; nothing is deleted.",
  },
  ko: {
    googleSignIn:
      "Google 연결이 필요한 이유: 바쁜 시간을 찾고 미팅 시간을 제안하려고 캘린더를 읽고, 승인하신 미팅만 추가해요. 게스트는 일정 내용을 볼 수 없어요.",
    calendarRoles:
      "이유: 고른 캘린더만 바쁜 시간 확인에 읽고, 예약은 지정하신 캘린더 하나에만 넣어요.",
    noteReview:
      "이유: 생일이나 마감 같은 메모가 가능한 시간을 막지 않게 하려는 거예요. 체크한 일정만 Google 캘린더에서 '한가함'으로 바뀌고, 지워지는 건 없어요.",
  },
} as const satisfies Readonly<Record<"en" | "ko", Readonly<Record<PermissionAsk, string>>>>;
