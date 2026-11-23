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
  // A confirmed booking stands while the request changes it.
  readonly standingBooking: boolean;
  // That confirmed booking has not started.
  readonly meetingAhead: boolean;
};

export type SentRequestClosing = "withdraw" | "withdraw_booking" | "drop_change" | "cancel_meeting" | "leave";

// What closing one sent request does, from its locked state.
export function sentRequestClosing(facts: SentRequestFacts): SentRequestClosing {
  const open = isActionableRequestState(facts.state) || facts.state === "booking";

  // An open request past its expiry is closed here too, before the expiry job
  // could book a change's meeting back or email the deleted account.
  if (facts.state === "booked") return facts.meetingAhead ? "cancel_meeting" : "leave";
  if (!open) return "leave";
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

    // Every request is locked first, in ID order, before any host lock: a
    // command on one of them then waits for this job instead of holding the
    // request while it waits for a host lock this job holds.
    const ids = [...new Set(payload.data.requestIds)].sort();
    const locked = ids.length === 0 ? [] : await tx<{ id: string; host_account_id: string; state: RequestState; revision: number }[]>`
      select id, host_account_id, state, revision
      from app.requests where id in ${tx(ids)}
      order by id
      for update
    `;
    left += ids.length - locked.length;

    for (const request of locked) {

      const standing = (await standingBookingOf(tx, request.id)) !== null;
      const [ahead] = await tx<{ ahead: boolean }[]>`
        select exists (
          select 1 from app.bookings where request_id = ${request.id} and state = 'confirmed' and start_at > clock_timestamp()
        ) as ahead
      `;
      const closing = sentRequestClosing({ meetingAhead: Boolean(ahead?.ahead), standingBooking: standing, state: request.state });

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
          await cancelLockedMeeting(tx, request, { byHost: false, changing: request.state !== "booked", notices: loadNotices });
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
