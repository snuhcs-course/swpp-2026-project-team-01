import { z } from "zod";
import type { RequesterEvaluationView } from "../contracts/feasibility";
import type {
  LinkPlan,
  RequestDetails,
  RequesterAgreement,
  RequesterCandidate,
  RequesterProposal,
  RequestState,
} from "../contracts/request";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { publishEvaluation, readEvaluation, type StoredCandidate } from "./evaluation";
import { lockOpenRequest } from "./request-guard";
import { detailsComplete } from "./request-lifecycle";

// Candidates, proposals and agreement (design decisions 8, 10, 11 and 12).
//
// - request.evaluate (**Find times**, **Find other times**) publishes the
//   evaluation job at the request's current revisions; the card fills in from
//   the record.
// - request.allow_trip (**Allow N minutes for my trip**) records the
//   requester's own allowance for one leg of one candidate and evaluates again.
// - request.choose_candidate (**Choose this time**) writes the next immutable
//   proposal version from a candidate of the current evaluation. An online
//   candidate with neither a Google Meet plan nor a requester link creates no
//   proposal and asks for a link.
// - request.agree (**Agree to this proposal**) records agreement to the exact
//   current version while its start is still in the future after the lock and
//   the request is open, and moves the request to awaiting host approval. An
//   unconfirmed contact does not block it (D3).
//
// The current evaluation is the latest one made at the request's current
// revision. Choosing a candidate does not advance the revision: the proposal
// version is what agreement names, and every change of details does advance it,
// which leaves earlier evaluations and the proposals made from them stale.

export const EVALUATE_OPERATION = "request.evaluate";
export const ALLOW_TRIP_OPERATION = "request.allow_trip";
export const CHOOSE_CANDIDATE_OPERATION = "request.choose_candidate";
export const AGREE_OPERATION = "request.agree";

function requester(context: { readonly actor: { kind: string; id: string }; readonly resourceId: string }) {
  if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
  return context.actor.id;
}

async function clock(tx: Transaction) {
  const [row] = await tx<{ now: Date }[]>`select clock_timestamp() as now`;
  return row!.now;
}

// ---------------------------------------------------------------------------
// Reading

// The latest evaluation at the request's current revision, or null.
export async function currentEvaluationId(db: Queryable, requestId: string) {
  const [row] = await db<{ id: string }[]>`
    select e.id from app.evaluations e
    join app.requests r on r.id = e.request_id and r.revision = e.request_revision
    where e.request_id = ${requestId}
    order by e.created_at desc
    limit 1
  `;
  return row?.id ?? null;
}

export async function readCurrentEvaluation(db: Queryable, requestId: string): Promise<RequesterEvaluationView | null> {
  const id = await currentEvaluationId(db, requestId);
  return id ? readEvaluation(db as Transaction, id) : null;
}

type ProposalRow = {
  agreed_at: Date | null;
  details: Omit<RequesterProposal, "version">;
  evaluation_revision: number;
  id: string;
  request_revision: number;
  start_at: Date;
  version: number;
};

async function latestProposal(db: Queryable, requestId: string) {
  const [row] = await db<ProposalRow[]>`
    select p.id, p.version, p.details, p.start_at, e.request_revision as evaluation_revision, r.revision as request_revision,
           a.agreed_at
    from app.proposals p
    join app.evaluations e on e.id = p.evaluation_id
    join app.requests r on r.id = p.request_id
    left join app.agreements a on a.proposal_id = p.id
    where p.request_id = ${requestId}
    order by p.version desc
    limit 1
  `;
  return row ?? null;
}

// The current proposal while it rests on the current details, with its
// agreement. After agreement the request revision moves on, so an agreed
// proposal stays current while the request awaits the host.
export async function readCurrentProposal(
  db: Queryable,
  requestId: string,
): Promise<{ proposal: RequesterProposal; agreement: RequesterAgreement | null } | null> {
  const row = await latestProposal(db, requestId);

  if (!row) return null;

  const agreement = row.agreed_at ? { agreedAt: row.agreed_at.toISOString(), proposalVersion: row.version } : null;
  if (!agreement && row.evaluation_revision !== row.request_revision) return null;

  return { agreement, proposal: { ...row.details, version: row.version } };
}

// ---------------------------------------------------------------------------
// request.evaluate

export type EvaluateResult = { readonly evaluationId: string };

export const evaluateCommand: CommandDefinition<Record<string, never>, EvaluateResult> = {
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  operation: EVALUATE_OPERATION,
  async run(tx, context) {
    const request = await lockOpenRequest(tx, requester(context));

    if (request.state === "awaiting_host_approval") throw new CommandError("invalid_input");

    return { evaluationId: (await publishEvaluation(tx, { audience: "requester", requestId: request.id, retryKey: context.retryKey })).evaluationId };
  },
};

// ---------------------------------------------------------------------------
// Candidates of the current evaluation

async function currentCandidate(tx: Transaction, requestId: string, evaluationId: string, candidateId: string) {
  const [evaluation] = await tx<{ current: boolean; candidates: StoredCandidate[] | null; state: string }[]>`
    select e.state, e.candidates,
           (e.request_revision = r.revision
            and e.settings_revision = (select revision from app.host_settings s where s.host_account_id = r.host_account_id)
            and e.id = (select id from app.evaluations where request_id = r.id order by created_at desc limit 1)) as current
    from app.evaluations e
    join app.requests r on r.id = e.request_id
    where e.id = ${evaluationId} and e.request_id = ${requestId}
  `;

  if (!evaluation) throw new CommandError("forbidden");
  if (evaluation.state !== "completed" || !evaluation.current) throw new CommandError("stale_revision");

  const view = await readEvaluation(tx, evaluationId);
  const shown = view?.candidates.find((candidate) => candidate.id === candidateId);
  const stored = evaluation.candidates?.find((entry) => entry.status !== "excluded" && "id" in entry && entry.id === candidateId);

  if (!view || !shown || !stored || stored.status === "excluded") throw new CommandError("invalid_input");
  return { shown, stored, view };
}

// ---------------------------------------------------------------------------
// request.allow_trip

const allowTripInput = z
  .object({
    evaluationId: z.uuid(),
    candidateId: z.string().min(1).max(64),
    minutes: z.number().int().min(5).max(240).multipleOf(5),
  })
  .strict();

// The requester's own allowance for the unresolved leg of one candidate (design
// decision 10), then a new evaluation that reads it. A leg whose endpoint is
// unknown cannot take an allowance, because an allowance names both endpoints.
export const allowTripCommand: CommandDefinition<z.infer<typeof allowTripInput>, EvaluateResult> = {
  input: allowTripInput,
  operation: ALLOW_TRIP_OPERATION,
  async run(tx, context) {
    const request = await lockOpenRequest(tx, requester(context));
    const { shown, stored } = await currentCandidate(tx, request.id, context.input.evaluationId, context.input.candidateId);
    const leg =
      "legs" in stored
        ? stored.legs.find((entry) => entry.party === "requester" && entry.status === "unresolved" && entry.direction === shown.unresolvedRequesterLeg)
        : undefined;

    if (!shown.unresolvedRequesterLeg || !leg?.originKey || !leg.destinationKey || !leg.mode) throw new CommandError("invalid_input");

    await tx`
      insert into app.travel_allowances
        (request_id, party, candidate_start, candidate_end, direction, origin_hash, destination_hash, mode, minutes, confirmed_by)
      values (${request.id}, 'requester', ${shown.start}, ${shown.end}, ${leg.direction}, ${leg.originKey}, ${leg.destinationKey},
              ${leg.mode}, ${context.input.minutes}, 'requester')
      on conflict (request_id, party, candidate_start, candidate_end, direction, origin_hash, destination_hash, mode)
        where invalidated_at is null
      do update set minutes = excluded.minutes, confirmed_at = now()
    `;

    // A pending evaluation may already have read the allowances: this one reads the new one.
    const published = await publishEvaluation(tx, {
      audience: "requester",
      requestId: request.id,
      retryKey: `allow:${context.retryKey}`,
      reusePending: false,
    });
    return { evaluationId: published.evaluationId };
  },
};

// ---------------------------------------------------------------------------
// request.choose_candidate

const chooseInput = z.object({ evaluationId: z.uuid(), candidateId: z.string().min(1).max(64) }).strict();

export type ChooseResult =
  | { readonly outcome: "proposed"; readonly version: number }
  | { readonly outcome: "needs_meeting_link" };

function linkPlanOf(candidate: RequesterCandidate, details: Partial<RequestDetails>): LinkPlan | null {
  if (candidate.mode !== "online") return null;
  return candidate.linkPlan ?? details.linkPlan ?? null;
}

export const chooseCandidateCommand: CommandDefinition<z.infer<typeof chooseInput>, ChooseResult> = {
  input: chooseInput,
  operation: CHOOSE_CANDIDATE_OPERATION,
  async run(tx, context) {
    const request = await lockOpenRequest(tx, requester(context));
    assertRevision(request.revision, context.expectedRevision);

    // Incomplete details (no duration, mode or window) cannot authorize selection.
    if (!detailsComplete(request.details) || (request.state !== "negotiating" && request.state !== "gathering")) {
      throw new CommandError("invalid_input");
    }

    const { shown } = await currentCandidate(tx, request.id, context.input.evaluationId, context.input.candidateId);

    if (shown.unresolvedRequesterLeg) throw new CommandError("invalid_input");
    if (Date.parse(shown.start) <= (await clock(tx)).getTime()) throw new CommandError("invalid_input", { reason: "start_passed" });

    const linkPlan = linkPlanOf(shown, request.details);
    if (shown.mode === "online" && !linkPlan) return { outcome: "needs_meeting_link" };

    const [names] = await tx<{ host_name: string | null; host_timezone: string | null; requester_name: string }[]>`
      select r.requester_name, s.settings ->> 'displayName' as host_name, s.settings ->> 'timezone' as host_timezone
      from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
      where r.id = ${request.id}
    `;
    const [next] = await tx<{ version: number }[]>`
      select coalesce(max(version), 0) + 1 as version from app.proposals where request_id = ${request.id}
    `;
    const displayTimezones = [...new Set([shown.displayTimezone, ...(names?.host_timezone ? [names.host_timezone] : [])])];
    const details: Omit<RequesterProposal, "version"> = {
      displayTimezones,
      durationMinutes: shown.durationMinutes,
      end: shown.end,
      linkPlan,
      location: shown.mode === "in_person" ? shown.location : null,
      mode: shown.mode,
      participants: [
        { name: names?.host_name ?? "Host", role: "host" },
        { name: names!.requester_name, role: "requester" },
      ],
      start: shown.start,
    };

    await tx`
      insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
      values (${request.id}, ${next!.version}, ${context.input.evaluationId}, ${shown.id}, ${shown.start}, ${shown.end},
              ${tx.json(details as unknown as Parameters<typeof tx.json>[0])})
    `;

    if (request.state === "gathering") {
      await tx`update app.requests set state = 'negotiating', updated_at = now() where id = ${request.id}`;
    }

    return { outcome: "proposed", version: next!.version };
  },
};

// ---------------------------------------------------------------------------
// request.agree

const agreeInput = z.object({ version: z.number().int().min(1) }).strict();

export type AgreeResult = { readonly version: number; readonly revision: number; readonly state: RequestState };

export const agreeCommand: CommandDefinition<z.infer<typeof agreeInput>, AgreeResult> = {
  input: agreeInput,
  operation: AGREE_OPERATION,
  async run(tx, context) {
    const request = await lockOpenRequest(tx, requester(context));
    assertRevision(request.revision, context.expectedRevision);

    const latest = await latestProposal(tx, request.id);

    // Only the current version, made from an evaluation at the current details.
    if (!latest || latest.version !== context.input.version || latest.evaluation_revision !== request.revision) {
      throw new CommandError("stale_revision", { reason: "proposal_superseded" });
    }
    if (request.state !== "negotiating" || latest.agreed_at) throw new CommandError("stale_revision");
    if (latest.start_at.getTime() <= (await clock(tx)).getTime()) throw new CommandError("invalid_input", { reason: "start_passed" });

    await tx`
      insert into app.agreements (proposal_id, request_revision, retry_key)
      values (${latest.id}, ${request.revision}, ${context.retryKey})
    `;
    await tx`
      update app.requests set state = 'awaiting_host_approval', revision = revision + 1, updated_at = now()
      where id = ${request.id}
    `;

    return { revision: request.revision + 1, state: "awaiting_host_approval", version: latest.version };
  },
};
