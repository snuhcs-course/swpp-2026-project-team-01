import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BookingFailure, BookingReceipt, BookingState, BookingStatusView } from "../contracts/booking";
import type { LinkPlan, RequestDetails, RequestState } from "../contracts/request";
import type { ConfirmedSettings } from "../contracts/setup";
import { type NoticeDependencies, enqueueConfirmations, enqueueStatusNotice, noticeDependenciesFromEnvironment } from "./booking-notices";
import { buildEventPayload, eventIdFor } from "./calendar-events";
import { type Actor, assertRevision, type CommandDefinition, CommandError } from "./commands";
import { database, type Database, type Transaction } from "./database";
import { checkInterval, type EvaluationDependencies, evaluationDependenciesFromEnvironment, type IntervalCheck } from "./evaluation";
import type { BusyInterval } from "./feasibility";
import {
  CalendarAccessError,
  type CreatedEvent,
  type GoogleCalendarConfig,
  googleCalendarConfigFromEnvironment,
  type HostCalendar,
  openHostCalendar,
} from "./google-calendar";
import { enqueueHostNotice } from "./imessage-notices";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";
import { cancelReservedBooking, closeRequest } from "./request-lifecycle";
import { endpointHasher } from "./routes-client";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Approval and booking (calendar-booking; host-review-and-booking design 6, 7
// and 11).
//
// request.approve records the host's approval of the exact current, agreed
// version and reserves a booking under the request lock and the per-host
// advisory lock, then publishes the `booking` job. The job:
//   1. revalidates a reserved booking under both locks, on its own connection:
//      the request is still booking and unexpired, the approval and agreement
//      still name the latest version, the host is active, and the interval is
//      still feasible (fresh Calendar reads, route estimates under an hour old,
//      the host's other dispatching and confirmed bookings as busy);
//   2. freezes the event payload, marks the booking dispatching and commits,
//      still under both locks, before any network call, and publishes the
//      15-minute pending notice (D2);
//   3. inserts the event under the ID fixed before dispatch (D4);
//   4. confirms it (the request becomes booked, both confirmations are
//      recorded), fails it definitively (the approval is spent and the request
//      awaits approval again), or, when the outcome is unknown, fails the attempt
//      so the job retries as a reconciliation.
// A dispatching booking is only ever reconciled: read by its event ID, and
// inserted again with the same frozen payload and ID when Google has none
// (D9). Feasibility is never rechecked after dispatch.
// Lock order: the request row, then the host advisory lock, then the booking row.

export const BOOKING_JOB = "booking";
export const BOOKING_PENDING_JOB = "booking_pending_notice";
export const BOOKING_ATTEMPTS = 8;
export const PENDING_NOTICE_MINUTES = 15;
// Route estimates older than this are fetched again at booking.
export const BOOKING_ROUTE_MAX_AGE_HOURS = 1;

export const APPROVE_OPERATION = "request.approve";
export const DECLINE_OPERATION = "request.decline";
export const CHECK_BOOKING_OPERATION = "booking.check";

function hostLockKey(hostAccountId: string) {
  return `app.booking_host:${hostAccountId}`;
}

async function lockHost(tx: Transaction, hostAccountId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${hostLockKey(hostAccountId)}, 0))`;
}

// ---------------------------------------------------------------------------
// Host authority

export type HostLockedRequest = {
  readonly id: string;
  readonly host_account_id: string;
  readonly state: RequestState;
  readonly revision: number;
  readonly details: Partial<RequestDetails>;
  readonly requester_name: string | null;
  readonly contact_email: string | null;
  readonly expires_at: Date;
  readonly open: boolean;
};

// Locks a request for its own host's command. Another host's request, a draft or
// a missing one is forbidden (the same answer, so nothing reveals it exists); a
// suspended host is forbidden; a closed or expired request is request_closed.
export async function lockHostRequest(tx: Transaction, actor: Actor, requestId: string): Promise<HostLockedRequest> {
  if (actor.kind !== "host_account") throw new CommandError("forbidden");

  const [row] = await tx<(HostLockedRequest & { host_status: string })[]>`
    select r.id, r.host_account_id, r.state, r.revision, r.details, r.requester_name, r.contact_email, r.expires_at,
           (r.closed_at is null and r.expires_at > now()) as open, a.status as host_status
    from app.requests r
    join app.host_accounts a on a.id = r.host_account_id
    where r.id = ${requestId} and r.host_account_id = ${actor.id} and r.state <> 'draft'
    for update of r
  `;

  if (!row || row.host_status !== "active") throw new CommandError("forbidden");
  if (!row.open && row.state !== "booking") throw new CommandError("request_closed");

  const { host_status: _status, ...request } = row;
  return request;
}

type LatestProposal = {
  readonly id: string;
  readonly version: number;
  readonly start_at: Date;
  readonly end_at: Date;
  readonly details: {
    readonly mode: "online" | "in_person";
    readonly location: string | null;
    readonly linkPlan: LinkPlan | null;
    readonly durationMinutes: number;
  };
  readonly agreed: boolean;
};

export async function latestProposalOf(tx: Transaction | Database, requestId: string) {
  const [row] = await tx<LatestProposal[]>`
    select p.id, p.version, p.start_at, p.end_at, p.details,
           exists (select 1 from app.agreements a where a.proposal_id = p.id) as agreed
    from app.proposals p
    where p.request_id = ${requestId}
    order by p.version desc
    limit 1
  `;
  return row ?? null;
}

async function settingsOf(tx: Transaction, hostAccountId: string) {
  const [row] = await tx<{ settings: ConfirmedSettings }[]>`
    select settings from app.host_settings where host_account_id = ${hostAccountId}
  `;
  return row?.settings ?? null;
}

// ---------------------------------------------------------------------------
// request.approve

const approveInput = z.object({ version: z.number().int().min(1) }).strict();

export type ApproveResult = {
  readonly bookingId: string;
  readonly state: BookingState;
  readonly revision: number;
  readonly repeated: boolean;
};

export const approveCommand: CommandDefinition<z.infer<typeof approveInput>, ApproveResult> = {
  input: approveInput,
  operation: APPROVE_OPERATION,
  async run(tx, context) {
    const request = await lockHostRequest(tx, context.actor, context.resourceId);
    await lockHost(tx, request.host_account_id);

    // A second approval of the same version, from any interface and with any
    // retry key, observes the live booking instead of making another (AC-06).
    const [live] = await tx<{ booking_id: string; state: BookingState; version: number }[]>`
      select b.id as booking_id, b.state, p.version
      from app.bookings b join app.proposals p on p.id = b.proposal_id
      where b.request_id = ${request.id} and b.state in ('reserved', 'dispatching', 'confirmed')
    `;
    if (live) {
      if (live.version !== context.input.version) throw new CommandError("stale_revision", { reason: "proposal_superseded" });
      return { bookingId: live.booking_id, repeated: true, revision: request.revision, state: live.state };
    }

    if (!request.open) throw new CommandError("request_closed");
    assertRevision(request.revision, context.expectedRevision);

    const latest = await latestProposalOf(tx, request.id);
    if (!latest || latest.version !== context.input.version) {
      throw new CommandError("stale_revision", { reason: "proposal_superseded" });
    }
    // Only an agreed version awaiting the host: agreement is the requester's.
    if (request.state !== "awaiting_host_approval" || !latest.agreed) throw new CommandError("stale_revision");

    const [clock] = await tx<{ now: Date }[]>`select clock_timestamp() as now`;
    if (latest.start_at.getTime() <= clock!.now.getTime()) throw new CommandError("invalid_input", { reason: "start_passed" });

    const settings = await settingsOf(tx, request.host_account_id);
    if (!settings?.bookingCalendar?.id) throw new CommandError("unavailable_configuration");

    const [approval] = await tx<{ id: string }[]>`
      insert into app.approvals (request_id, proposal_id, host_account_id, request_revision, retry_key)
      values (${request.id}, ${latest.id}, ${request.host_account_id}, ${request.revision}, ${context.retryKey})
      returning id
    `;
    const bookingId = randomUUID();
    const before = (settings.bufferBeforeMinutes ?? 0) * 60_000;
    const after = (settings.bufferAfterMinutes ?? 0) * 60_000;

    await tx`
      insert into app.bookings
        (id, request_id, proposal_id, approval_id, host_account_id, calendar_id, event_id,
         start_at, end_at, reserved_start, reserved_end)
      values
        (${bookingId}, ${request.id}, ${latest.id}, ${approval!.id}, ${request.host_account_id},
         ${settings.bookingCalendar.id}, ${eventIdFor(bookingId)}, ${latest.start_at}, ${latest.end_at},
         ${new Date(latest.start_at.getTime() - before)}, ${new Date(latest.end_at.getTime() + after)})
    `;
    await tx`
      update app.requests set state = 'booking', revision = revision + 1, updated_at = now()
      where id = ${request.id}
    `;
    await publishJob(tx, {
      dedupeKey: `booking:${bookingId}`,
      kind: BOOKING_JOB,
      maxAttempts: BOOKING_ATTEMPTS,
      payload: { bookingId },
    });

    return { bookingId, repeated: false, revision: request.revision + 1, state: "reserved" };
  },
};

// ---------------------------------------------------------------------------
// request.decline

export type DeclineResult = { readonly state: "declined"; readonly revision: number };

export function declineCommand(loadNotices: () => NoticeDependencies = noticeDependenciesFromEnvironment): CommandDefinition<
  Record<string, never>,
  DeclineResult
> {
  return {
    input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    operation: DECLINE_OPERATION,
    async run(tx, context) {
      const request = await lockHostRequest(tx, context.actor, context.resourceId);
      if (!request.open) throw new CommandError("request_closed");
      assertRevision(request.revision, context.expectedRevision);

      if (request.state === "booking") await cancelReservedBooking(tx, request.id, "declined");

      if (!(await closeRequest(tx, request.id, "declined", { fromBooking: true }))) throw new CommandError("request_closed");
      await enqueueStatusNotice(tx, loadNotices(), request.id, { kind: "status_declined" });

      return { revision: request.revision + 1, state: "declined" };
    },
  };
}

// ---------------------------------------------------------------------------
// Reading

type BookingRow = {
  readonly id: string;
  readonly request_id: string;
  readonly state: BookingState;
  readonly failure_category: BookingFailure | null;
  readonly start_at: Date;
  readonly end_at: Date;
  readonly payload: Record<string, unknown> | null;
  readonly evidence: (CreatedEvent & Record<string, unknown>) | null;
  readonly dispatched_at: Date | null;
};

async function latestBooking(db: Transaction | Database, requestId: string) {
  const [row] = await db<(BookingRow & { details: LatestProposal["details"]; requester_name: string; contact_email: string })[]>`
    select b.id, b.request_id, b.state, b.failure_category, b.start_at, b.end_at, b.payload, b.evidence,
           b.dispatched_at, p.details, r.requester_name, r.contact_email
    from app.bookings b
    join app.proposals p on p.id = b.proposal_id
    join app.requests r on r.id = b.request_id
    where b.request_id = ${requestId}
    order by b.created_at desc
    limit 1
  `;
  return row ?? null;
}

// The receipt both audiences see, built only from a confirmed booking's
// evidence and frozen payload. calendarUrl is kept for the host.
function receiptOf(row: NonNullable<Awaited<ReturnType<typeof latestBooking>>>, audience: "host" | "requester"): BookingReceipt | null {
  if (row.state !== "confirmed" || !row.evidence || !row.payload) return null;

  const evidence = row.evidence;
  const linkPlan = row.details.linkPlan ?? null;
  const joinUrl = row.details.mode === "online" ? (evidence.joinUrl ?? (linkPlan?.kind === "requester_link" ? linkPlan.url : null)) : null;
  const calendarUrl =
    audience === "host" && evidence.htmlLink && /^https:\/\/([a-z0-9-]+\.)*google\.com\//.test(evidence.htmlLink) ? evidence.htmlLink : null;

  return {
    calendarUrl,
    durationMinutes: Math.round((row.end_at.getTime() - row.start_at.getTime()) / 60_000),
    end: row.end_at.toISOString(),
    joinUrl,
    linkPlan,
    location: row.details.mode === "in_person" ? row.details.location : null,
    mode: row.details.mode,
    organizer: { email: evidence.organizerEmail ?? null, name: evidence.organizerName ?? null },
    requester: { email: row.contact_email, name: row.requester_name },
    start: row.start_at.toISOString(),
    title: String(row.payload.summary ?? ""),
  };
}

export async function readBookingStatus(
  db: Transaction | Database,
  requestId: string,
  audience: "host" | "requester",
): Promise<BookingStatusView | null> {
  const row = await latestBooking(db, requestId);
  if (!row) return null;
  return { failure: row.failure_category, receipt: receiptOf(row, audience), state: row.state };
}

// ---------------------------------------------------------------------------
// booking.check (**Check booking status**)

export type CheckResult = { readonly status: BookingStatusView | null; readonly reconciling: boolean };

// Either party's status check. A dispatching booking whose job has stopped
// (exhausted, or between retries) gets a new reconciliation job; any other
// state is only read.
export const checkBookingCommand: CommandDefinition<Record<string, never>, CheckResult> = {
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  operation: CHECK_BOOKING_OPERATION,
  async run(tx, context) {
    const audience = context.actor.kind === "host_account" ? "host" : "requester";
    const [request] =
      context.actor.kind === "host_account"
        ? await tx<{ id: string }[]>`
            select id from app.requests where id = ${context.resourceId} and host_account_id = ${context.actor.id} and state <> 'draft'
          `
        : context.actor.kind === "requester_request" && context.actor.id === context.resourceId
          ? await tx<{ id: string }[]>`
              select r.id from app.requests r join app.booking_links l on l.request_id = r.id
              where r.id = ${context.resourceId} and l.expires_at > now()
            `
          : [];

    if (!request) throw new CommandError("forbidden");

    const row = await latestBooking(tx, request.id);
    let reconciling = false;

    if (row?.state === "dispatching") {
      const [running] = await tx<{ found: boolean }[]>`
        select true as found from app.jobs
        where kind = ${BOOKING_JOB} and payload ->> 'bookingId' = ${row.id} and state in ('pending', 'running')
        limit 1
      `;
      reconciling = true;
      if (!running) {
        await publishJob(tx, {
          dedupeKey: `booking:${row.id}:check:${context.retryKey}`,
          kind: BOOKING_JOB,
          maxAttempts: BOOKING_ATTEMPTS,
          payload: { bookingId: row.id },
        });
      }
    }

    return { reconciling, status: await readBookingStatus(tx, request.id, audience) };
  },
};

// ---------------------------------------------------------------------------
// The booking job

export type BookingDependencies = {
  // Its own connection: revalidation and the dispatch mark commit before the
  // Calendar call, outside the job's transaction.
  readonly db: Database;
  readonly calendar: GoogleCalendarConfig;
  readonly tokenKeys: readonly TokenKey[];
  readonly evaluation: EvaluationDependencies;
  readonly notices: NoticeDependencies;
  // Opens the host's calendar; the stored grant by default.
  readonly openCalendar?: (hostAccountId: string) => Promise<HostCalendar>;
};

export function bookingDependenciesFromEnvironment(): BookingDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return {
    calendar: googleCalendarConfigFromEnvironment(),
    db: database(),
    evaluation: evaluationDependenciesFromEnvironment(),
    notices: noticeDependenciesFromEnvironment(),
    tokenKeys: [tokenKey],
  };
}

type JobBooking = {
  readonly id: string;
  readonly request_id: string;
  readonly approval_id: string;
  readonly proposal_id: string;
  readonly host_account_id: string;
  readonly calendar_id: string;
  readonly event_id: string;
  readonly state: BookingState;
  readonly start_at: Date;
  readonly end_at: Date;
  readonly payload: Record<string, unknown> | null;
};

// Settles a booking that never dispatched or failed definitively, under the
// request lock the caller holds, with the next request revision.
async function settleFailure(
  tx: Transaction,
  booking: JobBooking,
  failure: BookingFailure,
  requestState: "negotiating" | "awaiting_host_approval",
  from: BookingState,
) {
  const settled = await tx`
    update app.bookings set state = 'failed', failure_category = ${failure}, settled_at = now(), updated_at = now()
    where id = ${booking.id} and state = ${from}
  `;
  if (settled.count === 0) return;

  await tx`update app.approvals set spent_at = now() where id = ${booking.approval_id} and spent_at is null`;
  await tx`
    update app.requests set state = ${requestState}, revision = revision + 1, updated_at = now()
    where id = ${booking.request_id} and state = 'booking'
  `;
  await enqueueHostNotice(tx, booking.request_id, { bookingId: booking.id, kind: "booking_failed" });
}

async function cancelForClosure(tx: Transaction, booking: JobBooking, failure: "withdrawn" | "declined" | "expired") {
  await tx`
    update app.bookings set state = 'cancelled', failure_category = ${failure}, settled_at = now(), updated_at = now()
    where id = ${booking.id} and state = 'reserved'
  `;
  await tx`update app.approvals set spent_at = now() where id = ${booking.approval_id} and spent_at is null`;
}

// The host's other dispatching and confirmed bookings, as busy time with their
// buffers, near this one.
async function otherBookingsBusy(tx: Transaction, booking: JobBooking, hash: (text: string) => string): Promise<BusyInterval[]> {
  const rows = await tx<{ details: LatestProposal["details"]; reserved_end: Date; reserved_start: Date }[]>`
    select b.reserved_start, b.reserved_end, p.details
    from app.bookings b join app.proposals p on p.id = b.proposal_id
    where b.host_account_id = ${booking.host_account_id} and b.id <> ${booking.id}
      and b.state in ('dispatching', 'confirmed')
      and b.reserved_end > ${new Date(booking.start_at.getTime() - 86_400_000)}
      and b.reserved_start < ${new Date(booking.end_at.getTime() + 86_400_000)}
  `;

  return rows.map((row) => ({
    allDay: false,
    end: row.reserved_end.getTime(),
    endpoint:
      row.details.mode === "in_person" && row.details.location
        ? { key: hash(row.details.location), kind: "place" as const, text: row.details.location }
        : { kind: "unknown" as const, reason: row.details.mode === "online" ? ("conference_only" as const) : ("no_location" as const) },
    start: row.reserved_start.getTime(),
  }));
}

type Claim =
  | { readonly kind: "done"; readonly outcome: string }
  | { readonly kind: "dispatch"; readonly booking: JobBooking; readonly payload: Record<string, unknown> }
  | { readonly kind: "reconcile"; readonly booking: JobBooking };

// Phase 1: revalidate a reserved booking and commit its dispatch mark, or hand
// a dispatching one to reconciliation.
async function claimBooking(deps: BookingDependencies, bookingId: string): Promise<Claim> {
  return (await deps.db.begin(async (tx) => {
    const [ref] = await tx<{ request_id: string }[]>`select request_id from app.bookings where id = ${bookingId}`;
    if (!ref) return { kind: "done", outcome: "missing" };

    const [request] = await tx<{ expired: boolean; host_status: string; state: RequestState }[]>`
      select r.state, r.expires_at <= now() as expired, a.status as host_status
      from app.requests r join app.host_accounts a on a.id = r.host_account_id
      where r.id = ${ref.request_id}
      for update of r
    `;
    const [booking] = await tx<JobBooking[]>`
      select id, request_id, approval_id, proposal_id, host_account_id, calendar_id, event_id, state, start_at, end_at, payload
      from app.bookings where id = ${bookingId}
      for update
    `;

    if (!request || !booking) return { kind: "done", outcome: "missing" };
    if (booking.state === "dispatching") return { booking, kind: "reconcile" };
    if (booking.state !== "reserved") return { kind: "done", outcome: booking.state };

    await lockHost(tx, booking.host_account_id);

    // The request moved on under the booking: closed by withdrawal or decline
    // (which cancel a reserved booking themselves), or expired before dispatch.
    if (request.state !== "booking") {
      await cancelForClosure(tx, booking, "withdrawn");
      return { kind: "done", outcome: "cancelled" };
    }
    if (request.expired) {
      await cancelForClosure(tx, booking, "expired");
      await closeRequest(tx, booking.request_id, "expired", { fromBooking: true });
      await enqueueStatusNotice(tx, deps.notices, booking.request_id, { kind: "status_expired" });
      return { kind: "done", outcome: "expired" };
    }

    const [decision] = await tx<{ approval_live: boolean; current: boolean }[]>`
      select a.spent_at is null as approval_live,
             (p.version = (select max(version) from app.proposals where request_id = p.request_id)
              and exists (select 1 from app.agreements g where g.proposal_id = p.id)) as current
      from app.approvals a join app.proposals p on p.id = a.proposal_id
      where a.id = ${booking.approval_id}
    `;

    if (request.host_status !== "active" || !decision?.approval_live || !decision.current) {
      await settleFailure(tx, booking, "stale_decision", "awaiting_host_approval", "reserved");
      return { kind: "done", outcome: "stale_decision" };
    }

    const hash = endpointHasher(deps.tokenKeys[0]!);
    const check: IntervalCheck = await checkInterval(
      tx,
      deps.evaluation,
      booking.request_id,
      { end: booking.end_at, start: booking.start_at },
      {
        extraHostBusy: await otherBookingsBusy(tx, booking, hash),
        requesterCalendar: false,
        routeMaxAgeHours: BOOKING_ROUTE_MAX_AGE_HOURS,
      },
    );

    if (!check.ok) {
      if (check.problem === "unavailable") {
        const revoked = check.category === "calendar_access_revoked" || check.category === "calendar_not_connected";
        await settleFailure(
          tx,
          booking,
          revoked ? "calendar_access_revoked" : "revalidation_unavailable",
          "awaiting_host_approval",
          "reserved",
        );
        return { kind: "done", outcome: revoked ? "calendar_access_revoked" : "revalidation_unavailable" };
      }
      await settleFailure(tx, booking, "conflict", "negotiating", "reserved");
      return { kind: "done", outcome: "conflict" };
    }

    const payload = await framePayload(tx, booking);
    await tx`
      update app.bookings
      set state = 'dispatching', payload = ${tx.json(payload as Parameters<typeof tx.json>[0])},
          dispatched_at = now(), attempts = attempts + 1, updated_at = now()
      where id = ${booking.id} and state = 'reserved'
    `;
    await publishJob(tx, {
      dedupeKey: `pending:${booking.id}`,
      kind: BOOKING_PENDING_JOB,
      payload: { bookingId: booking.id },
      runAfter: new Date(Date.now() + PENDING_NOTICE_MINUTES * 60_000),
    });

    return { booking: { ...booking, payload, state: "dispatching" }, kind: "dispatch", payload };
  })) as Claim;
}

// The frozen events.insert body, from the proposal, the request and the host's
// settings at dispatch.
async function framePayload(tx: Transaction, booking: JobBooking) {
  const [row] = await tx<
    { contact_email: string; details: LatestProposal["details"]; purpose: string | null; requester_name: string; timezone: string | null }[]
  >`
    select p.details, r.requester_name, r.contact_email, r.details ->> 'purpose' as purpose,
           s.settings ->> 'timezone' as timezone
    from app.bookings b
    join app.proposals p on p.id = b.proposal_id
    join app.requests r on r.id = b.request_id
    left join app.host_settings s on s.host_account_id = b.host_account_id
    where b.id = ${booking.id}
  `;

  return buildEventPayload({
    bookingId: booking.id,
    end: booking.end_at.toISOString(),
    hostTimezone: row!.timezone ?? "UTC",
    linkPlan: row!.details.linkPlan ?? null,
    location: row!.details.location ?? null,
    mode: row!.details.mode,
    purpose: row!.purpose,
    requester: { email: row!.contact_email, name: row!.requester_name },
    start: booking.start_at.toISOString(),
  });
}

type Written = { readonly kind: "confirmed"; readonly event: CreatedEvent } | { readonly kind: "rejected"; readonly failure: BookingFailure } | { readonly kind: "unknown" };

async function openCalendar(deps: BookingDependencies, hostAccountId: string) {
  return deps.openCalendar
    ? deps.openCalendar(hostAccountId)
    : openHostCalendar({ config: deps.calendar, db: deps.db, tokenKeys: deps.tokenKeys }, hostAccountId);
}

// Inserts the frozen payload under its fixed ID; a duplicate is read back.
async function insertOnce(calendar: HostCalendar, booking: JobBooking, payload: Record<string, unknown>): Promise<Written> {
  const inserted = await calendar.insertEvent(booking.calendar_id, payload);

  if (inserted.outcome === "created") return { event: inserted.event, kind: "confirmed" };
  if (inserted.outcome === "rejected") return { failure: "calendar_rejected", kind: "rejected" };
  if (inserted.outcome === "uncertain") return { kind: "unknown" };

  const read = await calendar.getEvent(booking.calendar_id, booking.event_id);
  if (read.outcome === "found") return read.event.status === "cancelled" ? { failure: "event_removed", kind: "rejected" } : { event: read.event, kind: "confirmed" };
  return { kind: "unknown" };
}

// Reconciliation: the event by its ID first; inserted again, under the same ID
// and payload, only when Google has none.
async function reconcile(calendar: HostCalendar, booking: JobBooking): Promise<Written> {
  const read = await calendar.getEvent(booking.calendar_id, booking.event_id);

  if (read.outcome === "found") {
    return read.event.status === "cancelled" ? { failure: "event_removed", kind: "rejected" } : { event: read.event, kind: "confirmed" };
  }
  if (read.outcome === "uncertain" || !booking.payload) return { kind: "unknown" };
  return insertOnce(calendar, booking, booking.payload);
}

async function write(deps: BookingDependencies, claim: Extract<Claim, { kind: "dispatch" | "reconcile" }>): Promise<Written> {
  try {
    const calendar = await openCalendar(deps, claim.booking.host_account_id);
    return claim.kind === "dispatch" ? await insertOnce(calendar, claim.booking, claim.payload) : await reconcile(calendar, claim.booking);
  } catch (error) {
    if (error instanceof CalendarAccessError && error.category !== "calendar_unavailable") {
      return { failure: "calendar_access_revoked", kind: "rejected" };
    }
    // A token refresh that failed or a transport error: the insert may or may
    // not have been sent, so the attempt is retried as a reconciliation.
    return { kind: "unknown" };
  }
}

async function confirm(tx: Transaction, deps: BookingDependencies, booking: JobBooking, event: CreatedEvent) {
  await tx`select id from app.requests where id = ${booking.request_id} for update`;
  const confirmed = await tx<{ confirmed_at: Date }[]>`
    update app.bookings
    set state = 'confirmed', evidence = ${tx.json(event as unknown as Parameters<typeof tx.json>[0])},
        confirmed_at = now(), settled_at = now(), updated_at = now()
    where id = ${booking.id} and state = 'dispatching'
    returning confirmed_at
  `;
  if (confirmed.length === 0) return false;

  await closeRequest(tx, booking.request_id, "booked", { fromBooking: true });
  await enqueueHostNotice(tx, booking.request_id, { bookingId: booking.id, kind: "booking_confirmed" });
  const [proposal] = await tx<{ details: LatestProposal["details"] }[]>`select details from app.proposals where id = ${booking.proposal_id}`;
  const linkPlan = proposal?.details.linkPlan ?? null;

  await enqueueConfirmations(tx, deps.notices, booking.request_id, {
    bookingId: booking.id,
    confirmedAt: confirmed[0]!.confirmed_at.toISOString(),
    end: booking.end_at.toISOString(),
    iCalUID: event.iCalUID,
    joinUrl: proposal?.details.mode === "online" ? (event.joinUrl ?? (linkPlan?.kind === "requester_link" ? linkPlan.url : null)) : null,
    location: proposal?.details.mode === "in_person" ? (proposal.details.location ?? null) : null,
    mode: proposal?.details.mode ?? "online",
    organizerEmail: event.organizerEmail,
    organizerName: event.organizerName,
    start: booking.start_at.toISOString(),
  });
  return true;
}

export function createBookingHandler(load: () => BookingDependencies = bookingDependenciesFromEnvironment): JobHandler {
  return async (tx: Transaction, job: ClaimedJob) => {
    const bookingId = typeof job.payload.bookingId === "string" ? job.payload.bookingId : null;
    if (!bookingId) return { outcome: "missing" };

    const deps = load();
    const claim = await claimBooking(deps, bookingId);
    if (claim.kind === "done") return { bookingId, outcome: claim.outcome };

    if (claim.kind === "reconcile") {
      await deps.db`update app.bookings set attempts = attempts + 1, updated_at = now() where id = ${bookingId}`;
    }

    const written = await write(deps, claim);

    if (written.kind === "confirmed") {
      await confirm(tx, deps, claim.booking, written.event);
      return { bookingId, outcome: "confirmed" };
    }

    if (written.kind === "rejected") {
      await tx`select id from app.requests where id = ${claim.booking.request_id} for update`;
      await settleFailure(tx, claim.booking, written.failure, "awaiting_host_approval", "dispatching");
      return { bookingId, failure: written.failure, outcome: "failed" };
    }

    // Unknown: the reservation stays, and the job retries as a reconciliation.
    throw new CommandError("booking_pending");
  };
}

// The 15-minute pending notice (D2): sent once, only while the booking is still
// dispatching.
export function createBookingPendingHandler(load: () => NoticeDependencies = noticeDependenciesFromEnvironment): JobHandler {
  return async (tx: Transaction, job: ClaimedJob) => {
    const bookingId = typeof job.payload.bookingId === "string" ? job.payload.bookingId : null;
    if (!bookingId) return { sent: false };

    const [booking] = await tx<{ end_at: Date; request_id: string; start_at: Date; state: BookingState; details: LatestProposal["details"] }[]>`
      select b.request_id, b.state, b.start_at, b.end_at, p.details
      from app.bookings b join app.proposals p on p.id = b.proposal_id
      where b.id = ${bookingId}
    `;
    if (booking?.state !== "dispatching") return { sent: false };

    await enqueueHostNotice(tx, booking.request_id, { bookingId, kind: "booking_pending" });

    await enqueueStatusNotice(tx, load(), booking.request_id, {
      bookingId,
      kind: "status_pending",
      meeting: {
        end: booking.end_at.toISOString(),
        joinUrl: null,
        location: booking.details.mode === "in_person" ? booking.details.location : null,
        mode: booking.details.mode,
        start: booking.start_at.toISOString(),
      },
    });
    return { sent: true };
  };
}
