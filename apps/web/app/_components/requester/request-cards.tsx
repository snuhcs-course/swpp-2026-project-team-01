"use client";

import { EVALUATION_FAILURE_MESSAGES, NO_MATCH_MESSAGE } from "@lib/contracts/feasibility";
import type { LinkPlan, RequesterCandidate, RequestLanguage, RequestWindow, ReviewPatch } from "@lib/contracts/request";
import { displayTime, zoneLabel } from "@lib/contracts/timezone";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { GuestCard, GuestCardActions } from "@/app/_components/guest/guest-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommandOutcome, RequesterCardContext, RequesterCardDefinition } from "./cards";

// The requester's scheduling cards (design decision 12; DESIGN.md: conversation
// card and proposal card), in the order the booking page offers them: the
// review of extracted details, the meeting details editor (a secondary surface
// opened from a card), the proposal awaiting agreement and the candidate times.
// Each posts one command with the expected revision and keeps its retry key
// until the service answers. A message in the conversation records none of
// these decisions.

// The meeting details editor is open while this marker is in the tab's card
// set (the set records cards set aside, and this one is opened instead).
export const DETAILS_OPEN = "meeting-details:open";

const MODE_LABELS = { either: "Online or in person", in_person: "In person", online: "Online" } as const;
const TRAVEL_LABELS = { driving: "Driving", transit: "Public transit", walking: "Walking" } as const;
const DURATIONS = [15, 30, 45, 60, 90, 120];

function language(context: RequesterCardContext): RequestLanguage {
  return context.view.request.details.language === "ko" ? "ko" : "en";
}

function clockOf(instant: Date, timeZone: string) {
  return displayTime(instant, timeZone).split(", ")[1]!;
}

// "Mon 3 Nov, 10:00 GMT+9 to 10:30 GMT+9"
function timeRange(window: RequestWindow, timeZone: string) {
  return `${displayTime(new Date(window.start), timeZone)} to ${clockOf(new Date(window.end), timeZone)}`;
}

function linkPlanText(plan: LinkPlan | null | undefined) {
  if (!plan) return null;
  return plan.kind === "google_meet" ? "A Google Meet link is created when the meeting is booked" : `Your meeting link: ${plan.url}`;
}

function failureText(outcome: Extract<CommandOutcome, { ok: false }>) {
  const { category } = outcome.error;
  const reason = (outcome.error as { reason?: string }).reason;

  if (reason === "start_passed") return "That time has already started. Choose or give a later time.";
  if (reason === "proposal_superseded") return "A newer proposal replaced this one. Check the current one below.";
  if (category === "stale_revision") return "This request changed since you last saw it. Check it and try again.";
  if (category === "invalid_input") return "This cannot be done with the current details. Check them and try again.";
  return outcome.error.message;
}

function StatusLine({ message, tone = "error" }: { readonly message: string | null; readonly tone?: "error" | "info" }) {
  return (
    <div aria-live="polite" role="status">
      {message ? <p className={tone === "error" ? "text-destructive" : "text-muted-foreground"}>{message}</p> : null}
    </div>
  );
}

function useAction(context: RequesterCardContext) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(operation: string, input: unknown, expectedRevision: number | null = context.view.request.revision) {
    setBusy(true);
    setError(null);
    const outcome = await context.run(operation, input, expectedRevision);
    setBusy(false);
    if (!outcome.ok) setError(failureText(outcome));
    return outcome;
  }

  return { act, busy, error, setError };
}

function DetailList({ rows }: { readonly rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map(([term, value]) => (
        <div className="contents" key={term}>
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function patchRows(patch: ReviewPatch, timeZone: string): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [];

  if (patch.purpose !== undefined) rows.push(["Purpose", patch.purpose]);
  if (patch.durationMinutes !== undefined && patch.durationMinutes !== null) rows.push(["Length", `${patch.durationMinutes} minutes`]);
  if (patch.mode) rows.push(["Mode", MODE_LABELS[patch.mode]]);
  if (patch.location) rows.push(["Place", patch.location]);
  if (patch.linkPlan) rows.push(["Meeting link", linkPlanText(patch.linkPlan)]);
  if (patch.travelMode) rows.push(["Your travel", TRAVEL_LABELS[patch.travelMode]]);
  if (patch.windows) {
    rows.push([
      "Free times",
      <ul className="flex flex-col" key="windows">
        {patch.windows.map((window) => (
          <li key={window.start}>{timeRange(window, timeZone)}</li>
        ))}
      </ul>,
    ]);
  }
  if (patch.contactName !== undefined) rows.push(["Your name", patch.contactName || "(empty)"]);
  if (patch.contactEmail !== undefined) rows.push(["Your email", patch.contactEmail || "(empty)"]);

  return rows;
}

// ---------------------------------------------------------------------------
// Review extracted details: **Apply these details** and **Dismiss**

function ReviewCard({ context }: { readonly context: RequesterCardContext }) {
  const review = context.view.pendingReview!;
  const { act, busy, error } = useAction(context);
  const canApply = review.patch !== null && review.clarifications.length === 0;
  const awaiting = context.view.request.state === "awaiting_host_approval";

  return (
    <GuestCard
      description={
        canApply
          ? "Thyme drafted these from the conversation. Nothing changes until you apply them."
          : "Thyme needs one more detail before anything can change."
      }
      id="review"
      label="Review details"
      title={canApply ? "Apply these details?" : (review.questions[0] ?? "One more detail")}
    >
      {review.patch ? <DetailList rows={patchRows(review.patch, context.timezone)} /> : null}
      {review.questions.length > (canApply ? 0 : 1) ? (
        <ul className="flex list-disc flex-col pl-5">
          {review.questions.slice(canApply ? 0 : 1).map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      ) : null}
      {awaiting ? <p>Your agreed proposal waits for the host, so details cannot change now.</p> : null}
      <GuestCardActions>
        {canApply && !awaiting ? (
          <Button
            className="min-h-11"
            disabled={busy}
            onClick={() => void act("request.apply_review", { reviewId: review.id })}
            type="button"
          >
            {busy ? "Applying..." : "Apply these details"}
          </Button>
        ) : null}
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => void act("request.dismiss_review", { reviewId: review.id })}
          type="button"
          variant="outline"
        >
          Dismiss
        </Button>
      </GuestCardActions>
      <StatusLine message={error} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// Meeting details (secondary surface): **Save details**

type WindowRow = { readonly key: string; date: string; start: string; end: string };

function localParts(instant: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function windowRows(windows: readonly RequestWindow[] | undefined, timeZone: string): WindowRow[] {
  return (windows ?? []).map((window) => {
    const start = localParts(window.start, timeZone);
    return { date: start.date, end: localParts(window.end, timeZone).time, key: crypto.randomUUID(), start: start.time };
  });
}

function DetailsCard({ context }: { readonly context: RequesterCardContext }) {
  const id = useId();
  const { details } = context.view.request;
  const [purpose, setPurpose] = useState(details.purpose ?? "");
  const [duration, setDuration] = useState(details.durationMinutes ? String(details.durationMinutes) : "");
  const [mode, setMode] = useState<string>(details.mode ?? "");
  const [location, setLocation] = useState(details.location ?? "");
  const [link, setLink] = useState(details.linkPlan?.kind === "requester_link" ? details.linkPlan.url : "");
  const [travel, setTravel] = useState<string>(details.travelMode ?? "");
  const [windows, setWindows] = useState<WindowRow[]>(() => windowRows(details.windows, context.timezone));
  const { act, busy, error, setError } = useAction(context);

  async function save(event: FormEvent) {
    event.preventDefault();
    const changes: Record<string, unknown> = {};

    if (purpose.trim() && purpose.trim() !== (details.purpose ?? "")) changes.purpose = purpose.trim();
    if (duration && Number(duration) !== details.durationMinutes) changes.durationMinutes = Number(duration);
    if (mode && mode !== details.mode) changes.mode = mode;
    if (mode === "in_person" && location.trim() && location.trim() !== (details.location ?? "")) changes.location = location.trim();
    if (mode === "in_person" && travel && travel !== details.travelMode) changes.travelMode = travel;
    if (mode === "online" && link.trim() && !(details.linkPlan?.kind === "requester_link" && details.linkPlan.url === link.trim())) {
      if (!link.trim().startsWith("https://")) {
        setError("A meeting link must start with https://.");
        return;
      }
      changes.meetingLink = link.trim();
    }

    const filled = windows.filter((row) => row.date && row.start && row.end);
    const before = windowRows(details.windows, context.timezone);
    const sameWindows =
      filled.length === before.length &&
      filled.every((row, index) => row.date === before[index]!.date && row.start === before[index]!.start && row.end === before[index]!.end);
    if (filled.length > 0 && !sameWindows) changes.windows = filled.map(({ date, end, start }) => ({ date, end, start }));

    if (Object.keys(changes).length === 0) {
      context.reopen(DETAILS_OPEN);
      return;
    }

    const outcome = await act("request.update_details", { details: changes, timezone: context.timezone });
    if (outcome.ok) context.reopen(DETAILS_OPEN);
  }

  const field = "flex flex-col gap-1";
  const select = "min-h-11 rounded-lg border border-input bg-background px-3 text-base";

  return (
    <GuestCard
      description={`Times are in ${zoneLabel(context.timezone)}. Saving here changes the request directly.`}
      id="meeting-details"
      label="Meeting details"
      title="Edit the meeting details"
    >
      <form className="flex flex-col gap-3" noValidate onSubmit={(event) => void save(event)}>
        <div className={field}>
          <label className="font-medium" htmlFor={`${id}-purpose`}>
            Purpose
          </label>
          <Input className="min-h-11" id={`${id}-purpose`} onChange={(event) => setPurpose(event.target.value)} value={purpose} />
        </div>
        <div className={field}>
          <label className="font-medium" htmlFor={`${id}-duration`}>
            Length
          </label>
          <select className={select} id={`${id}-duration`} onChange={(event) => setDuration(event.target.value)} value={duration}>
            <option value="">Not set</option>
            {DURATIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">Mode</legend>
          <div className="flex flex-wrap gap-x-4">
            {(["online", "in_person"] as const).map((value) => (
              <label className="flex min-h-11 items-center gap-2" key={value}>
                <input checked={mode === value} className="size-4" name={`${id}-mode`} onChange={() => setMode(value)} type="radio" />
                {MODE_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "in_person" ? (
          <>
            <div className={field}>
              <label className="font-medium" htmlFor={`${id}-location`}>
                Place
              </label>
              <Input className="min-h-11" id={`${id}-location`} onChange={(event) => setLocation(event.target.value)} value={location} />
            </div>
            <div className={field}>
              <label className="font-medium" htmlFor={`${id}-travel`}>
                How you will travel
              </label>
              <select className={select} id={`${id}-travel`} onChange={(event) => setTravel(event.target.value)} value={travel}>
                <option value="">Not set</option>
                {(["driving", "transit", "walking"] as const).map((value) => (
                  <option key={value} value={value}>
                    {TRAVEL_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        {mode === "online" ? (
          <div className={field}>
            <label className="font-medium" htmlFor={`${id}-link`}>
              Meeting link (optional when the host can create Google Meet)
            </label>
            <Input
              className="min-h-11"
              id={`${id}-link`}
              inputMode="url"
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://"
              type="url"
              value={link}
            />
          </div>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">When you are free</legend>
          {windows.map((row, index) => (
            <div className="flex flex-wrap items-end gap-2" key={row.key}>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">Date {index + 1}</span>
                <Input
                  className="min-h-11"
                  onChange={(event) => setWindows(windows.map((entry) => (entry.key === row.key ? { ...entry, date: event.target.value } : entry)))}
                  type="date"
                  value={row.date}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">From</span>
                <Input
                  className="min-h-11"
                  onChange={(event) => setWindows(windows.map((entry) => (entry.key === row.key ? { ...entry, start: event.target.value } : entry)))}
                  type="time"
                  value={row.start}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">To</span>
                <Input
                  className="min-h-11"
                  onChange={(event) => setWindows(windows.map((entry) => (entry.key === row.key ? { ...entry, end: event.target.value } : entry)))}
                  type="time"
                  value={row.end}
                />
              </label>
              <Button
                aria-label={`Remove free time ${index + 1}`}
                className="min-h-11"
                onClick={() => setWindows(windows.filter((entry) => entry.key !== row.key))}
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              className="min-h-11"
              onClick={() => setWindows([...windows, { date: "", end: "", key: crypto.randomUUID(), start: "" }])}
              type="button"
              variant="outline"
            >
              Add a free time
            </Button>
          </div>
        </fieldset>
        <GuestCardActions>
          <Button className="min-h-11" disabled={busy} type="submit">
            {busy ? "Saving..." : "Save details"}
          </Button>
          <Button className="min-h-11" onClick={() => context.reopen(DETAILS_OPEN)} type="button" variant="outline">
            Cancel
          </Button>
        </GuestCardActions>
      </form>
      <StatusLine message={error} />
    </GuestCard>
  );
}

export function DetailsButton({ context, label = "Meeting details" }: { readonly context: RequesterCardContext; readonly label?: string }) {
  return (
    <Button className="min-h-11" onClick={() => context.dismiss(DETAILS_OPEN)} type="button" variant="ghost">
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Proposal: **Agree to this proposal**

function ProposalCard({ context }: { readonly context: RequesterCardContext }) {
  const proposal = context.view.proposal!;
  const { act, busy, error } = useAction(context);
  const host = proposal.participants.find((participant) => participant.role === "host")?.name ?? context.view.host.displayName;
  const rows: [string, ReactNode][] = [
    ["Meeting", context.view.request.details.purpose ?? `With ${host}`],
    ["When", timeRange(proposal, context.timezone)],
    ["Timezone", zoneLabel(context.timezone, new Date(proposal.start))],
    ["Length", `${proposal.durationMinutes} minutes`],
    ["Who", proposal.participants.map((participant) => participant.name).join(" and ")],
    [proposal.mode === "online" ? "Online" : "Place", proposal.mode === "online" ? linkPlanText(proposal.linkPlan) : (proposal.location ?? "In person")],
    ["Status", "Not agreed yet. After you agree, the host approves or declines; nothing is booked before that."],
  ];

  return (
    <GuestCard
      description={`Proposal version ${proposal.version}. Agreeing covers exactly these details.`}
      id="proposal"
      label="Proposal"
      title="Agree to this time?"
    >
      <DetailList rows={rows} />
      <GuestCardActions>
        <Button className="min-h-11" disabled={busy} onClick={() => void act("request.agree", { version: proposal.version })} type="button">
          {busy ? "Agreeing..." : "Agree to this proposal"}
        </Button>
        <Button className="min-h-11" onClick={() => context.dismiss(`proposal:${proposal.version}`)} type="button" variant="outline">
          Choose another time
        </Button>
      </GuestCardActions>
      <StatusLine message={error} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// Candidate times: **Choose this time**, **Find other times** and, for an
// unresolved trip of the requester's own, **Allow N minutes for my trip**

const ALLOWANCE_MINUTES = Array.from({ length: 48 }, (_, index) => (index + 1) * 5);

function CandidateTime({ candidate, timeZone }: { readonly candidate: RequesterCandidate; readonly timeZone: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <p className="font-medium tabular-nums">{timeRange(candidate, timeZone)}</p>
      <p className="text-muted-foreground">
        {zoneLabel(timeZone, new Date(candidate.start))} · {candidate.durationMinutes} minutes ·{" "}
        {candidate.mode === "online" ? "Online" : (candidate.location ?? "In person")}
      </p>
    </div>
  );
}

function TripAllowance({
  candidate,
  context,
  evaluationId,
}: {
  readonly candidate: RequesterCandidate;
  readonly context: RequesterCardContext;
  readonly evaluationId: string;
}) {
  const id = useId();
  const [minutes, setMinutes] = useState(30);
  const { act, busy, error } = useAction(context);
  const direction = candidate.unresolvedRequesterLeg === "inbound" ? "from your earlier event" : "to your next event";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <CandidateTime candidate={candidate} timeZone={context.timezone} />
      <p>We could not estimate your trip {direction}.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1" htmlFor={`${id}-minutes`}>
          <span className="text-muted-foreground text-xs">Your trip takes</span>
          <select
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
            id={`${id}-minutes`}
            onChange={(event) => setMinutes(Number(event.target.value))}
            value={minutes}
          >
            {ALLOWANCE_MINUTES.map((value) => (
              <option key={value} value={value}>
                {value} minutes
              </option>
            ))}
          </select>
        </label>
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => void act("request.allow_trip", { candidateId: candidate.id, evaluationId, minutes }, null)}
          type="button"
          variant="outline"
        >
          Allow {minutes} minutes for my trip
        </Button>
      </div>
      <StatusLine message={error} />
    </li>
  );
}

function missingLabels(context: RequesterCardContext) {
  const { details } = context.view.request;
  return [
    ...(details.durationMinutes ? [] : ["the meeting length"]),
    ...(details.mode ? [] : ["online or in person"]),
    ...(details.windows?.length ? [] : ["when you are free"]),
  ];
}

function CandidatesCard({ context }: { readonly context: RequesterCardContext }) {
  const { evaluation, request } = context.view;
  const { act, busy, error } = useAction(context);
  const [notice, setNotice] = useState<string | null>(null);
  const missing = missingLabels(context);
  const lang = language(context);

  useEffect(() => {
    if (evaluation?.state !== "pending") return;
    const timer = setInterval(() => void context.refresh(), 1500);
    return () => clearInterval(timer);
  }, [evaluation?.state, context.refresh]);

  const findTimes = async () => {
    setNotice(null);
    await act("request.evaluate", {}, null);
  };

  const findButton = (label: string) => (
    <Button className="min-h-11" disabled={busy || missing.length > 0} onClick={() => void findTimes()} type="button" variant={evaluation ? "outline" : "default"}>
      {label}
    </Button>
  );

  if (!evaluation) {
    return (
      <GuestCard
        description={
          missing.length > 0
            ? `To find times, add ${missing.join(", ")} in the conversation or in the meeting details.`
            : "Times are checked against the host's availability privately and automatically."
        }
        id="candidates"
        label="Times"
        title="Find times that work?"
      >
        <GuestCardActions>
          {findButton("Find times")}
          <DetailsButton context={context} />
        </GuestCardActions>
        <StatusLine message={error} />
      </GuestCard>
    );
  }

  if (evaluation.state === "pending") {
    return (
      <GuestCard id="candidates" label="Times" title="Finding times...">
        <p role="status">Checking your windows. This takes a few seconds.</p>
      </GuestCard>
    );
  }

  const offered = evaluation.candidates.filter((candidate) => !candidate.unresolvedRequesterLeg);
  const trips = evaluation.candidates.filter((candidate) => candidate.unresolvedRequesterLeg);
  // An online time with neither a Google Meet plan nor the requester's own link
  // cannot become a proposal (design decision 11).
  const linkMissing = (candidate: RequesterCandidate) =>
    candidate.mode === "online" && !candidate.linkPlan && request.details.linkPlan?.kind !== "requester_link";
  const needsLink = offered.some(linkMissing);
  const message = evaluation.failure
    ? EVALUATION_FAILURE_MESSAGES[evaluation.failure][lang]
    : offered.length === 0 && trips.length === 0
      ? NO_MATCH_MESSAGE[lang]
      : null;

  async function choose(candidate: RequesterCandidate) {
    setNotice(null);
    const outcome = await act("request.choose_candidate", { candidateId: candidate.id, evaluationId: evaluation!.id });
    if (outcome.ok && (outcome.result as { outcome?: string }).outcome === "needs_meeting_link") {
      setNotice("Add a meeting link in the meeting details to choose an online time.");
    }
  }

  return (
    <GuestCard
      description={offered.length > 0 ? `Times in ${zoneLabel(context.timezone)}.` : undefined}
      id="candidates"
      label="Times"
      title={offered.length > 0 ? "Choose a time" : trips.length > 0 ? "These times depend on your trip" : "No times found yet"}
    >
      {message ? <p>{message}</p> : null}
      {needsLink && offered.length > 0 ? <p>The host cannot create a Google Meet link, so add your own meeting link to choose a time.</p> : null}
      {offered.length > 0 ? (
        <ul aria-label="Candidate times" className="flex flex-col gap-2">
          {offered.map((candidate) => (
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3" key={candidate.id}>
              <CandidateTime candidate={candidate} timeZone={context.timezone} />
              <Button
                aria-label={`Choose this time: ${timeRange(candidate, context.timezone)}`}
                className="min-h-11"
                disabled={busy || linkMissing(candidate)}
                onClick={() => void choose(candidate)}
                type="button"
              >
                Choose this time
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {trips.length > 0 ? (
        <ul aria-label="Times that depend on your trip" className="flex flex-col gap-2">
          {trips.map((candidate) => (
            <TripAllowance candidate={candidate} context={context} evaluationId={evaluation.id} key={candidate.id} />
          ))}
        </ul>
      ) : null}
      <GuestCardActions>
        {findButton("Find other times")}
        <DetailsButton context={context} label={needsLink ? "Add a meeting link" : "Meeting details"} />
      </GuestCardActions>
      <StatusLine message={error ?? notice} tone={error ? "error" : "info"} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// The slot entries, inserted before the calendar cards

function scheduling(context: RequesterCardContext) {
  return context.view.request.state === "gathering" || context.view.request.state === "negotiating";
}

// Candidate times open once there is an evaluation, or once the calendar step is
// settled (connected and its calendars saved, or set aside with Skip for now).
function calendarSettled({ dismissed, view }: RequesterCardContext) {
  const calendar = view.connection.calendar ? dismissed.has("calendar-selection") : dismissed.has("calendar-connect");
  return calendar && !(view.connection.canUseGoogleEmail && !dismissed.has("google-email"));
}

export const REQUEST_CARDS: readonly RequesterCardDefinition[] = [
  {
    id: "review",
    isOpen: ({ view }) => view.pendingReview !== null,
    render: (context) => <ReviewCard context={context} />,
  },
  {
    id: "meeting-details",
    isOpen: (context) => context.dismissed.has(DETAILS_OPEN) && scheduling(context),
    render: (context) => <DetailsCard context={context} />,
  },
  {
    id: "proposal",
    isOpen: (context) =>
      context.view.proposal !== null &&
      context.view.agreement === null &&
      context.view.request.state === "negotiating" &&
      !context.dismissed.has(`proposal:${context.view.proposal.version}`),
    render: (context) => <ProposalCard context={context} />,
  },
  {
    id: "candidates",
    isOpen: (context) => scheduling(context) && (context.view.evaluation !== null || calendarSettled(context)),
    render: (context) => <CandidatesCard context={context} />,
  },
];
