import { cancelBookingCommand, changeBookingCommand } from "./booking-cancellation";
import { type HostCandidate, type HostEvaluationSummary, type HostRequestItem, type HostRequestOperation, type HostRequestView, type HostSuggestion, revisedFromOutcome } from "../contracts/host-request";
import type { LinkPlan, ProposalTime, RequestDetails, RequestState } from "../contracts/request";
import { isValidTimeZone } from "../contracts/setup";
import { approveCommand, checkBookingCommand, declineCommand, readBookingStatus } from "./bookings";
import type { CommandDefinition } from "./commands";
import type { Database, Queryable, Transaction } from "./database";
import { readHostEvaluation, weeklyLimitHold } from "./evaluation";
import { allowHostTripCommand, hostEvaluateCommand, waiveWeeklyLimitCommand } from "./request-exceptions";
import { finishSampleCommand } from "./host-tutorial";
import { requestRef } from "./request-ref";
import { dismissChangesCommand, shareChangesCommand, suggestChangesCommand } from "./shared-changes";

// The host's projection of its requests (host-review-and-booking design 3): the
// inbox list and one request's view, both limited to the host's own requests
// and never a draft. The booking link never appears. Read by the /app routes and
// by the host-review tools, which minimize contact fields further.

type ListRow = {
  booked_start: Date | null;
  details: Partial<RequestDetails>;
  id: string;
  needs: boolean;
  is_sample: boolean;
  proposal_start: Date | null;
  requester_name: string | null;
  state: RequestState;
  updated_at: Date;
};

// Whether the host has something to decide on the request: approval, a pending
// suggestion, a held week, an unresolved host trip blocking every candidate, or
// a booking that failed and awaits a retry.
const NEEDS_DECISION = `
  r.state = 'awaiting_host_approval'
  or exists (select 1 from app.shared_change_drafts d where d.request_id = r.id and d.state = 'pending')
`;

export async function listHostRequests(db: Queryable, hostAccountId: string): Promise<HostRequestItem[]> {
  const rows = await db<ListRow[]>`
    select r.id, r.state, r.details, r.requester_name, r.updated_at, r.is_sample,
           (select p.start_at from app.proposals p where p.request_id = r.id order by p.version desc limit 1) as proposal_start,
           (select b.start_at from app.bookings b where b.request_id = r.id and b.state = 'confirmed' order by b.start_at desc limit 1) as booked_start,
           (not r.is_sample and (${db.unsafe(NEEDS_DECISION)})) as needs
    from app.requests r
    where r.host_account_id = ${hostAccountId} and r.state <> 'draft'
      and (not r.is_sample or (r.closed_at is null and r.expires_at > now()))
    order by r.updated_at desc
    limit 100
  `;

  return rows.map((row) => ({
    bookedStart: row.booked_start?.toISOString() ?? null,
    needsDecision: row.needs,
    proposalStart: row.proposal_start?.toISOString() ?? null,
    purpose: row.details.purpose ?? null,
    requestId: row.id,
    sample: row.is_sample,
    requesterName: row.requester_name ?? "Guest",
    state: row.state,
    updatedAt: row.updated_at.toISOString(),
  }));
}

type RequestRow = {
  contact_confirmed_email: string | null;
  contact_email: string | null;
  details: Partial<RequestDetails>;
  expires_at: Date;
  id: string;
  is_sample: boolean;
  requester_name: string;
  revised_from_request_id: string | null;
  revised_from_state: RequestState | null;
  revision: number;
  settings: { timezone?: string; weeklyLimit?: number | null } | null;
  settings_revision: number | null;
  state: RequestState;
};

async function hostSuggestion(db: Queryable, requestId: string): Promise<HostSuggestion | null> {
  // The open suggestion, or else the latest settled one, so the host sees why a
  // shared time was rejected.
  const [row] = await db<
    { base_proposal_version: number | null; changes: HostSuggestion["changes"]; id: string; proposal_version: number | null; rejection_reason: string | null; source: HostSuggestion["source"]; state: HostSuggestion["state"] }[]
  >`
    select id, source, state, changes, rejection_reason, base_proposal_version, proposal_version from app.shared_change_drafts
    where request_id = ${requestId} and state in ('pending', 'checking', 'shared', 'rejected')
    order by (state in ('pending', 'checking')) desc, created_at desc
    limit 1
  `;

  return row
    ? {
        baseProposalVersion: row.base_proposal_version,
        changes: row.changes,
        id: row.id,
        proposalVersion: row.proposal_version,
        rejectionReason: row.rejection_reason,
        source: row.source,
        state: row.state,
      }
    : null;
}

async function evaluationSummary(db: Queryable, request: RequestRow, waived: boolean): Promise<HostEvaluationSummary | null> {
  const [latest] = await db<{ id: string }[]>`
    select id from app.evaluations where request_id = ${request.id} and request_revision = ${request.revision}
    order by created_at desc limit 1
  `;
  const view = latest ? await readHostEvaluation(db as Transaction, latest.id) : null;
  if (!view) return null;

  const candidates: HostCandidate[] = view.candidates.slice(0, 20).map((candidate) => ({
    basis: candidate.basis,
    belowWeeklyLimit: candidate.belowWeeklyLimit,
    end: candidate.end,
    hostLegs: candidate.legs
      .filter((leg) => leg.party === "host")
      .map((leg) => ({
        canAllow: leg.status === "unresolved" && Boolean(leg.originKey && leg.destinationKey && leg.mode),
        direction: leg.direction,
        status: leg.status,
        travelMinutes: leg.travelMinutes,
      })),
    id: candidate.id,
    start: candidate.start,
    status: candidate.status,
  }));

  return {
    candidates,
    exclusions: view.exclusions.slice(0, 20).map((entry) => ({ end: entry.end, explanation: entry.explanation, start: entry.start })),
    failureCategory: view.failureCategory,
    id: view.id,
    state: view.state,
    weeklyLimitHold: !waived && weeklyLimitHold(view.candidates, request.settings?.weeklyLimit ?? null),
  };
}

// The host's timezone from their settings, or UTC, as each request view uses.
export async function readHostTimezone(q: Queryable, hostAccountId: string) {
  const [row] = await q<{ timezone: string | null }[]>`
    select settings->>'timezone' as timezone from app.host_settings where host_account_id = ${hostAccountId}
  `;
  return row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : "UTC";
}

// One request as its host sees it, or null for another host's request, a draft
// or an unknown one.
export async function readHostRequest(db: Database | Transaction, hostAccountId: string, requestId: string): Promise<HostRequestView | null> {
  const [request] = await db<RequestRow[]>`
    select r.id, case when r.is_sample and r.closed_at is null and r.expires_at <= now() then 'expired' else r.state end as state, r.revision, r.details, r.requester_name, r.contact_email, r.contact_confirmed_email,
           r.expires_at, r.is_sample, s.settings, s.revision as settings_revision, r.revised_from_request_id,
           p.state as revised_from_state
    from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
    left join app.requests p on p.id = r.revised_from_request_id
    where r.id = ${requestId} and r.host_account_id = ${hostAccountId} and r.state <> 'draft'
  `;
  if (!request) return null;

  const [proposal] = await db<
    { agreed_at: Date | null; details: { durationMinutes: number; linkPlan: LinkPlan | null; location: string | null; mode: "online" | "in_person"; times?: readonly ProposalTime[]; pickedFrom?: { version: number; option: number } }; end_at: Date; start_at: Date; version: number }[]
  >`
    select p.version, p.start_at, p.end_at, p.details, a.agreed_at
    from app.proposals p left join app.agreements a on a.proposal_id = p.id
    where p.request_id = ${request.id}
    order by p.version desc limit 1
  `;
  const [waiver] = await db<{ found: boolean }[]>`
    select true as found from app.request_exceptions
    where request_id = ${request.id} and kind = 'weekly_limit' and invalidated_at is null
      and settings_revision = ${request.settings_revision ?? -1}
  `;
  const waived = Boolean(waiver);
  const hostTimezone = request.settings?.timezone && isValidTimeZone(request.settings.timezone) ? request.settings.timezone : "UTC";
  const suggestion = await hostSuggestion(db, request.id);
  const evaluation = request.is_sample ? null : await evaluationSummary(db, request, waived);
  const booking = await readBookingStatus(db, request.id, "host");
  const details = request.details;

  return {
    booking,
    details: {
      durationMinutes: details.durationMinutes ?? null,
      linkPlan: details.linkPlan ?? null,
      location: details.location ?? null,
      mode: details.mode ?? null,
      purpose: details.purpose ?? null,
      windows: details.windows ?? [],
    },
    evaluation,
    expiresAt: request.expires_at.toISOString(),
    revisedFrom: revisedFromView(request.revised_from_request_id, request.revised_from_state),
    hostTimezone,
    needsDecision:
      request.state === "awaiting_host_approval" ||
      suggestion?.state === "pending" ||
      Boolean(evaluation?.weeklyLimitHold) ||
      Boolean(evaluation?.candidates.length && evaluation.candidates.every((candidate) => candidate.status === "host_unresolved")),
    proposal: proposal
      ? {
          agreedAt: proposal.agreed_at?.toISOString() ?? null,
          durationMinutes: proposal.details.durationMinutes,
          end: proposal.end_at.toISOString(),
          linkPlan: proposal.details.linkPlan ?? null,
          location: proposal.details.location ?? null,
          mode: proposal.details.mode,
          start: proposal.start_at.toISOString(),
          ...(proposal.details.pickedFrom ? { pickedFrom: proposal.details.pickedFrom } : {}),
          ...(proposal.details.times && proposal.details.times.length > 1
            ? {
                times: proposal.details.times.map((time) => ({
                  end: time.end,
                  linkPlan: time.linkPlan ?? null,
                  location: time.location ?? null,
                  mode: time.mode,
                  start: time.start,
                })),
              }
            : {}),
          version: proposal.version,
        }
      : null,
    requestId: request.id,
    sample: request.is_sample,
    requester: {
      email: request.contact_email,
      emailConfirmed: request.contact_confirmed_email !== null,
      language: details.language === "ko" ? "ko" : "en",
      name: request.requester_name,
      timezone: details.timezone && isValidTimeZone(details.timezone) ? details.timezone : hostTimezone,
    },
    revision: request.revision,
    state: request.state,
    suggestion,
    weeklyLimit: request.is_sample ? null : request.settings?.weeklyLimit ?? null,
    weeklyLimitWaived: waived,
  };
}

// The earlier request a revised request follows, when it closed as declined,
// expired or withdrawn (guest-flow-completion design 5, #59).
function revisedFromView(requestId: string | null, state: RequestState | null): HostRequestView["revisedFrom"] {
  const outcome = revisedFromOutcome(state);
  return requestId && outcome ? { outcome, ref: requestRef(requestId) } : null;
}

// The host request view's card commands, by operation.
export function hostRequestCommands(): Readonly<Record<HostRequestOperation, CommandDefinition<unknown, unknown>>> {
  return {
    "tutorial.finish": finishSampleCommand,
    "booking.cancel": cancelBookingCommand(),
    "booking.change": changeBookingCommand,
    "booking.check": checkBookingCommand,
    "request.allow_host_trip": allowHostTripCommand(),
    "request.approve": approveCommand,
    "request.decline": declineCommand(),
    "request.dismiss_changes": dismissChangesCommand,
    "request.host_evaluate": hostEvaluateCommand(),
    "request.share_changes": shareChangesCommand,
    "request.suggest_changes": suggestChangesCommand("host"),
    "request.waive_weekly_limit": waiveWeeklyLimitCommand(),
  } as unknown as Readonly<Record<HostRequestOperation, CommandDefinition<unknown, unknown>>>;
}
