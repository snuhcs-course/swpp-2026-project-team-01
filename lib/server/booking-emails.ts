import type { RequestLanguage } from "../contracts/request";

// The booking confirmation and the requester status notifications
// (host-review-and-booking design 9), in English and Korean, each rendered as
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
};

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

// "Monday, 2 November 2026, 10:00–10:30 (Asia/Seoul, GMT+9)", or in Korean
// "2026년 11월 2일 월요일 10:00–10:30 (Asia/Seoul, GMT+9)": the date and clock in
// the recipient's zone, with the zone named.
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
    what: "무엇",
    when: "언제",
    where: "어디",
    who: "누구",
  },
} as const;

function confirmationSubject(parameters: BookingEmailParameters, language: RequestLanguage) {
  return language === "ko"
    ? `${parameters.hostName} 와 ${parameters.requesterName} 사이의 ${parameters.title}`
    : `${parameters.title} between ${parameters.hostName} and ${parameters.requesterName}`;
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
    `<p style="color:#555;font-size:14px">Find Me a Time</p>`,
    `</body></html>`,
  ].join("");
}

function renderConfirmation(language: RequestLanguage, parameters: BookingEmailParameters, viewUrl: string): RenderedBookingEmail {
  const labels = LABELS[language];
  const subject = confirmationSubject(parameters, language);
  const lead =
    language === "ko"
      ? "미팅이 확정되어 캘린더에 추가되었습니다."
      : "Your meeting is confirmed and in the calendar.";
  const meeting = blocks(parameters, language);
  const join = parameters.mode === "online" && parameters.joinUrl ? parameters.joinUrl : null;

  const html = page(language, subject, [
    `<p><strong style="display:inline-block;border:1px solid #111;border-radius:999px;padding:2px 10px">${escapeHtml(labels.confirmed)}</strong></p>`,
    `<p>${escapeHtml(lead)}</p>`,
    ...meeting.map(
      (block) =>
        `<p><strong>${escapeHtml(block.label)}</strong><br>${block.lines.map((line) => escapeHtml(line)).join("<br>")}</p>`,
    ),
    button(viewUrl, labels.bookingAction),
    ...(join ? [button(join, labels.join)] : []),
    `<p style="color:#555;font-size:14px">${escapeHtml(labels.support)}</p>`,
  ]);
  const text = [
    labels.confirmed,
    lead,
    "",
    ...meeting.flatMap((block) => [`${block.label}:`, ...block.lines, ""]),
    `${labels.bookingAction}: ${viewUrl}`,
    ...(join ? [`${labels.join}: ${join}`] : []),
    "",
    labels.support,
    "",
    "Find Me a Time",
  ].join("\n");

  return { html, subject, text };
}

type StatusCopy = { readonly subject: string; readonly paragraphs: readonly string[]; readonly action: string };

function statusCopy(template: Exclude<BookingEmailTemplate, "booking_confirmation">, language: RequestLanguage, parameters: BookingEmailParameters): StatusCopy {
  const host = parameters.hostName;
  const when = whenLine(parameters.start, parameters.end, parameters.timezone, language);

  if (language === "ko") {
    switch (template) {
      case "status_new_version":
        return {
          action: "새 제안 검토하기",
          paragraphs: [
            `${host}님이 미팅 세부 정보를 바꾸어 다시 보냈습니다: ${when}.`,
            "아직 합의된 것은 없습니다. 예약 페이지에서 새 제안을 확인하고 동의해 주세요.",
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
          paragraphs: [`${host}님과의 미팅 요청이 기한이 지나 종료되었습니다. 다시 원하시면 새 요청을 시작해 주세요.`],
          subject: `${host}님과의 미팅 요청이 만료되었습니다`,
        };
      case "status_pending":
        return {
          action: "예약 상태 확인",
          paragraphs: [
            `${host}님이 승인한 미팅(${when})을 Google Calendar에서 아직 확인하는 중입니다.`,
            "아직 예약이 확정된 것은 아닙니다. 결과가 나오면 예약 페이지에 표시됩니다.",
          ],
          subject: `${host}님과의 미팅 예약이 진행 중입니다`,
        };
    }
  }

  switch (template) {
    case "status_new_version":
      return {
        action: "Review the new proposal",
        paragraphs: [
          `${host} sent back changed meeting details: ${when}.`,
          "Nothing is agreed yet. Open your booking page to review the new proposal and agree to it.",
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
        paragraphs: [`Your meeting request with ${host} expired and is closed. Start a new request if you still want to meet.`],
        subject: `Your meeting request with ${host} expired`,
      };
    case "status_pending":
      return {
        action: "Check booking status",
        paragraphs: [
          `${host} approved your meeting (${when}), and we are still confirming it with Google Calendar.`,
          "It is not booked yet. Your booking page will show the outcome.",
        ],
        subject: `Your meeting with ${host} is still being booked`,
      };
  }
}

function renderStatus(
  template: Exclude<BookingEmailTemplate, "booking_confirmation">,
  language: RequestLanguage,
  parameters: BookingEmailParameters,
  viewUrl: string,
): RenderedBookingEmail {
  const copy = statusCopy(template, language, parameters);
  const greeting = language === "ko" ? `${parameters.requesterName}님, 안녕하세요.` : `Hi ${parameters.requesterName},`;
  const footer =
    language === "ko"
      ? "이 링크는 요청을 여는 유일한 수단이니 다른 사람과 공유하지 마세요."
      : "This link is the only way into your request, so keep it to yourself.";

  const html = page(language, copy.subject, [
    `<p>${escapeHtml(greeting)}</p>`,
    ...copy.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    button(viewUrl, copy.action),
    `<p style="color:#555;font-size:14px">${escapeHtml(footer)}</p>`,
  ]);
  const text = [greeting, "", ...copy.paragraphs.flatMap((paragraph) => [paragraph, ""]), `${copy.action}: ${viewUrl}`, "", footer, "", "Find Me a Time"].join("\n");

  return { html, subject: copy.subject, text };
}

// Renders one booking email at dispatch. The view link is the booking link
// (opened from the sealed secret) for the requester and the /app link for the
// host; without one, the email cannot be rendered.
export function renderBookingEmail(
  template: BookingEmailTemplate,
  language: RequestLanguage,
  parameters: BookingEmailParameters,
  secrets: { readonly bookingUrl?: string },
): RenderedBookingEmail {
  const viewUrl = parameters.audience === "host" ? parameters.viewUrl : secrets.bookingUrl;
  if (!viewUrl) throw new Error("A booking email needs its view link.");

  return template === "booking_confirmation"
    ? renderConfirmation(language, parameters, viewUrl)
    : renderStatus(template, language, parameters, viewUrl);
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
