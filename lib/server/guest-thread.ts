import type { RequestState, ReviewPatch } from "../contracts/request";
import { THREAD_CARD_KINDS, type ThreadCard, type ThreadCardKind } from "../contracts/requester-view";
import type { Queryable } from "./database";

// The guest thread's cards (design decision 12, D13; DESIGN.md: one thing to
// think about at once), from the domain records. Each card is anchored at the
// moment it was raised, and an answered review, times or proposal card at the
// moment it was answered, since the page shows it as the guest's reply: a
// decision made in words then follows the message that made it. At most
// one card is open: the one for the current next step (currentStep): a pending
// review, then the Calendar step, the meeting question, the proposal to agree
// to, and candidate times; awaiting the host's approval nothing is open. Every
// other card is answered (what was chosen), waiting (raised, not yet the
// current step) or superseded; the booking page shows an answered card as the
// guest's own reply and leaves waiting and superseded ones out
// (guest-flow-completion U12).
//
//   identity   when a gated operation on a draft answered identity_required,
//              or at identification; answered once identified, which on the
//              web happens on the web start before the booking page opens
//              (guest-flow-completion U8)
//   review     each drafted review, when draft_request_review made it
//   host_profile  Use your host settings for this request, from the Google
//              return that matched the guest to another host (design 6);
//              answered once decided, with what is in use
//   status     a line, not a card: the booking link sent, from identification,
//              and the wait for the host, from agreement
//   calendar   the Calendar step, from identification; settled by the web
//              start's identity step, Skip for now or saved calendars
//              (calendar_settled_at)
//   meeting    the meeting step, from identification (guest-flow-completion
//              U13): the page's question about the purpose, answered in
//              conversation and recorded through a review; answered once the
//              request has a purpose
//   times      each evaluation, when it was requested; and Find times while
//              there is no current one and finding times is the next step
//   proposal   each proposal version, when Choose this time made it

const ORDER = new Map(THREAD_CARD_KINDS.map((kind, index) => [kind, index]));

// The host-profile receipt names the items in use.
const PROFILE_LABELS: Readonly<Record<string, string>> = {
  calendars: "your calendars",
  details: "your basic details",
};

// The review receipt names the applied fields as the cards do.
const FIELD_LABELS: Readonly<Record<string, string>> = {
  contactEmail: "email",
  contactName: "name",
  durationMinutes: "length",
  preferredWindows: "preferred times",
  lessPreferredWindows: "less preferred times",
  preferredWeeklyWindows: "weekly preferences",
  linkPlan: "meeting link",
  location: "place",
  mode: "mode",
  purpose: "purpose",
  timezone: "timezone",
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
  identity_google: boolean;
  latest_applied: Date | null;
  latest_evaluation: Date | null;
  profile_at: Date | null;
  profile_decided_at: Date | null;
  profile_items: string[] | null;
  purpose: string | null;
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
  request: Pick<RequestRow, "state" | "identity_requested_at" | "calendar_settled_at" | "purpose" | "profile_at" | "profile_decided_at">,
  current: ThreadCurrent,
): ThreadCardKind | null {
  if (request.state === "draft") {
    if (request.identity_requested_at) return "identity";
    return current.pendingReviewId ? "review" : null;
  }

  if (request.state !== "gathering" && request.state !== "negotiating") return null;
  if (current.pendingReviewId) return "review";
  if (request.profile_at && !request.profile_decided_at) return "host_profile";
  if (!request.calendar_settled_at) return "calendar";
  if (!request.purpose) return "meeting";
  if (current.proposalVersion !== null && current.agreedVersion !== current.proposalVersion) return "proposal";
  return "times";
}

export async function readGuestThread(db: Queryable, requestId: string, current: ThreadCurrent): Promise<ThreadCard[]> {
  const [request] = await db<RequestRow[]>`
    select r.state, r.created_at, r.identity_requested_at, r.identified_at, r.calendar_settled_at,
           r.requester_name, r.contact_email, r.details ->> 'purpose' as purpose,
           (select max(resolved_at) from app.request_reviews where request_id = r.id and state = 'applied') as latest_applied,
           (select max(created_at) from app.evaluations where request_id = r.id) as latest_evaluation,
           (select max(a.agreed_at) from app.agreements a join app.proposals p on p.id = a.proposal_id
             where p.request_id = r.id) as agreed_at,
           p.created_at as profile_at, p.decided_at as profile_decided_at, p.items as profile_items,
           exists (select 1 from app.requester_grants g
                   where g.request_id = r.id and g.kind = 'calendar' and g.revoked_at is null) as calendar_grant,
           exists (select 1 from app.requester_grants g
                   where g.request_id = r.id and g.kind = 'identity' and g.created_at = r.identified_at) as identity_google
    from app.requests r left join app.requester_host_profiles p on p.request_id = r.id
    where r.id = ${requestId}
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
        : { receipt: { text: request.identity_google ? "Continued with Google" : [request.requester_name, request.contact_email].filter(Boolean).join(" · ") }, status: "answered" }),
    });
  }

  const reviews = await db<{ created_at: Date; fields: string[] | null; id: string; patch: ReviewPatch | null; resolved_at: Date | null; state: string }[]>`
    select id, state, created_at, resolved_at, patch, (select array_agg(key) from jsonb_object_keys(patch) as key) as fields
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
        at: iso(review.resolved_at ?? review.created_at),
        receipt: { text: review.state === "applied" ? `Applied: ${fieldText(review.fields)}` : "Dismissed", ...(review.state === "applied" && review.patch ? { patch: review.patch } : {}) },
        status: "answered",
      });
    }
  }

  if (request.profile_at) {
    const items = request.profile_items ?? [];
    cards.push({
      at: iso(request.profile_decided_at ?? request.profile_at),
      id: "host_profile",
      kind: "host_profile",
      ...(request.profile_decided_at
        ? { receipt: { text: items.length > 0 ? `Using ${items.map((item) => PROFILE_LABELS[item] ?? item).join(", ")}` : "Not now" }, status: "answered" }
        : { status: step === "host_profile" ? "open" : "waiting" }),
    });
  }

  if (!draft) {
    cards.push({ at: iso(identifiedAt), id: "status:sent", kind: "status", status: "answered" });
    // Just after the agreement it follows, which is anchored at the same moment.
    if (request.agreed_at) {
      cards.push({ at: iso(new Date(request.agreed_at.getTime() + 1)), id: "status:awaiting", kind: "status", status: "answered" });
    }

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

    cards.push({
      at: iso(identifiedAt),
      id: "meeting",
      kind: "meeting",
      ...(step === "meeting" ? { status: "open" } : request.purpose ? { receipt: { text: request.purpose }, status: "answered" } : { status: "waiting" }),
    });
  }

  const evaluations = await db<{ created_at: Date; id: string }[]>`
    select id, created_at from app.evaluations where request_id = ${requestId} order by created_at
  `;
  const proposals = await db<
    { agreed_at: Date | null; created_at: Date; end_at: Date; evaluation_id: string; start_at: Date; version: number }[]
  >`
    select p.version, p.evaluation_id, p.start_at, p.end_at, p.created_at, a.agreed_at
    from app.proposals p left join app.agreements a on a.proposal_id = p.id
    where p.request_id = ${requestId} order by p.version
  `;

  for (const evaluation of evaluations) {
    const chosen = proposals.filter((proposal) => proposal.evaluation_id === evaluation.id).at(-1);
    const isCurrent = evaluation.id === current.evaluationId;
    const base = { at: iso(evaluation.created_at), id: `times:${evaluation.id}`, kind: "times" as const };

    if (isCurrent && step === "times") cards.push({ ...base, status: "open" });
    else if (chosen) {
      cards.push({
        ...base,
        receipt: { end: iso(chosen.end_at), start: iso(chosen.start_at), text: "You chose" },
        status: "answered",
      });
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

    if (proposal.version === current.agreedVersion) {
      cards.push({ ...base, at: iso(proposal.agreed_at ?? proposal.created_at), receipt: { ...window, text: "You agreed" }, status: "answered" });
    } else if (proposal.version === current.proposalVersion) {
      cards.push({ ...base, receipt: { ...window, text: "Proposed" }, status: step === "proposal" ? "open" : "waiting" });
    } else cards.push({ ...base, status: "superseded" });
  }

  return cards.sort((a, b) => a.at.localeCompare(b.at) || ORDER.get(a.kind)! - ORDER.get(b.kind)!);
}
