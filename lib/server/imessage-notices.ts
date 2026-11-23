import type { Transaction } from "./database";
import { publishJob } from "./jobs";

// Host summaries and outcomes in the linked conversation (host-imessage-channel
// design 10, D12). enqueueHostNotice runs in the transaction of the change it
// reports and records one imessage_notice job for that event, only when the
// request's host has an active binding; it needs no key and imports nothing
// heavy, so every domain path can call it. The job (imessage-notice-job.ts)
// freezes the text from the event's own records into one outbound message.

export const IMESSAGE_NOTICE_JOB = "imessage_notice";
export const SAMPLE_NOTICE_PREFIX = "notice:sample_request:";

export type HostNotice =
  | { readonly kind: "new_request" }
  | { readonly kind: "sample_request"; readonly bindingId: string }
  | { readonly kind: "awaiting_approval"; readonly version: number }
  | { readonly kind: "weekly_limit_hold"; readonly requestRevision: number; readonly settingsRevision: number; readonly weeklyLimit: number }
  | { readonly kind: "booking_confirmed"; readonly bookingId: string }
  | { readonly kind: "booking_failed"; readonly bookingId: string }
  // No longer queued (#173); kept so a notice queued before the change still reads.
  | { readonly kind: "booking_pending"; readonly bookingId: string }
  // The guest cancelled a booked meeting; the event could not be deleted
  // (post-booking-changes design 3 and 4).
  | { readonly kind: "booking_cancelled"; readonly bookingId: string }
  | { readonly kind: "booking_event_left"; readonly bookingId: string };

export function noticeKey(requestId: string, notice: HostNotice) {
  switch (notice.kind) {
    case "sample_request":
      return `${SAMPLE_NOTICE_PREFIX}${requestId}:${notice.bindingId}`;
    case "awaiting_approval":
      return `notice:${notice.kind}:${requestId}:v${notice.version}`;
    case "weekly_limit_hold":
      return `notice:${notice.kind}:${requestId}:r${notice.requestRevision}:s${notice.settingsRevision}`;
    case "new_request":
      return `notice:${notice.kind}:${requestId}`;
    default:
      return `notice:${notice.kind}:${requestId}:${notice.bookingId}`;
  }
}

export async function enqueueHostNotice(tx: Transaction, requestId: string, notice: HostNotice) {
  const [bound] = await tx<{ found: boolean }[]>`
    select true as found from app.requests r
    join app.imessage_bindings b on b.host_account_id = r.host_account_id and b.state = 'active'
    where r.id = ${requestId}
      and (${notice.kind !== "sample_request"} or b.id = ${notice.kind === "sample_request" ? notice.bindingId : null})
  `;
  if (!bound) return false;

  await publishJob(tx, {
    dedupeKey: noticeKey(requestId, notice),
    kind: IMESSAGE_NOTICE_JOB,
    payload: { notice, requestId },
  });
  return true;
}

// A guest's status notices in their linked conversation (guest-flow-completion
// design 4): the same events as their email notices, recorded the same way, only
// when the request has an active guest binding. The job freezes a short text
// without the booking link from the event's own records.
export type GuestNotice =
  | { readonly kind: "status_new_version"; readonly version: number }
  | { readonly kind: "status_declined" }
  | { readonly kind: "status_expired" }
  | { readonly kind: "status_pending"; readonly bookingId: string }
  | { readonly kind: "status_cancelled"; readonly bookingId: string }
  | { readonly kind: "status_change_dropped"; readonly bookingId: string; readonly reason: "declined" | "expired"; readonly version: number }
  | { readonly kind: "booking_confirmation"; readonly bookingId: string };

export function guestNoticeKey(requestId: string, notice: GuestNotice) {
  switch (notice.kind) {
    case "status_new_version":
      return `guest-notice:${notice.kind}:${requestId}:v${notice.version}`;
    case "status_change_dropped":
      return `guest-notice:${notice.kind}:${requestId}:v${notice.version}:${notice.reason}`;
    case "status_pending":
    case "status_cancelled":
    case "booking_confirmation":
      return `guest-notice:${notice.kind}:${requestId}:${notice.bookingId}`;
    default:
      return `guest-notice:${notice.kind}:${requestId}`;
  }
}

export async function enqueueGuestNotice(tx: Transaction, requestId: string, notice: GuestNotice) {
  const [bound] = await tx<{ found: boolean }[]>`
    select true as found from app.requester_imessage_bindings where request_id = ${requestId} and state = 'active'
  `;
  if (!bound) return;

  await publishJob(tx, {
    dedupeKey: guestNoticeKey(requestId, notice),
    kind: IMESSAGE_NOTICE_JOB,
    payload: { audience: "requester", notice, requestId },
  });
}

// Telegram decision buttons (host-telegram-channel design 7, D9): a path that
// moves a request out of awaiting approval, or to a new agreed version, calls
// this in its own transaction. When some Telegram message of the request carries
// buttons, it records one telegram_buttons job for the request's new state; the
// job (telegram-jobs.ts) removes the buttons that no longer name the current
// proposal.
export const TELEGRAM_BUTTONS_JOB = "telegram_buttons";

export async function enqueueButtonRetirement(tx: Transaction, requestId: string) {
  const [request] = await tx<{ revision: number; state: string }[]>`
    select r.revision, r.state from app.requests r
    where r.id = ${requestId}
      and exists (select 1 from app.imessage_outbox o where o.request_id = r.id and o.buttons is not null and o.state = 'accepted')
  `;
  if (!request) return;

  await publishJob(tx, {
    dedupeKey: `request:${requestId}:r${request.revision}:${request.state}`,
    kind: TELEGRAM_BUTTONS_JOB,
    payload: { requestId },
  });
}
