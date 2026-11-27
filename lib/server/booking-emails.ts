import type { RequestLanguage } from "../contracts/request";
import { emailSignatureHtml } from "./email-signature";

// The booking confirmation and the requester status notifications
// (host-review-and-booking design 9), rendered with English copy and
// HTML with a plain-text alternative from the delivery's frozen parameters. The
// requester's booking link is the only secret parameter and is rendered at
// dispatch. The confirmation's presentation follows the interfaces document: a
// Confirmed badge, then What, When, Who and Where, then View booking and, for an
// online meeting, Join meeting. Nothing here carries host notes, rules or reasons.

export const BOOKING_EMAIL_TEMPLATES = [
  "booking_confirmation",
  "status_new_version",
  "status_declined",
  "status_expired",
  "status_pending",
  // The host cancelled a booked meeting: the requester's notice.
  "status_cancelled",
  // The requester cancelled a booked meeting: the host's notice.
  "booking_cancelled",
  // A change after booking was declined or expired; the meeting stands.
  "status_change_dropped",
] as const;
export type BookingEmailTemplate = (typeof BOOKING_EMAIL_TEMPLATES)[number];

export function isBookingEmailTemplate(value: string): value is BookingEmailTemplate {
  return (BOOKING_EMAIL_TEMPLATES as readonly string[]).includes(value);
}

// The meeting as a recipient sees it: frozen from the proposal or the confirmed
// event when the email is recorded.
export type MeetingParameters = {
  readonly title: string;
  readonly hostName: string;
  readonly requesterName: string;
  readonly hostEmail: string | null;
  readonly requesterEmail: string;
  readonly start: string;
  readonly end: string;
  // The recipient's timezone.
  readonly timezone: string;
  readonly durationMinutes: number;
  readonly mode: "online" | "in_person";
  readonly location: string | null;
  readonly joinUrl: string | null;
  readonly organizerName?: string | null;
  readonly organizerEmail?: string | null;
};

export type BookingEmailParameters = MeetingParameters & {
  readonly audience: "requester" | "host";
  // The host's copy opens the request in /app; the requester's opens the booking
  // link, which is a secret parameter instead.
  readonly viewUrl?: string;
  // The proposal version a new-version notice is about, and the booking a
  // pending notice is about, which decide whether it is still current.
  readonly version?: number;
  readonly bookingId?: string;
  // The proposal a new-version notice replaces, frozen with it, so the notice
  // can say what the host changed (#198). Absent on notices recorded before.
  readonly previous?: MeetingTerms;
  // A confirmation of a change after booking: the existing event was updated.
  readonly changed?: boolean;
  // Why a change after booking was dropped.
  readonly reason?: "declined" | "expired";
  // The requester's confirmation replies to the product inbox, so a reply
  // reaches Thyme rather than the host (guest-email-and-agree-notices design 2).
  readonly replyToAssistant?: boolean;
};

// The parts of a proposal the host can change.
export type MeetingTerms = {
  readonly start: string;
  readonly end: string;
  readonly mode: "online" | "in_person";
  readonly location: string | null;
};

export type MeetingChange = "time" | "duration" | "mode" | "place";

function minutesOf(terms: MeetingTerms) {
  return Math.round((Date.parse(terms.end) - Date.parse(terms.start)) / 60_000);
}

function placeOf(terms: MeetingTerms) {
  return terms.mode === "in_person" ? terms.location?.trim() || null : null;
}

// What differs between two versions of a proposal, in a fixed order. A new
// start is a time change; the same start with another length is a duration
// change only.
export function meetingChanges(previous: MeetingTerms, next: MeetingTerms): MeetingChange[] {
  return [
    ...(Date.parse(previous.start) !== Date.parse(next.start) ? (["time"] as const) : []),
    ...(minutesOf(previous) !== minutesOf(next) ? (["duration"] as const) : []),
    ...(previous.mode !== next.mode ? (["mode"] as const) : []),
    ...(placeOf(previous) !== placeOf(next) ? (["place"] as const) : []),
  ];
}

const CHANGE_LABELS = {
  en: {
    duration: "Length",
    inPerson: "In person",
    mode: "Meeting type",
    none: "None",
    online: "Online",
    place: "Place",
    time: "Time",
    was: (value: string) => `(was: ${value})`,
  },
  ko: {
    duration: "소요 시간",
    inPerson: "대면",
    mode: "미팅 방식",
    none: "없음",
    online: "온라인",
    place: "장소",
    time: "시간",
    was: (value: string) => `(이전: ${value})`,
  },
} as const;

// One line per changed field, "Place: Cafe Onion (was: Seoul Station)", with the
// time in the recipient's zone through the channel's own formatter.
export function changeLines(
  previous: MeetingTerms,
  next: MeetingTerms,
  language: RequestLanguage,
  formatTime: (terms: MeetingTerms) => string,
): string[] {
  const labels = CHANGE_LABELS[language];
  const value = (field: MeetingChange, terms: MeetingTerms) => {
    switch (field) {
      case "time":
        return formatTime(terms);
      case "duration":
        return durationText(minutesOf(terms), language);
      case "mode":
        return terms.mode === "online" ? labels.online : labels.inPerson;
      case "place":
        return placeOf(terms) ?? labels.none;
    }
  };

  return meetingChanges(previous, next).map(
    (field) => `${labels[field]}: ${value(field, next)} ${labels.was(value(field, previous))}`,
  );
}

export type RenderedBookingEmail = { readonly subject: string; readonly html: string; readonly text: string };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function offsetLabel(instant: Date, timeZone: string) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(instant)
    .find((entry) => entry.type === "timeZoneName");
  return part?.value ?? "GMT";
}

// "Monday, 2 November 2026, 10:00–10:30 (Asia/Seoul, GMT+9)": the date and clock
// in the recipient's zone, with the zone named.
export function whenLine(start: string, end: string, timeZone: string, language: RequestLanguage) {
  const from = new Date(start);
  const to = new Date(end);
  const locale = language === "ko" ? "ko-KR" : "en-GB";
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone, weekday: "long", year: "numeric" }).format(from);
  const clock = (instant: Date) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone }).format(instant);

  return `${date}${language === "ko" ? " " : ", "}${clock(from)}–${clock(to)} (${timeZone}, ${offsetLabel(from, timeZone)})`;
}

function durationText(minutes: number, language: RequestLanguage) {
  return language === "ko" ? `${minutes}분` : `${minutes} minutes`;
}

const LABELS = {
  en: {
    bookingAction: "View booking",
    confirmed: "Confirmed",
    guest: "Guest",
    join: "Join meeting",
    online: "Online",
    organizer: "Organizer",
    support: "Replying to this email reaches the other participant.",
    supportAssistant: "Reply to this email to reach Thyme, your scheduling assistant, about this meeting.",
    what: "What",
    when: "When",
    where: "Where",
    who: "Who",
  },
  ko: {
    bookingAction: "예약 보기",
    confirmed: "확정됨",
    guest: "게스트",
    join: "미팅 참여",
    online: "온라인",
    organizer: "주최자",
    support: "이 메일에 답장하면 상대방에게 전달됩니다.",
    supportAssistant: "이 미팅에 대해서는 이 메일에 답장해 일정 도우미 Thyme에게 물어보세요.",
    what: "무엇",
    when: "언제",
    where: "어디",
    who: "누구",
  },
} as const;

function confirmationSubject(parameters: BookingEmailParameters) {
  if (parameters.changed) return `Your meeting details changed: ${parameters.title}`;
  return parameters.audience === "host"
    ? `Meeting booked with ${parameters.requesterName}: ${parameters.title}`
    : `Your meeting with ${parameters.hostName} is booked: ${parameters.title}`;
}

type Block = { readonly label: string; readonly lines: readonly string[] };

function blocks(parameters: MeetingParameters, language: RequestLanguage): Block[] {
  const labels = LABELS[language];
  const organizerName = parameters.organizerName ?? parameters.hostName;
  const organizerEmail = parameters.organizerEmail ?? parameters.hostEmail;

  return [
    { label: labels.what, lines: [parameters.title] },
    {
      label: labels.when,
      lines: [
        whenLine(parameters.start, parameters.end, parameters.timezone, language),
        durationText(parameters.durationMinutes, language),
      ],
    },
    {
      label: labels.who,
      lines: [
        `${organizerName}${organizerEmail ? ` <${organizerEmail}>` : ""} (${labels.organizer})`,
        `${parameters.requesterName} <${parameters.requesterEmail}> (${labels.guest})`,
      ],
    },
    {
      label: labels.where,
      lines: [
        parameters.mode === "in_person"
          ? (parameters.location ?? "")
          : parameters.joinUrl
            ? `${labels.online}: ${parameters.joinUrl}`
            : labels.online,
      ],
    },
  ];
}

function button(url: string, label: string) {
  return `<p style="margin:16px 0"><a href="${escapeHtml(url)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`;
}

function page(language: RequestLanguage, title: string, body: readonly string[]) {
  return [
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title></head>`,
    `<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">`,
    ...body,
    emailSignatureHtml(),
    `</body></html>`,
  ].join("");
}

function renderConfirmation(language: RequestLanguage, parameters: BookingEmailParameters, viewUrl: string): RenderedBookingEmail {
  const labels = LABELS[language];
  const subject = confirmationSubject(parameters);
  const lead = parameters.changed
    ? language === "ko"
      ? "미팅이 변경되었고 캘린더 일정도 바뀌었습니다."
      : "Your meeting was changed, and the calendar event is updated."
    : language === "ko"
      ? "미팅이 확정되어 캘린더에 추가되었습니다."
      : "Your meeting is confirmed and in the calendar.";
  const meeting = blocks(parameters, language);
  const bookingAction = parameters.audience === "host" ? "Open request" : labels.bookingAction;
  const join = parameters.mode === "online" && parameters.joinUrl ? parameters.joinUrl : null;
  const support = parameters.audience === "requester" && parameters.replyToAssistant ? labels.supportAssistant : labels.support;

  const html = page(language, subject, [
    `<p><strong style="display:inline-block;border:1px solid #111;border-radius:999px;padding:2px 10px">${escapeHtml(labels.confirmed)}</strong></p>`,
    `<p>${escapeHtml(lead)}</p>`,
    ...meeting.map(
      (block) =>
        `<p><strong>${escapeHtml(block.label)}</strong><br>${block.lines.map((line) => escapeHtml(line)).join("<br>")}</p>`,
    ),
    button(viewUrl, bookingAction),
    ...(join ? [button(join, labels.join)] : []),
    `<p style="color:#555;font-size:14px">${escapeHtml(support)}</p>`,
  ]);
  const text = [
    labels.confirmed,
    lead,
    "",
    ...meeting.flatMap((block) => [`${block.label}:`, ...block.lines, ""]),
    `${bookingAction}: ${viewUrl}`,
    ...(join ? [`${labels.join}: ${join}`] : []),
    "",
    support,
    "",
    "Find Me a Time",
  ].join("\n");

  return { html, subject, text };
}

// The host's notice that the requester cancelled a booked meeting
// (post-booking-changes design 4): the meeting as it was, and the request in /app.
function renderHostCancellation(language: RequestLanguage, parameters: BookingEmailParameters, viewUrl: string): RenderedBookingEmail {
  const when = whenLine(parameters.start, parameters.end, parameters.timezone, language);
  const name = parameters.requesterName;
  const copy =
    language === "ko"
      ? {
          action: "요청 보기",
          lead: `${name}님이 예약된 미팅(${when})을 취소했습니다.`,
          rest: "Google Calendar에서 일정을 지우고 있습니다. 일정이 남아 있으면 직접 삭제해 주세요.",
          subject: `${name}님이 미팅을 취소했습니다: ${parameters.title}`,
        }
      : {
          action: "View request",
          lead: `${name} cancelled your booked meeting (${when}).`,
          rest: "We are removing the event from your Google Calendar. If it is still there later, delete it yourself.",
          subject: `${name} cancelled: ${parameters.title}`,
        };

  const html = page(language, copy.subject, [
    `<p>${escapeHtml(copy.lead)}</p>`,
    `<p>${escapeHtml(copy.rest)}</p>`,
    button(viewUrl, copy.action),
  ]);
  const text = [copy.lead, "", copy.rest, "", `${copy.action}: ${viewUrl}`, "", "Find Me a Time"].join("\n");
  return { html, subject: copy.subject, text };
}

// changes: the "what changed" block a new-version notice shows after its first
// paragraph, when it knows the version it replaces.
type StatusCopy = {
  readonly subject: string;
  readonly paragraphs: readonly string[];
  readonly action: string;
  readonly changes?: { readonly label: string; readonly lines: readonly string[] };
};

function newVersionChanges(parameters: BookingEmailParameters, language: RequestLanguage) {
  if (!parameters.previous) return [];
  return changeLines(parameters.previous, parameters, language, (terms) =>
    whenLine(terms.start, terms.end, parameters.timezone, language),
  );
}

// byReply: the product inbox's notice, answered by replying (U15).
function statusCopy(
  template: Exclude<BookingEmailTemplate, "booking_confirmation" | "booking_cancelled">,
  language: RequestLanguage,
  parameters: BookingEmailParameters,
  byReply: boolean,
): StatusCopy {
  const host = parameters.hostName;
  const when = whenLine(parameters.start, parameters.end, parameters.timezone, language);
  const changes = template === "status_new_version" ? newVersionChanges(parameters, language) : [];

  if (language === "ko") {
    switch (template) {
      case "status_new_version":
        return {
          action: "새 제안 검토하기",
          ...(changes.length > 0 ? { changes: { label: "바뀐 내용", lines: changes } } : {}),
          paragraphs: [
            changes.length > 0 ? `${host}님이 미팅 세부 정보를 바꾸어 다시 보냈습니다.` : `${host}님이 미팅 세부 정보를 바꾸어 다시 보냈습니다: ${when}.`,
            byReply
              ? "아직 합의된 것은 없습니다. 동의하시거나 다른 것을 원하시면 이 메일에 답장해 주세요."
              : "아직 합의된 것은 없습니다. 예약 페이지에서 새 제안을 확인하고 동의해 주세요.",
          ],
          subject: `${host}님이 미팅 변경을 제안했습니다`,
        };
      case "status_declined":
        return {
          action: "요청 보기",
          paragraphs: [`${host}님이 이번 미팅 요청을 거절했습니다. 요청은 종료되었습니다.`],
          subject: `${host}님과의 미팅 요청이 종료되었습니다`,
        };
      case "status_expired":
        return {
          action: "요청 보기",
          paragraphs: [
            `${host}님과의 미팅 요청이 기한이 지나 종료되었습니다. ${byReply ? "다시 원하시면 이 메일에 답장해 주세요." : "다시 원하시면 새 요청을 시작해 주세요."}`,
          ],
          subject: `${host}님과의 미팅 요청이 만료되었습니다`,
        };
      case "status_pending":
        return {
          action: "예약 상태 확인",
          paragraphs: [
            `${host}님이 승인한 미팅(${when})을 Google Calendar에서 아직 확인하는 중입니다.`,
            byReply ? "아직 예약이 확정된 것은 아닙니다. 확정되면 알려 드릴게요." : "아직 예약이 확정된 것은 아닙니다. 결과가 나오면 예약 페이지에 표시됩니다.",
          ],
          subject: `${host}님과의 미팅 예약이 진행 중입니다`,
        };
      case "status_change_dropped":
        return {
          action: "예약 보기",
          paragraphs: [
            parameters.reason === "declined"
              ? `${host}님이 요청하신 변경을 받아들이지 않았습니다. 미팅은 원래대로 ${when}에 진행됩니다.`
              : `미팅 변경 요청이 기한 안에 마무리되지 않았습니다. 미팅은 원래대로 ${when}에 진행됩니다.`,
          ],
          subject: `${host}님과의 미팅은 원래 시간 그대로입니다`,
        };
      case "status_cancelled":
        return {
          action: "예약 보기",
          paragraphs: [
            `${host}님이 예약된 미팅(${when})을 취소했습니다. Google Calendar 초대도 취소됩니다.`,
            byReply ? "새로 시간을 잡고 싶으시면 이 메일에 답장해 주세요." : "다시 만나고 싶으시면 새 요청을 시작해 주세요.",
          ],
          subject: `${host}님과의 미팅이 취소되었습니다`,
        };
    }
  }

  switch (template) {
    case "status_new_version":
      return {
        action: "Review the new proposal",
        ...(changes.length > 0 ? { changes: { label: "What changed", lines: changes } } : {}),
        paragraphs: [
          changes.length > 0 ? `${host} suggested changes to your meeting request.` : `${host} suggested changes to your meeting request: ${when}.`,
          byReply
            ? "Nothing is agreed yet. Reply to agree, or to ask for something else."
            : "Nothing is agreed yet. Open your booking page to review the new proposal and agree to it.",
        ],
        subject: `${host} suggested a change to your meeting`,
      };
    case "status_declined":
      return {
        action: "View request",
        paragraphs: [`${host} declined this meeting request. The request is closed.`],
        subject: `Your meeting request with ${host} was closed`,
      };
    case "status_expired":
      return {
        action: "View request",
        paragraphs: [
          `Your meeting request with ${host} expired and is closed. ${byReply ? "Reply if you'd like to try again." : "Start a new request if you still want to meet."}`,
        ],
        subject: `Your meeting request with ${host} expired`,
      };
    case "status_pending":
      return {
        action: "Check booking status",
        paragraphs: [
          `${host} approved your proposed time (${when}). We are still checking Google Calendar, so the meeting is not booked yet.`,
          byReply ? "We'll let you know when the booking is confirmed." : "Your booking page will show the outcome.",
        ],
        subject: `Your meeting with ${host} is still being booked`,
      };
    case "status_change_dropped":
      return {
        action: "View booking",
        paragraphs: [
          parameters.reason === "declined"
            ? `${host} declined your change request. Your existing booking remains unchanged: ${when}.`
            : `Your change request was not confirmed in time. Your existing booking remains unchanged: ${when}.`,
        ],
        subject: `Your meeting with ${host} stays as booked`,
      };
    case "status_cancelled":
      return {
        action: "View booking",
        paragraphs: [
          `${host} cancelled your meeting (${when}). The Google Calendar invitation is cancelled too.`,
          byReply ? "Reply if you'd like to find a new time." : "Start a new request if you'd still like to meet.",
        ],
        subject: `Your meeting with ${host} was cancelled`,
      };
  }
}

// A status notice. Without a view link it is the requester's notice from the
// product inbox (guest-flow-completion U15): no booking link, and the guest
// answers by replying.
function renderStatus(
  template: Exclude<BookingEmailTemplate, "booking_confirmation" | "booking_cancelled">,
  language: RequestLanguage,
  parameters: BookingEmailParameters,
  viewUrl: string | null,
): RenderedBookingEmail {
  const copy = statusCopy(template, language, parameters, viewUrl === null);
  const greeting = language === "ko" ? `${parameters.requesterName}님, 안녕하세요.` : `Hi ${parameters.requesterName},`;
  const footer = viewUrl
    ? language === "ko"
      ? "이 링크는 요청을 여는 유일한 수단이니 다른 사람과 공유하지 마세요."
      : "This link is the only way into your request, so keep it to yourself."
    : language === "ko"
      ? "이 메일에 답장하면 Thyme과 이어서 이야기할 수 있습니다."
      : "Reply to this email to continue with Thyme.";

  const [lead = "", ...rest] = copy.paragraphs;
  const changes = copy.changes;

  const html = page(language, copy.subject, [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(lead)}</p>`,
    ...(changes
      ? [`<p><strong>${escapeHtml(changes.label)}</strong><br>${changes.lines.map((line) => escapeHtml(line)).join("<br>")}</p>`]
      : []),
    ...rest.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ...(viewUrl ? [button(viewUrl, copy.action)] : []),
    `<p style="color:#555;font-size:14px">${escapeHtml(footer)}</p>`,
  ]);
  const text = [
    greeting,
    "",
    lead,
    "",
    ...(changes ? [`${changes.label}:`, ...changes.lines, ""] : []),
    ...rest.flatMap((paragraph) => [paragraph, ""]),
    ...(viewUrl ? [`${copy.action}: ${viewUrl}`, ""] : []),
    footer,
    "",
    "Find Me a Time",
  ].join("\n");

  return { html, subject: copy.subject, text };
}

// Renders one booking email at dispatch. The view link is the booking link
// (opened from the sealed secret) for the requester and the /app link for the
// host; a confirmation cannot be rendered without one, and a requester's status
// notice without one is the product inbox's notice.
export function renderBookingEmail(
  template: BookingEmailTemplate,
  _language: RequestLanguage,
  parameters: BookingEmailParameters,
  secrets: { readonly bookingUrl?: string },
): RenderedBookingEmail {
  const language: RequestLanguage = "en";
  const viewUrl = parameters.audience === "host" ? parameters.viewUrl : secrets.bookingUrl;

  if (template === "booking_confirmation") {
    if (!viewUrl) throw new Error("A booking email needs its view link.");
    return renderConfirmation(language, parameters, viewUrl);
  }
  if (template === "booking_cancelled") {
    if (!viewUrl) throw new Error("A booking email needs its view link.");
    return renderHostCancellation(language, parameters, viewUrl);
  }
  return renderStatus(template, language, parameters, viewUrl ?? null);
}

// ---------------------------------------------------------------------------
// The calendar part

function icsDate(instant: string) {
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Escapes a TEXT value (RFC 5545 3.3.11).
function icsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Folds a content line at 75 octets (RFC 5545 3.1).
function fold(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// The METHOD:REQUEST invitation whose UID is the created event's iCalUID, so the
// recipient's calendar merges it with Google's own invitation instead of adding
// a second entry. Built only when that iCalUID is known.
export function calendarInvitation(parameters: MeetingParameters & { readonly uid: string; readonly stamp: string }) {
  const organizerEmail = parameters.organizerEmail ?? parameters.hostEmail;
  const location = parameters.mode === "in_person" ? parameters.location : parameters.joinUrl;
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Find Me a Time//Booking//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${parameters.uid}`,
    `DTSTAMP:${icsDate(parameters.stamp)}`,
    `DTSTART:${icsDate(parameters.start)}`,
    `DTEND:${icsDate(parameters.end)}`,
    `SUMMARY:${icsText(parameters.title)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    ...(organizerEmail ? [`ORGANIZER;CN=${icsText(parameters.organizerName ?? parameters.hostName)}:mailto:${organizerEmail}`] : []),
    `ATTENDEE;CN=${icsText(parameters.requesterName)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:${parameters.requesterEmail}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(fold).join("\r\n")}\r\n`;
}
