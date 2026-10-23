import { hostRequestUrl } from "./booking-notices";
import { database, type Database, type Transaction } from "./database";
import { readHostRequest } from "./host-requests";
import { requestRef, requestSummary } from "./imessage-commands";
import { activeBindingOfHost, bindingRecipient } from "./imessage-links";
import { type HostNotice, noticeKey } from "./imessage-notices";
import { recordOutbound } from "./imessage-outbox";
import type { JobHandler } from "./jobs";
import { appOriginsFromEnvironment } from "./same-origin";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The imessage_notice job (host-imessage-channel design 10, D12): freezes one
// host summary from the event's own records (the proposal version or the
// booking it names) into one outbound message to the active binding, once per
// event, and skips an awaiting-approval summary whose version is no longer the
// latest. A delivery result never changes request or booking state.

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

function meetingTime(start: Date, end: Date, zone: string) {
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: zone, weekday: "short" }).format(start);
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day}, ${clock.format(start)}–${clock.format(end)} (${zone})`;
}

// The notice's text, or null when it no longer applies.
async function noticeText(q: Transaction, deps: NoticeJobDependencies, hostAccountId: string, requestId: string, notice: HostNotice) {
  const view = await readHostRequest(q, hostAccountId, requestId);
  if (!view) return null;
  const ref = requestRef(requestId);
  const link = hostRequestUrl(deps.origin, requestId);

  switch (notice.kind) {
    case "new_request":
      return `New request ${ref} from ${view.requester.name}${view.details.purpose ? `: ${view.details.purpose}` : ""}. Send request ${ref} to discuss it here.`;
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
    const notice = job.payload.notice as HostNotice | undefined;
    if (!requestId || !notice?.kind) return { queued: false };

    const deps = load();
    const [request] = await tx<{ host_account_id: string }[]>`select host_account_id from app.requests where id = ${requestId}`;
    if (!request) return { queued: false };

    const binding = await activeBindingOfHost(tx, request.host_account_id);
    if (!binding) return { queued: false };

    const text = await noticeText(tx, deps, request.host_account_id, requestId, notice);
    if (!text) return { queued: false };

    await recordOutbound(tx, {
      bindingId: binding.id,
      dedupeKey: noticeKey(requestId, notice),
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
