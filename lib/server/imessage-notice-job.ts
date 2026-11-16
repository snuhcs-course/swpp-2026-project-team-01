import { changeLines } from "./booking-emails";
import { hostRequestUrl, type ProposalTermsRow, proposalTerms } from "./booking-notices";
import { type ChannelLanguage, hostConversationLanguage } from "./channel-language";
import { channelReplies, locale } from "./channel-texts";
import { database, type Database, type Transaction } from "./database";
import { readHostRequest } from "./host-requests";
import { decisionButtons, requestRef, requestSummary } from "./imessage-commands";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { type GuestNotice, guestNoticeKey, type HostNotice, noticeKey } from "./imessage-notices";
import { recordOutbound } from "./imessage-outbox";
import type { WhatsAppButtons } from "./photon";
import { activeRequesterBinding, requesterBindingRecipient } from "./requester-imessage-bindings";
import type { JobHandler } from "./jobs";
import type { HostRequestView } from "../contracts/host-request";
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
// On Telegram the awaiting-approval summary carries the proposal's decision
// buttons (host-telegram-channel design 7, D8); other channels ignore them.
// A host notice follows the language of the host's conversation and asks for
// no command (channel-actions-in-words D3, D4).

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

function bullets(lines: readonly string[]) {
  return lines.map((line) => `- ${line}`);
}

export const GUEST_NOTICE_TEXTS = {
  en: {
    status_new_version: (host: string, when: string, changes: readonly string[] = []) =>
      changes.length > 0
        ? [`${host} sent back changed meeting details:`, ...bullets(changes), "Nothing is agreed yet. Reply here to agree or to ask for something else."].join("\n")
        : `${host} sent back changed meeting details: ${when}. Nothing is agreed yet. Reply here to agree or to ask for something else.`,
    status_declined: (host: string) => `${host} declined this meeting request, so it is closed. Reply here if you'd like to ask again.`,
    status_expired: (host: string) => `Your meeting request with ${host} expired. Reply here if you'd like to try again.`,
    status_pending: (host: string, when: string) =>
      `${host} approved ${when}. It's still being confirmed in Google Calendar, so nothing is booked yet. I'll tell you here when it is.`,
    booking_confirmation: (host: string, when: string) =>
      `Booked with ${host}: ${when}. The invitation is in your email. Ask here anytime about the time or place.`,
    status_change_dropped: (host: string, when: string, reason: "declined" | "expired") =>
      reason === "declined"
        ? `${host} kept your meeting as it was, so it stays at ${when}.`
        : `Your change wasn't settled in time, so your meeting with ${host} stays at ${when}.`,
    status_cancelled: (host: string, when: string) =>
      `${host} cancelled your meeting (${when}). The calendar invitation is cancelled too. Write here if you'd like to ask for a new time.`,
  },
  ko: {
    status_new_version: (host: string, when: string, changes: readonly string[] = []) =>
      changes.length > 0
        ? [`${host}님이 미팅 세부 정보를 바꾸어 다시 보냈습니다:`, ...bullets(changes), "아직 합의된 것은 없습니다. 동의하시거나 다른 것을 원하시면 여기에 답장해 주세요."].join("\n")
        : `${host}님이 미팅 세부 정보를 바꾸어 다시 보냈습니다: ${when}. 아직 합의된 것은 없습니다. 동의하시거나 다른 것을 원하시면 여기에 답장해 주세요.`,
    status_declined: (host: string) => `${host}님이 이번 미팅 요청을 거절해 요청이 종료되었습니다. 다시 요청하려면 여기에 답장해 주세요.`,
    status_expired: (host: string) => `${host}님과의 미팅 요청이 기한이 지나 종료되었습니다. 다시 시도하려면 여기에 답장해 주세요.`,
    status_pending: (host: string, when: string) =>
      `${host}님이 ${when} 미팅을 승인했습니다. Google Calendar에서 아직 확인 중이라 예약이 확정된 것은 아닙니다. 확정되면 여기로 알려 드릴게요.`,
    booking_confirmation: (host: string, when: string) =>
      `${host}님과의 미팅이 예약되었습니다: ${when}. 초대장은 이메일에 있습니다. 시간이나 장소가 궁금하면 언제든 여기에 물어보세요.`,
    status_change_dropped: (host: string, when: string, reason: "declined" | "expired") =>
      reason === "declined"
        ? `${host}님이 미팅을 원래대로 유지했습니다. ${when}에 그대로 진행됩니다.`
        : `변경이 기한 안에 마무리되지 않아 ${host}님과의 미팅은 ${when} 그대로입니다.`,
    status_cancelled: (host: string, when: string) =>
      `${host}님이 미팅(${when})을 취소했습니다. 캘린더 초대도 함께 취소됩니다. 새로 시간을 잡고 싶으시면 여기에 적어 주세요.`,
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

  const zone = request.timezone && isValidTimeZone(request.timezone) ? request.timezone : "UTC";
  const timeOf = (start: Date, end: Date) => meetingTime(start, end, zone, language === "ko" ? "ko-KR" : "en-US");

  // A new version names what changed from the version it replaces, as its
  // email does (#198).
  if (notice.kind === "status_new_version") {
    const versions = await q<(ProposalTermsRow & { version: number })[]>`
      select version, start_at, end_at, details ->> 'mode' as mode, details ->> 'location' as location
      from app.proposals where request_id = ${requestId} and version in (${notice.version}, ${notice.version - 1})
    `;
    const next = versions.find((row) => row.version === notice.version);
    if (!next) return null;
    const previous = versions.find((row) => row.version === notice.version - 1);
    const changes = previous
      ? changeLines(proposalTerms(previous), proposalTerms(next), language, (terms) => timeOf(new Date(terms.start), new Date(terms.end)))
      : [];
    return texts.status_new_version(host, timeOf(next.start_at, next.end_at), changes);
  }

  const [meeting] = await q<{ start_at: Date; end_at: Date }[]>`
    select start_at, end_at from app.bookings where id = ${notice.bookingId} and request_id = ${requestId}
  `;
  if (!meeting) return null;
  if (notice.kind === "status_change_dropped") return texts.status_change_dropped(host, timeOf(meeting.start_at, meeting.end_at), notice.reason);
  return texts[notice.kind](host, timeOf(meeting.start_at, meeting.end_at));
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
  return { queued: true };
}

// A revised request names the earlier one (guest-flow-completion design 5).
function followsText(view: HostRequestView, language: ChannelLanguage) {
  if (!view.revisedFrom) return "";
  const texts = channelReplies(language);
  return view.revisedFrom.outcome === "declined" ? texts.followsDecline(view.revisedFrom.ref) : texts.followsExpired(view.revisedFrom.ref);
}

// The notice's text, with the decision buttons a WhatsApp summary of a proposal
// awaiting approval carries (host-whatsapp-channel D17), or null when it no
// longer applies.
async function noticeText(
  q: Transaction,
  deps: NoticeJobDependencies,
  hostAccountId: string,
  requestId: string,
  notice: HostNotice,
): Promise<{ text: string; buttons?: WhatsAppButtons } | null> {
  const view = await readHostRequest(q, hostAccountId, requestId);
  if (!view) return null;
  const language = await hostConversationLanguage(q, hostAccountId);
  const texts = channelReplies(language);
  const ref = requestRef(requestId);
  const link = hostRequestUrl(deps.origin, requestId);
  const follows = followsText(view, language);

  switch (notice.kind) {
    // No longer queued (#122); kept so a notice queued before the change still reads.
    case "new_request":
      return { text: texts.newRequest([texts.request(ref, view.requester.name, view.details.purpose), follows].filter(Boolean).join(" ")) };
    // The host's first message about a request (#122): the guest has picked and
    // agreed to a time, so the summary names the request and what it follows.
    case "awaiting_approval": {
      if (view.state !== "awaiting_host_approval" || view.proposal?.version !== notice.version) return null;
      return {
        buttons: decisionButtons(view, language),
        text: [texts.readyForApproval, requestSummary(view, language), follows, texts.selectedRequest].filter(Boolean).join("\n"),
      };
    }
    default: {
      const [booking] = await q<{ start_at: Date; end_at: Date }[]>`
        select start_at, end_at from app.bookings where id = ${notice.bookingId} and request_id = ${requestId}
      `;
      if (!booking) return null;
      const when = meetingTime(booking.start_at, booking.end_at, view.hostTimezone, locale(language));
      if (notice.kind === "booking_confirmed") return { text: texts.booked(view.requester.name, when) };
      if (notice.kind === "booking_failed") return { text: texts.bookingFailed(ref, when, link) };
      if (notice.kind === "booking_cancelled") return { text: texts.bookingCancelled(view.requester.name, when) };
      if (notice.kind === "booking_event_left") return { text: texts.bookingEventLeft(ref, when, link) };
      return { text: texts.bookingSlow(ref, when, link) };
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

    const summary = await noticeText(tx, deps, request.host_account_id, requestId, notice as HostNotice);
    if (!summary) return { queued: false };

    await recordOutbound(tx, {
      bindingId: binding.id,
      buttons: summary.buttons,
      dedupeKey: noticeKey(requestId, notice as HostNotice),
      hostAccountId: request.host_account_id,
      kind: "notice",
      recipient: bindingRecipient(deps.tokenKeys, binding),
      recipientHash: binding.sender_hash,
      requestId,
      text: summary.text,
      tokenKey: deps.tokenKey,
    });
    // The host's next plain reply goes to this request, so "book it" reaches the
    // discussion that can approve it (D23), as request <ref> would select it.
    if ((notice as HostNotice).kind === "awaiting_approval") {
      await tx`update app.imessage_bindings set selected_request_id = ${requestId} where id = ${binding.id} and state = 'active'`;
    }
    return { queued: true };
  };
}
