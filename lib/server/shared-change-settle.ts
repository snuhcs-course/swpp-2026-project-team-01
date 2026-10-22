import type { RequesterProposal } from "../contracts/request";
import { enqueueStatusNotice, type NoticeDependencies, noticeDependenciesFromEnvironment } from "./booking-notices";
import type { Transaction } from "./database";
import type { IntervalCheck } from "./evaluation";

// The end of a shared change (host-review-and-booking design 4, D7), run by the
// checking evaluation's job in its publishing transaction, under the request
// lock it holds and after its revision check: a suggested time that passed
// becomes the next proposal version, made from that evaluation's one candidate,
// and the requester is emailed that a new version awaits their agreement; one
// that failed is rejected with a host-private reason and no version.

const REJECTION_TEXT: Readonly<Record<Exclude<IntervalCheck, { ok: true }>["problem"], string>> = {
  busy: "That time overlaps something on your calendar.",
  needs_details: "The request is missing details needed to check that time.",
  outside_hours: "That time is outside your meeting hours.",
  requester_unavailable: "The requester is not available then.",
  travel: "The trip before or after that time does not fit.",
  travel_unresolved: "A trip before or after that time could not be estimated.",
  unavailable: "The time could not be checked right now. Try sharing again.",
};

export async function settleSharedChange(
  tx: Transaction,
  sharedChangeId: string,
  evaluationId: string,
  verdict: IntervalCheck,
  notices?: NoticeDependencies,
) {
  const [draft] = await tx<{ id: string; request_id: string }[]>`
    select id, request_id from app.shared_change_drafts where id = ${sharedChangeId} and state = 'checking'
    for update
  `;
  if (!draft) return;

  if (!verdict.ok) {
    const reason = verdict.problem !== "unavailable" && verdict.explanation ? verdict.explanation : REJECTION_TEXT[verdict.problem];
    await tx`
      update app.shared_change_drafts
      set state = 'rejected', rejection_reason = ${reason}, evaluation_id = ${evaluationId}, resolved_at = now()
      where id = ${draft.id}
    `;
    return;
  }

  const { candidate } = verdict;
  const [names] = await tx<{ host_name: string | null; host_timezone: string | null; requester_name: string | null; timezone: string | null }[]>`
    select r.requester_name, r.details ->> 'timezone' as timezone,
           s.settings ->> 'displayName' as host_name, s.settings ->> 'timezone' as host_timezone
    from app.requests r left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${draft.request_id}
  `;
  const [next] = await tx<{ version: number }[]>`
    select coalesce(max(version), 0) + 1 as version from app.proposals where request_id = ${draft.request_id}
  `;
  const displayTimezones = [...new Set([names?.timezone, names?.host_timezone].filter((zone): zone is string => Boolean(zone)))];
  const details: Omit<RequesterProposal, "version"> = {
    displayTimezones,
    durationMinutes: candidate.durationMinutes,
    end: candidate.end,
    linkPlan: candidate.mode === "online" ? candidate.linkPlan : null,
    location: candidate.mode === "in_person" ? candidate.location : null,
    mode: candidate.mode,
    participants: [
      { name: names?.host_name ?? "Host", role: "host" },
      { name: names?.requester_name ?? "Requester", role: "requester" },
    ],
    start: candidate.start,
  };

  await tx`
    insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
    values (${draft.request_id}, ${next!.version}, ${evaluationId}, ${candidate.id}, ${candidate.start}, ${candidate.end},
            ${tx.json(details as unknown as Parameters<typeof tx.json>[0])})
  `;
  await tx`
    update app.shared_change_drafts
    set state = 'shared', proposal_version = ${next!.version}, evaluation_id = ${evaluationId}, resolved_at = now()
    where id = ${draft.id}
  `;
  await enqueueStatusNotice(tx, notices ?? noticeDependenciesFromEnvironment(), draft.request_id, {
    kind: "status_new_version",
    meeting: { end: candidate.end, joinUrl: null, location: details.location, mode: candidate.mode, start: candidate.start },
    version: next!.version,
  });
}
