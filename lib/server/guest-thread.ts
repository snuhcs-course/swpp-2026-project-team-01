import type { RequestState } from "../contracts/request";
import { THREAD_CARD_KINDS, type ThreadCard } from "../contracts/requester-view";
import type { Queryable } from "./database";

// The guest thread's cards (design decision 12, D13), from the domain records:
// each card is anchored at the moment the conversation called for it, so the
// page places it after the assistant message or tool result that raised it,
// and keeps it in the history once answered or superseded.
//
//   identity   when the details first held a purpose, a gated operation
//              answered identity_required or the draft reached its message
//              cap; answered once the guest is identified
//   review     each drafted review, when draft_request_review made it
//   status     the open request (the creation email, Withdraw request), from
//              identification; moved to the agreement once agreed
//   calendar   the Calendar connection, from identification
//   times      each evaluation, when it was requested; and Find times while
//              there is no current one, after the latest change of details
//   proposal   each proposal version, when Choose this time made it

const ORDER = new Map(THREAD_CARD_KINDS.map((kind, index) => [kind, index]));

// The review receipt names the applied fields as the cards do.
const FIELD_LABELS: Readonly<Record<string, string>> = {
  contactEmail: "email",
  contactName: "name",
  durationMinutes: "length",
  linkPlan: "meeting link",
  location: "place",
  mode: "mode",
  purpose: "purpose",
  travelMode: "travel",
  windows: "free times",
};

type RequestRow = {
  agreed_at: Date | null;
  contact_email: string | null;
  created_at: Date;
  identified_at: Date | null;
  identity_requested_at: Date | null;
  latest_applied: Date | null;
  latest_evaluation: Date | null;
  requester_name: string | null;
  state: RequestState;
};

export async function readGuestThread(
  db: Queryable,
  requestId: string,
  current: { readonly evaluationId: string | null; readonly proposalVersion: number | null; readonly agreedVersion: number | null },
): Promise<ThreadCard[]> {
  const [request] = await db<RequestRow[]>`
    select r.state, r.created_at, r.identity_requested_at, r.identified_at, r.requester_name, r.contact_email,
           (select max(resolved_at) from app.request_reviews where request_id = r.id and state = 'applied') as latest_applied,
           (select max(created_at) from app.evaluations where request_id = r.id) as latest_evaluation,
           (select max(a.agreed_at) from app.agreements a join app.proposals p on p.id = a.proposal_id
             where p.request_id = r.id) as agreed_at
    from app.requests r where r.id = ${requestId}
  `;

  if (!request) return [];

  const cards: ThreadCard[] = [];
  const iso = (date: Date) => date.toISOString();
  const draft = request.state === "draft";
  const identifiedAt = request.identified_at ?? request.created_at;

  const raised = request.identity_requested_at ?? request.identified_at;
  if (raised) {
    cards.push({
      at: iso(raised),
      id: "identity",
      kind: "identity",
      status: draft ? "open" : "answered",
      ...(draft ? {} : { receipt: { text: [request.requester_name, request.contact_email].filter(Boolean).join(" · ") } }),
    });
  }

  const reviews = await db<{ created_at: Date; fields: string[] | null; id: string; intent: string; state: string }[]>`
    select id, intent, state, created_at, (select array_agg(key) from jsonb_object_keys(patch) as key) as fields
    from app.request_reviews where request_id = ${requestId} order by created_at
  `;

  for (const review of reviews) {
    const status = review.state === "pending" ? "open" : review.state === "superseded" ? "superseded" : "answered";
    cards.push({
      at: iso(review.created_at),
      id: `review:${review.id}`,
      kind: "review",
      status,
      ...(status === "answered"
        ? {
            receipt: {
              text:
                review.state === "applied"
                  ? `Applied: ${(review.fields ?? []).map((field) => FIELD_LABELS[field] ?? field).join(", ")}`
                  : "Dismissed",
            },
          }
        : {}),
    });
  }

  if (!draft) {
    cards.push({
      at: iso(request.agreed_at ?? identifiedAt),
      id: "status",
      kind: "status",
      status: "open",
    });
    cards.push({ at: iso(identifiedAt), id: "calendar", kind: "calendar", status: "open" });
  }

  const evaluations = await db<{ created_at: Date; id: string }[]>`
    select id, created_at from app.evaluations where request_id = ${requestId} order by created_at
  `;
  const proposals = await db<{ created_at: Date; end_at: Date; evaluation_id: string; start_at: Date; version: number }[]>`
    select version, evaluation_id, start_at, end_at, created_at from app.proposals where request_id = ${requestId} order by version
  `;

  // The current evaluation's times stay open while a time can still be chosen
  // (Choose another time on the proposal goes back to them).
  const choosing = request.state === "gathering" || request.state === "negotiating";

  for (const evaluation of evaluations) {
    const chosen = proposals.filter((proposal) => proposal.evaluation_id === evaluation.id).at(-1);
    const isCurrent = evaluation.id === current.evaluationId;
    cards.push({
      at: iso(evaluation.created_at),
      id: `times:${evaluation.id}`,
      kind: "times",
      status: isCurrent && choosing ? "open" : chosen ? "answered" : "superseded",
      ...(chosen ? { receipt: { end: iso(chosen.end_at), start: iso(chosen.start_at), text: "You chose" } } : {}),
    });
  }

  if (!draft && !current.evaluationId && choosing) {
    const after = [identifiedAt, request.latest_applied, request.latest_evaluation].filter((date): date is Date => date !== null);
    cards.push({
      at: iso(new Date(Math.max(...after.map((date) => date.getTime())) + 1)),
      id: "times:find",
      kind: "times",
      status: "open",
    });
  }

  for (const proposal of proposals) {
    const agreed = proposal.version === current.agreedVersion;
    const isCurrent = proposal.version === current.proposalVersion;
    cards.push({
      at: iso(proposal.created_at),
      id: `proposal:${proposal.version}`,
      kind: "proposal",
      status: agreed ? "answered" : isCurrent ? "open" : "superseded",
      ...(agreed ? { receipt: { end: iso(proposal.end_at), start: iso(proposal.start_at), text: "You agreed" } } : {}),
    });
  }

  return cards.sort((a, b) => a.at.localeCompare(b.at) || ORDER.get(a.kind)! - ORDER.get(b.kind)!);
}
