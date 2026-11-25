import { z } from "zod";
import type { RequestState } from "../contracts/request";
import { enqueueHostCancellation, enqueueStatusNotice, type NoticeDependencies, noticeDependenciesFromEnvironment } from "./booking-notices";
import { type BookingDependencies, bookingDependenciesFromEnvironment, lockHost, openCalendar } from "./bookings";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import type { Transaction } from "./database";
import { captureChangeBaseline, type ChangeBaseline } from "./request-change-baseline";
import { CalendarAccessError } from "./google-calendar";
import { enqueueButtonRetirement, enqueueHostNotice } from "./imessage-notices";
import { cancelReservedBooking, standingBookingOf } from "./request-lifecycle";
import { revokeRequestGrants } from "./requester-grants";
import { type JobHandler, publishJob } from "./jobs";

// Cancelling a booked meeting (post-booking-changes design 1 to 4).
//
// booking.cancel, by the request's host or its requester, until the meeting
// starts: under the request lock, the per-host advisory lock and the booking
// row lock it moves the confirmed booking to cancelled (host_cancelled or
// requester_cancelled, keeping confirmed_at and the evidence) and the request
// from booked to cancelled, publishes the booking_cancel job and records the
// other side's notices. The job deletes the Google event with
// sendUpdates=all, so Google sends the guest its cancellation; an uncertain
// outcome is retried, and a refusal or a lost grant tells the host to delete
// the event themselves. The request stays cancelled either way.
// Lock order: the request row, then the host advisory lock, then the booking row.

export const CANCEL_BOOKING_OPERATION = "booking.cancel";
export const BOOKING_CANCEL_JOB = "booking_cancel";
export const BOOKING_CANCEL_ATTEMPTS = 8;

export type CancelBookingResult = {
  readonly state: "cancelled";
  readonly revision: number;
  readonly bookingId: string;
  readonly start: string;
  readonly end: string;
};

type LockedRequest = { readonly id: string; readonly host_account_id: string; readonly state: RequestState; readonly revision: number };

// The request, locked, when the actor may act on it: its own active host, or
// its requester while the booking link lasts. Anything else is forbidden, the
// same answer whether or not the request exists.
async function lockForActor(tx: Transaction, actor: { readonly kind: string; readonly id: string }, requestId: string) {
  if (actor.kind === "host_account") {
    const [row] = await tx<(LockedRequest & { host_status: string })[]>`
      select r.id, r.host_account_id, r.state, r.revision, a.status as host_status
      from app.requests r join app.host_accounts a on a.id = r.host_account_id
      where r.id = ${requestId} and r.host_account_id = ${actor.id} and r.state <> 'draft'
      for update of r
    `;
    if (!row || row.host_status !== "active") throw new CommandError("forbidden");
    return row;
  }

  if (actor.kind === "requester_request" && actor.id === requestId) {
    const [row] = await tx<LockedRequest[]>`
      select r.id, r.host_account_id, r.state, r.revision
      from app.requests r join app.booking_links l on l.request_id = r.id
      where r.id = ${requestId} and r.state <> 'draft' and l.expires_at > now()
      for update of r
    `;
    if (!row) throw new CommandError("forbidden");
    return row;
  }

  throw new CommandError("forbidden");
}

// What closing an open request settles, for a change after booking that the
// cancellation ends (closeRequest does this for its own states).
async function closeOpenParts(tx: Transaction, requestId: string) {
  await enqueueButtonRetirement(tx, requestId);
  await revokeRequestGrants(tx, requestId);
  await tx`update app.request_reviews set state = 'superseded', resolved_at = now() where request_id = ${requestId} and state = 'pending'`;
  await tx`update app.shared_change_drafts set state = 'superseded', resolved_at = now() where request_id = ${requestId} and state = 'pending'`;
}

type BookedMeeting = {
  readonly id: string;
  readonly start_at: Date;
  readonly end_at: Date;
  readonly details: { readonly mode: "online" | "in_person"; readonly location: string | null };
  readonly evidence: { readonly joinUrl?: string | null } | null;
};

export function cancelBookingCommand(
  loadNotices: () => NoticeDependencies = noticeDependenciesFromEnvironment,
): CommandDefinition<Record<string, never>, CancelBookingResult> {
  return {
    input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    operation: CANCEL_BOOKING_OPERATION,
    async run(tx, context) {
      const request = await lockForActor(tx, context.actor, context.resourceId);

      if (request.state === "cancelled") throw new CommandError("request_closed");
      // While a change is open the booked meeting still stands and can be
      // cancelled; a change already dispatching may be in the calendar.
      const changing = request.state !== "booked" && (await standingBookingOf(tx, request.id)) !== null;
      if (request.state === "booking" && !changing) throw new CommandError("booking_pending");
      if (request.state !== "booked" && !changing) throw new CommandError("invalid_input", { reason: "not_booked" });
      assertRevision(request.revision, context.expectedRevision);

      return cancelLockedMeeting(tx, request, { byHost: context.actor.kind === "host_account", changing, notices: loadNotices });
    },
  };
}

// Cancels the confirmed meeting of a request the caller locked and checked,
// with the other side's notices: booking.cancel, and a deleted guest account's
// booked meetings (guest-account-history D3), which cancel as the requester.
export async function cancelLockedMeeting(
  tx: Transaction,
  request: { readonly id: string; readonly host_account_id: string; readonly revision: number },
  { byHost, changing, notices }: { readonly byHost: boolean; readonly changing: boolean; readonly notices: () => NoticeDependencies },
): Promise<CancelBookingResult> {
  await lockHost(tx, request.host_account_id);
  // The pre-dispatch cancellation categories reuse withdrawal and decline.
  if (changing) await cancelReservedBooking(tx, request.id, byHost ? "declined" : "withdrawn");
  const [booking] = await tx<BookedMeeting[]>`
    select b.id, b.start_at, b.end_at, p.details, b.evidence
    from app.bookings b join app.proposals p on p.id = b.proposal_id
    where b.request_id = ${request.id} and b.state = 'confirmed'
    for update of b
  `;
  if (!booking) throw new CommandError("invalid_input", { reason: "not_booked" });

  const [clock] = await tx<{ now: Date }[]>`select clock_timestamp() as now`;
  if (booking.start_at.getTime() <= clock!.now.getTime()) throw new CommandError("invalid_input", { reason: "start_passed" });

  await tx`
    update app.bookings
    set state = 'cancelled', failure_category = ${byHost ? "host_cancelled" : "requester_cancelled"},
        settled_at = now(), updated_at = now()
    where id = ${booking.id} and state = 'confirmed'
  `;
  await tx`
    update app.requests set state = 'cancelled', closed_at = now(), revision = revision + 1, updated_at = now()
    where id = ${request.id} and state in ('booked', 'gathering', 'negotiating', 'awaiting_host_approval', 'booking')
  `;
  if (changing) await closeOpenParts(tx, request.id);
  await publishJob(tx, {
    dedupeKey: `cancel:${booking.id}`,
    kind: BOOKING_CANCEL_JOB,
    maxAttempts: BOOKING_CANCEL_ATTEMPTS,
    payload: { bookingId: booking.id },
  });

  // Only the side that did not cancel is told; the side that did sees the
  // outcome where it acted (design 4).
  const meeting = {
    bookingId: booking.id,
    end: booking.end_at.toISOString(),
    joinUrl: booking.details.mode === "online" ? (booking.evidence?.joinUrl ?? null) : null,
    location: booking.details.mode === "in_person" ? booking.details.location : null,
    mode: booking.details.mode,
    start: booking.start_at.toISOString(),
  };
  if (byHost) {
    await enqueueStatusNotice(tx, notices(), request.id, { bookingId: booking.id, kind: "status_cancelled", meeting });
  } else {
    await enqueueHostNotice(tx, request.id, { bookingId: booking.id, kind: "booking_cancelled" });
    await enqueueHostCancellation(tx, notices(), request.id, meeting);
  }

  return { bookingId: booking.id, end: meeting.end, revision: request.revision + 1, start: meeting.start, state: "cancelled" };
}

// ---------------------------------------------------------------------------
// The booking_cancel job

export class CalendarDeletionPending extends Error {
  constructor() {
    super("The calendar deletion's outcome is unknown; it is retried.");
    this.name = "CalendarDeletionPending";
  }
}

export function createBookingCancelHandler(load: () => BookingDependencies = bookingDependenciesFromEnvironment): JobHandler {
  return async (tx, job) => {
    const bookingId = typeof job.payload.bookingId === "string" ? job.payload.bookingId : null;
    if (!bookingId) return { outcome: "missing" };

    const [booking] = await tx<
      { request_id: string; host_account_id: string; calendar_id: string; event_id: string; state: string; confirmed_at: Date | null }[]
    >`
      select request_id, host_account_id, calendar_id, event_id, state, confirmed_at from app.bookings where id = ${bookingId}
    `;
    if (!booking) return { outcome: "missing" };
    // Only a booking cancelled after confirmation had an event to remove.
    if (booking.state !== "cancelled" || !booking.confirmed_at) return { outcome: "not_cancelled" };

    const deps = load();
    let deleted: "deleted" | "rejected" | "uncertain";
    try {
      const calendar = await openCalendar(deps, booking.host_account_id);
      deleted = (await calendar.deleteEvent(booking.calendar_id, booking.event_id)).outcome;
    } catch (error) {
      // A lost or missing grant cannot be fixed by retrying; a failed refresh
      // or a transport error can.
      if (error instanceof CalendarAccessError && error.category !== "calendar_unavailable") deleted = "rejected";
      else throw new CalendarDeletionPending();
    }

    if (deleted === "uncertain") throw new CalendarDeletionPending();
    if (deleted === "rejected") {
      await enqueueHostNotice(tx, booking.request_id, { bookingId, kind: "booking_event_left" });
      return { bookingId, outcome: "event_left" };
    }
    return { bookingId, outcome: "deleted" };
  };
}

// ---------------------------------------------------------------------------
// booking.change: reopening a booked meeting for a change (design 5)

export const CHANGE_BOOKING_OPERATION = "booking.change";
// A change gets the request's usual seven days, but never past the meeting.
export const CHANGE_LIFETIME_DAYS = 7;

export type ChangeBookingResult = { readonly state: "negotiating"; readonly revision: number; readonly expiresAt: string; readonly restore?: ChangeBaseline };

// Either side reopens a booked meeting, until it starts, so a new time or
// place can go through the usual proposal, agreement and approval. The booked
// meeting stands meanwhile; withdrawing, declining or running out of time
// leaves it as it was, and approval patches its event in place.
export const changeBookingCommand: CommandDefinition<Record<string, never>, ChangeBookingResult> = {
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  operation: CHANGE_BOOKING_OPERATION,
  async run(tx, context) {
    const request = await lockForActor(tx, context.actor, context.resourceId);
    if (request.state === "cancelled") throw new CommandError("request_closed");
    if (request.state !== "booked") {
      // Already open for a change: nothing to do.
      if ((await standingBookingOf(tx, request.id)) && request.state !== "booking") {
        const [row] = await tx<{ expires_at: Date }[]>`select expires_at from app.requests where id = ${request.id}`;
        return { expiresAt: row!.expires_at.toISOString(), revision: request.revision, state: "negotiating" };
      }
      if (request.state === "booking") throw new CommandError("booking_pending");
      throw new CommandError("invalid_input", { reason: "not_booked" });
    }
    assertRevision(request.revision, context.expectedRevision);

    const [booking] = await tx<{ start_at: Date }[]>`
      select start_at from app.bookings where request_id = ${request.id} and state = 'confirmed'
    `;
    if (!booking) throw new CommandError("invalid_input", { reason: "not_booked" });
    const [clock] = await tx<{ now: Date }[]>`select clock_timestamp() as now`;
    if (booking.start_at.getTime() <= clock!.now.getTime()) throw new CommandError("invalid_input", { reason: "start_passed" });

    const restore = context.actor.kind === "requester_request" ? await captureChangeBaseline(tx, request.id, "booked") : null;
    const expiresAt = new Date(Math.min(clock!.now.getTime() + CHANGE_LIFETIME_DAYS * 86_400_000, booking.start_at.getTime()));
    await tx`
      update app.requests
      set state = 'negotiating', closed_at = null, expires_at = ${expiresAt}, revision = revision + 1, updated_at = now()
      where id = ${request.id} and state = 'booked'
    `;
    return { expiresAt: expiresAt.toISOString(), revision: request.revision + 1, state: "negotiating", ...(restore ? { restore } : {}) };
  },
};
