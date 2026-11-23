import { z } from "zod";
import { isActionableRequestState, type RequestState } from "../contracts/request";
import { cancelLockedMeeting } from "./booking-cancellation";
import { type NoticeDependencies, noticeDependenciesFromEnvironment } from "./booking-notices";
import type { Transaction } from "./database";
import type { ClaimedJob, JobHandler } from "./jobs";
import { cancelReservedBooking, closeRequest, dropChange, standingBookingOf } from "./request-lifecycle";

// The requests a deleted account had sent as a guest (guest-account-history
// D3). app.operator_delete_host, which both the Settings deletion and the
// operator's delete-host run, publishes one account_requests_close job naming
// the account's sent requests that were open or had a meeting still to come,
// before it deletes the account's matches to them. This handler then closes
// each one as its requester would: an open request is withdrawn, and a booked
// meeting that has not started is cancelled, which deletes the host's event and
// tells the host as a requester's cancellation does. The requests stay with
// their hosts under the 90-day rule. A booking whose write may exist throws
// booking_pending, so the job backs off and every request is tried again.

export const ACCOUNT_REQUESTS_CLOSE_JOB = "account_requests_close";

export type SentRequestFacts = {
  readonly state: RequestState;
  // Past its expiry: the request_expiry job closes it as usual.
  readonly expired: boolean;
  // A confirmed booking stands while the request changes it.
  readonly standingBooking: boolean;
  // That confirmed booking has not started.
  readonly meetingAhead: boolean;
};

export type SentRequestClosing = "withdraw" | "withdraw_booking" | "drop_change" | "cancel_meeting" | "leave";

// What closing one sent request does, from its locked state.
export function sentRequestClosing(facts: SentRequestFacts): SentRequestClosing {
  const open = isActionableRequestState(facts.state) || facts.state === "booking";

  if (facts.state === "booked") return facts.meetingAhead ? "cancel_meeting" : "leave";
  if (!open || (facts.expired && facts.state !== "booking")) return "leave";
  if (facts.standingBooking) return facts.meetingAhead ? "cancel_meeting" : "drop_change";
  return facts.state === "booking" ? "withdraw_booking" : "withdraw";
}

const payloadSchema = z.object({ requestIds: z.array(z.uuid()).max(10_000) });

export type AccountRequestsCloseOutcome = {
  readonly status: "missing" | "closed";
  readonly withdrawn?: number;
  readonly cancelled?: number;
  readonly left?: number;
};

export function createAccountRequestsCloseHandler(
  loadNotices: () => NoticeDependencies = noticeDependenciesFromEnvironment,
): JobHandler {
  return async (tx: Transaction, job: ClaimedJob): Promise<AccountRequestsCloseOutcome> => {
    const payload = payloadSchema.safeParse(job.payload);
    if (!payload.success) return { status: "missing" };

    let withdrawn = 0;
    let cancelled = 0;
    let left = 0;
    let notices: NoticeDependencies | null = null;

    // In ID order, as operator_delete_host listed them, so two jobs lock alike.
    for (const requestId of [...payload.data.requestIds].sort()) {
      const [request] = await tx<{ id: string; host_account_id: string; state: RequestState; revision: number; expired: boolean }[]>`
        select id, host_account_id, state, revision, expires_at <= now() as expired
        from app.requests where id = ${requestId}
        for update
      `;
      if (!request) {
        left += 1;
        continue;
      }

      const standing = (await standingBookingOf(tx, request.id)) !== null;
      const [ahead] = await tx<{ ahead: boolean }[]>`
        select exists (
          select 1 from app.bookings where request_id = ${request.id} and state = 'confirmed' and start_at > clock_timestamp()
        ) as ahead
      `;
      const closing = sentRequestClosing({ expired: request.expired, meetingAhead: Boolean(ahead?.ahead), standingBooking: standing, state: request.state });

      switch (closing) {
        case "withdraw":
          if (await closeRequest(tx, request.id, "withdrawn")) withdrawn += 1;
          break;
        case "withdraw_booking":
          await cancelReservedBooking(tx, request.id, "withdrawn");
          if (await closeRequest(tx, request.id, "withdrawn", { fromBooking: true })) withdrawn += 1;
          break;
        case "drop_change":
          if (await dropChange(tx, request.id, "withdrawn")) withdrawn += 1;
          break;
        case "cancel_meeting":
          notices ??= loadNotices();
          await cancelLockedMeeting(tx, request, { byHost: false, changing: request.state !== "booked", notices });
          cancelled += 1;
          break;
        case "leave":
          left += 1;
          break;
      }
    }

    return { cancelled, left, status: "closed", withdrawn };
  };
}
