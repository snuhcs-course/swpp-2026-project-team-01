import { hostRequestUrl } from "./booking-notices";
import { database, type Database, type Transaction } from "./database";
import { readHostRequest } from "./host-requests";
import { requestRef, requestSummary } from "./imessage-commands";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { type GuestNotice, guestNoticeKey, type HostNotice, noticeKey } from "./imessage-notices";
import { recordOutbound } from "./imessage-outbox";
import { activeRequesterBinding, endRequesterBindings, requesterBindingRecipient } from "./requester-imessage-bindings";
import type { JobHandler } from "./jobs";
import { isValidTimeZone } from "../contracts/timezone";
import { appOriginsFromEnvironment } from "./same-origin";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The imessage_notice job (host-imessage-channel design 10, D12): freezes one
// host summary from the event's own records (the proposal version or the
// booking it names) into one outbound message to the active binding, once per
// event, and skips an awaiting-approval summary whose version is no longer the
// latest. A delivery result never changes request or booking state. A guest's
// notice (guest-flow-completion design 4) goes to the request's active guest
// binding instead, in the request's language, and never carries the booking
// link; the booking confirmation is the last one, so the binding then ends.

export type NoticeJobDependencies = {
  readonly db: Database;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  readonly origin: string;
};

function noticeDependenciesFromEnvironment(): NoticeJobDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return { db: database(), origin: appOriginsFromEnvironment().appOrigin, tokenKey, tokenKeys: [tokenKey] };
}

function meetingTime(start: Date, end: Date, zone: string, locale = "en-US") {
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: zone, weekday: "short" }).format(start);
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day}, ${clock.format(start)}–${clock.format(end)} (${zone})`;
}

export const GUEST_NOTICE_TEXTS = {
  en: {
    status_new_version: (host: string, when: string) =>
      `${host} sent back changed meeting details: ${when}. Nothing is agreed yet. Open your booking page from your email to review and agree.`,
    status_declined: (host: string) => `${host} declined this meeting request, so it is closed. Reply here if you'd like to ask again.`,
    status_expired: (host: string) => `Your meeting request with ${host} expired. Reply here if you'd like to try again.`,
    status_pending: (host: string, when: string) =>
      `${host} approved ${when}. It's still being confirmed in Google Calendar, so nothing is booked yet. Your booking page will show the result.`,
    booking_confirmation: (host: string, when: string) => `Booked with ${host}: ${when}. The invitation and details are in your email.`,
  },
  ko: {
    status_new_version: (host: string, when: string) =>
      `${host}님이 미팅 세부 정보를 바꾸어 다시 보냈습니다: ${when}. 아직 합의된 것은 없습니다. 이메일의 예약 페이지에서 확인하고 동의해 주세요.`,
    status_declined: (host: string) => `${host}님이 이번 미팅 요청을 거절해 요청이 종료되었습니다. 다시 요청하려면 여기에 답장해 주세요.`,
    status_expired: (host: string) => `${host}님과의 미팅 요청이 기한이 지나 종료되었습니다. 다시 시도하려면 여기에 답장해 주세요.`,
    status_pending: (host: string, when: string) =>
      `${host}님이 ${when} 미팅을 승인했습니다. Google Calendar에서 아직 확인 중이라 예약이 확정된 것은 아닙니다. 결과는 예약 페이지에 표시됩니다.`,
    booking_confirmation: (host: string, when: string) => `${host}님과의 미팅이 예약되었습니다: ${when}. 초대장과 세부 정보는 이메일에 있습니다.`,
  },
} as const;

// A guest notice's text from the event's own records, or null when the record is gone.
async function guestNoticeText(q: Transaction, requestId: string, notice: GuestNotice) {
  const [request] = await q<{ host_name: string | null; language: string | null; timezone: string | null }[]>`
    select s.settings ->> 'displayName' as host_name, r.details ->> 'language' as language, r.details ->> 'timezone' as timezone
    from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${requestId}
  `;
  if (!request) return null;
  const language = request.language === "ko" ? "ko" : "en";
  const texts = GUEST_NOTICE_TEXTS[language];
  const host = request.host_name ?? (language === "ko" ? "호스트" : "Your host");

  if (notice.kind === "status_declined" || notice.kind === "status_expired") return texts[notice.kind](host);

  const [meeting] =
    notice.kind === "status_new_version"
      ? await q<{ start_at: Date; end_at: Date }[]>`
          select start_at, end_at from app.proposals where request_id = ${requestId} and version = ${notice.version}
        `
      : await q<{ start_at: Date; end_at: Date }[]>`
          select start_at, end_at from app.bookings where id = ${notice.bookingId} and request_id = ${requestId}
        `;
  if (!meeting) return null;
  const zone = request.timezone && isValidTimeZone(request.timezone) ? request.timezone : "UTC";
  return texts[notice.kind](host, meetingTime(meeting.start_at, meeting.end_at, zone, language === "ko" ? "ko-KR" : "en-US"));
}

async function recordGuestNotice(tx: Transaction, deps: NoticeJobDependencies, requestId: string, notice: GuestNotice) {
  const binding = await activeRequesterBinding(tx, requestId);
  if (!binding) return { queued: false };

  const text = await guestNoticeText(tx, requestId, notice);
  if (!text) return { queued: false };

  await recordOutbound(tx, {
    dedupeKey: guestNoticeKey(requestId, notice),
    kind: "notice",
    recipient: requesterBindingRecipient(deps.tokenKeys, binding),
    recipientHash: binding.sender_hash,
    requestId,
    requesterBindingId: binding.id,
    text,
    tokenKey: deps.tokenKey,
  });
  if (notice.kind === "booking_confirmation") await endRequesterBindings(tx, requestId, "ended");
  return { queued: true };
}

// The notice's text, or null when it no longer applies.
async function noticeText(q: Transaction, deps: NoticeJobDependencies, hostAccountId: string, requestId: string, notice: HostNotice) {
  const view = await readHostRequest(q, hostAccountId, requestId);
  if (!view) return null;
  const ref = requestRef(requestId);
  const link = hostRequestUrl(deps.origin, requestId);

  switch (notice.kind) {
    case "new_request": {
      // A revised request names the earlier one (guest-flow-completion design 5).
      const follows = view.revisedFrom
        ? view.revisedFrom.outcome === "declined"
          ? ` It follows your decline of request ${view.revisedFrom.ref}.`
          : ` It follows request ${view.revisedFrom.ref}, which expired.`
        : "";
      return `New request ${ref} from ${view.requester.name}${view.details.purpose ? `: ${view.details.purpose}` : ""}.${follows} Send request ${ref} to discuss it here.`;
    }
    case "awaiting_approval":
      if (view.state !== "awaiting_host_approval" || view.proposal?.version !== notice.version) return null;
      return `Ready for your approval.\n${requestSummary(view)}`;
    default: {
      const [booking] = await q<{ start_at: Date; end_at: Date }[]>`
        select start_at, end_at from app.bookings where id = ${notice.bookingId} and request_id = ${requestId}
      `;
      if (!booking) return null;
      const when = meetingTime(booking.start_at, booking.end_at, view.hostTimezone);
      if (notice.kind === "booking_confirmed") return `Booked with ${view.requester.name}: ${when}. It's on your calendar.`;
      if (notice.kind === "booking_failed") return `The booking for request ${ref} (${when}) wasn't confirmed. Check it in Find Me a Time: ${link}`;
      return `The booking for request ${ref} (${when}) is taking longer than usual to confirm. Check it in Find Me a Time: ${link}`;
    }
  }
}

export function createImessageNoticeHandler(load: () => NoticeJobDependencies = noticeDependenciesFromEnvironment): JobHandler {
  return async (tx, job) => {
    const requestId = typeof job.payload.requestId === "string" ? job.payload.requestId : null;
    const notice = job.payload.notice as HostNotice | GuestNotice | undefined;
    if (!requestId || !notice?.kind) return { queued: false };

    const deps = load();
    if (job.payload.audience === "requester") return recordGuestNotice(tx, deps, requestId, job.payload.notice as GuestNotice);

    const [request] = await tx<{ host_account_id: string }[]>`select host_account_id from app.requests where id = ${requestId}`;
    if (!request) return { queued: false };

    const binding = await activeBindingOfHost(tx, request.host_account_id);
    if (!binding) return { queued: false };

    const text = await noticeText(tx, deps, request.host_account_id, requestId, notice as HostNotice);
    if (!text) return { queued: false };

    await recordOutbound(tx, {
      bindingId: binding.id,
      dedupeKey: noticeKey(requestId, notice as HostNotice),
      hostAccountId: request.host_account_id,
      kind: "notice",
      recipient: bindingRecipient(deps.tokenKeys, binding),
      recipientHash: binding.sender_hash,
      requestId,
      text,
      tokenKey: deps.tokenKey,
    });
    return { queued: true };
  };
}
