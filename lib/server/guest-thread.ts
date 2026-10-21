import type { RequestState } from "../contracts/request";
import { THREAD_CARD_KINDS, type ThreadCard, type ThreadCardKind } from "../contracts/requester-view";
import type { Queryable } from "./database";

// The guest thread's cards (design decision 12, D13; DESIGN.md: one thing to
// think about at once), from the domain records. Each card is anchored at the
// moment the conversation called for it, so the page places it after the
// assistant message or tool result that raised it, and keeps it in the history.
// At most one card is open: the one for the current next step, in this order:
// identity, review, Calendar, candidate times, proposal; awaiting the host's
// approval nothing is open. Every other card is a one-line receipt: answered
// (what was chosen), waiting (called for, not yet the current step) or
// superseded (out of date).
//
//   identity   when the assistant called ask_for_identity, the details first
//              held a purpose, a gated operation answered identity_required or
//              the draft reached its message cap; answered once identified
//   review     each drafted review, when draft_request_review made it
//   status     a line, not a card: the booking link sent, from identification,
//              and the wait for the host, from agreement
//   calendar   the Calendar step, from identification; settled by Skip for now
//              or saved calendars (calendar_settled_at)
//   times      each evaluation, when it was requested; and Find times while
//              there is no current one and finding times is the next step
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
  calendar_grant: boolean;
  calendar_settled_at: Date | null;
  contact_email: string | null;
  created_at: Date;
  identified_at: Date | null;
  identity_requested_at: Date | null;
  latest_applied: Date | null;
  latest_evaluation: Date | null;
  requester_name: string | null;
  state: RequestState;
};

export type ThreadCurrent = {
  readonly evaluationId: string | null;
  readonly proposalVersion: number | null;
  readonly agreedVersion: number | null;
  readonly pendingReviewId: string | null;
};

// The current next step, whose card is the only open one.
export function currentStep(
  request: Pick<RequestRow, "state" | "identity_requested_at" | "calendar_settled_at">,
  current: ThreadCurrent,
): ThreadCardKind | null {
  if (request.state === "draft") {
    if (request.identity_requested_at) return "identity";
    return current.pendingReviewId ? "review" : null;
  }

  if (request.state !== "gathering" && request.state !== "negotiating") return null;
  if (current.pendingReviewId) return "review";
  if (!request.calendar_settled_at) return "calendar";
  if (current.proposalVersion !== null && current.agreedVersion !== current.proposalVersion) return "proposal";
  return "times";
}

export async function readGuestThread(db: Queryable, requestId: string, current: ThreadCurrent): Promise<ThreadCard[]> {
  const [request] = await db<RequestRow[]>`
    select r.state, r.created_at, r.identity_requested_at, r.identified_at, r.calendar_settled_at,
           r.requester_name, r.contact_email,
           (select max(resolved_at) from app.request_reviews where request_id = r.id and state = 'applied') as latest_applied,
           (select max(created_at) from app.evaluations where request_id = r.id) as latest_evaluation,
           (select max(a.agreed_at) from app.agreements a join app.proposals p on p.id = a.proposal_id
             where p.request_id = r.id) as agreed_at,
           exists (select 1 from app.requester_grants g
                   where g.request_id = r.id and g.kind = 'calendar' and g.revoked_at is null) as calendar_grant
    from app.requests r where r.id = ${requestId}
  `;

  if (!request) return [];

  const step = currentStep(request, current);
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
      ...(draft
        ? { status: step === "identity" ? "open" : "waiting" }
        : { receipt: { text: [request.requester_name, request.contact_email].filter(Boolean).join(" · ") }, status: "answered" }),
    });
  }

  const reviews = await db<{ created_at: Date; fields: string[] | null; id: string; state: string }[]>`
    select id, state, created_at, (select array_agg(key) from jsonb_object_keys(patch) as key) as fields
    from app.request_reviews where request_id = ${requestId} order by created_at
  `;
  const fieldText = (fields: string[] | null) => (fields ?? []).map((field) => FIELD_LABELS[field] ?? field).join(", ");

  for (const review of reviews) {
    const base = { at: iso(review.created_at), id: `review:${review.id}`, kind: "review" as const };
    if (review.state === "pending") {
      cards.push({ ...base, receipt: { text: fieldText(review.fields) }, status: step === "review" ? "open" : "waiting" });
    } else if (review.state === "superseded") {
      cards.push({ ...base, status: "superseded" });
    } else {
      cards.push({
        ...base,
        receipt: { text: review.state === "applied" ? `Applied: ${fieldText(review.fields)}` : "Dismissed" },
        status: "answered",
      });
    }
  }

  if (!draft) {
    cards.push({ at: iso(identifiedAt), id: "status:sent", kind: "status", status: "answered" });
    if (request.agreed_at) cards.push({ at: iso(request.agreed_at), id: "status:awaiting", kind: "status", status: "answered" });

    const settled = request.calendar_settled_at !== null;
    cards.push({
      at: iso(identifiedAt),
      id: "calendar",
      kind: "calendar",
      ...(step === "calendar"
        ? { status: "open" }
        : settled
          ? { receipt: { text: request.calendar_grant ? "Connected" : "Skipped" }, status: "answered" }
          : { status: "waiting" }),
    });
  }

  const evaluations = await db<{ created_at: Date; id: string }[]>`
    select id, created_at from app.evaluations where request_id = ${requestId} order by created_at
  `;
  const proposals = await db<{ created_at: Date; end_at: Date; evaluation_id: string; start_at: Date; version: number }[]>`
    select version, evaluation_id, start_at, end_at, created_at from app.proposals where request_id = ${requestId} order by version
  `;

  for (const evaluation of evaluations) {
    const chosen = proposals.filter((proposal) => proposal.evaluation_id === evaluation.id).at(-1);
    const isCurrent = evaluation.id === current.evaluationId;
    const base = { at: iso(evaluation.created_at), id: `times:${evaluation.id}`, kind: "times" as const };

    if (isCurrent && step === "times") cards.push({ ...base, status: "open" });
    else if (chosen) {
      cards.push({ ...base, receipt: { end: iso(chosen.end_at), start: iso(chosen.start_at), text: "You chose" }, status: "answered" });
    } else if (isCurrent) cards.push({ ...base, status: "waiting" });
    else cards.push({ ...base, status: "superseded" });
  }

  if (step === "times" && !current.evaluationId) {
    const after = [identifiedAt, request.latest_applied, request.latest_evaluation, request.calendar_settled_at].filter(
      (date): date is Date => date !== null,
    );
    cards.push({
      at: iso(new Date(Math.max(...after.map((date) => date.getTime())) + 1)),
      id: "times:find",
      kind: "times",
      status: "open",
    });
  }

  for (const proposal of proposals) {
    const base = { at: iso(proposal.created_at), id: `proposal:${proposal.version}`, kind: "proposal" as const };
    const window = { end: iso(proposal.end_at), start: iso(proposal.start_at) };

    if (proposal.version === current.agreedVersion) cards.push({ ...base, receipt: { ...window, text: "You agreed" }, status: "answered" });
    else if (proposal.version === current.proposalVersion) {
      cards.push({ ...base, receipt: { ...window, text: "Proposed" }, status: step === "proposal" ? "open" : "waiting" });
    } else cards.push({ ...base, status: "superseded" });
  }

  return cards.sort((a, b) => a.at.localeCompare(b.at) || ORDER.get(a.kind)! - ORDER.get(b.kind)!);
}
