import type { Transaction } from "./database";
import { publishJob } from "./jobs";

// Host summaries and outcomes in the linked conversation (host-imessage-channel
// design 10, D12). enqueueHostNotice runs in the transaction of the change it
// reports and records one imessage_notice job for that event, only when the
// request's host has an active binding; it needs no key and imports nothing
// heavy, so every domain path can call it. The job (imessage-notice-job.ts)
// freezes the text from the event's own records into one outbound message.

export const IMESSAGE_NOTICE_JOB = "imessage_notice";

export type HostNotice =
  | { readonly kind: "new_request" }
  | { readonly kind: "awaiting_approval"; readonly version: number }
  | { readonly kind: "booking_confirmed"; readonly bookingId: string }
  | { readonly kind: "booking_failed"; readonly bookingId: string }
  | { readonly kind: "booking_pending"; readonly bookingId: string };

export function noticeKey(requestId: string, notice: HostNotice) {
  switch (notice.kind) {
    case "awaiting_approval":
      return `notice:${notice.kind}:${requestId}:v${notice.version}`;
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
  `;
  if (!bound) return;

  await publishJob(tx, {
    dedupeKey: noticeKey(requestId, notice),
    kind: IMESSAGE_NOTICE_JOB,
    payload: { notice, requestId },
  });
}

