"use client";

import { BOOKING_STATUS_TEXT, type BookingFailure } from "@lib/contracts/booking";
import type { CommandFailure } from "@lib/contracts/command-errors";
import type { HostCandidate, HostRequestOperation, HostRequestView, HostSuggestion } from "@lib/contracts/host-request";
import type { LinkPlan } from "@lib/contracts/request";
import { displayTime, instantFromLocal, zoneLabel } from "@lib/contracts/timezone";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Receipt } from "@/app/_components/booking-receipt";
import { GuestCard, GuestCardActions } from "@/app/_components/guest/guest-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The host's decision cards for one request (host-review-and-booking design 3,
// 4, 8 and 10; DESIGN.md: conversation card and proposal card): the proposal
// review with **Approve this proposal**, **Request changes** and **Decline**;
// **Review proposed shared changes** with **Share revised details** and
// **Dismiss suggestions**; the private rule and travel review; and the booking
// status with its receipt and **Check booking status**. Each posts one command
// with the expected revision and keeps its retry key until the service answers.
// A message in the private discussion records none of these decisions.

export type HostRun = (operation: HostRequestOperation, input: unknown, expectedRevision?: number | null) => Promise<
  { readonly ok: true } | { readonly ok: false; readonly error: CommandFailure }
>;

export type HostCardContext = {
  readonly view: HostRequestView;
  readonly run: HostRun;
};

const MODE_LABELS = { either: "Online or in person", in_person: "In person", online: "Online" } as const;
const DURATIONS = [15, 30, 45, 60, 90, 120];

function failureText(error: CommandFailure) {
  if (error.reason === "start_passed") return "That time has already started. Suggest a later one.";
  if (error.reason === "proposal_superseded") return "A newer proposal replaced this one. The current one is shown.";
  if (error.category === "stale_revision") return "This request changed since you last saw it. Check it and try again.";
  if (error.category === "invalid_input") return "This cannot be done with the current details.";
  return error.message;
}

function useAction(context: HostCardContext) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(operation: HostRequestOperation, input: unknown, expectedRevision: number | null = context.view.revision) {
    setBusy(true);
    setError(null);
    const outcome = await context.run(operation, input, expectedRevision);
    setBusy(false);
    if (!outcome.ok) setError(failureText(outcome.error));
    return outcome;
  }

  return { act, busy, error };
}

function StatusLine({ message }: { readonly message: string | null }) {
  return (
    <div aria-live="polite" role="status">
      {message ? <p className="text-destructive">{message}</p> : null}
    </div>
  );
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

function linkText(plan: LinkPlan | null | undefined) {
  if (!plan) return null;
  return plan.kind === "google_meet" ? "Google Meet, created when the meeting is booked" : plan.url;
}

// "Mon 3 Nov, 10:00 GMT+9 to 10:30 GMT+9", in the host's zone, and the
// requester's own clock when their zone differs.
function when(start: string, end: string, view: HostRequestView) {
  const host = `${displayTime(new Date(start), view.hostTimezone)} to ${displayTime(new Date(end), view.hostTimezone).split(", ")[1]}`;
  if (view.requester.timezone === view.hostTimezone) return host;
  return (
    <>
      {host}
      <br />
      <span className="text-muted-foreground">
        {view.requester.name}: {displayTime(new Date(start), view.requester.timezone)}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Proposal review

export function ProposalReviewCard({ context, onRequestChanges }: { readonly context: HostCardContext; readonly onRequestChanges: () => void }) {
  const { view } = context;
  const proposal = view.proposal!;
  const { act, busy, error } = useAction(context);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const agreed = proposal.agreedAt !== null;
  const awaiting = view.state === "awaiting_host_approval" && agreed;

  return (
    <GuestCard
      description={
        awaiting
          ? `${view.requester.name} agreed to these exact details. Approving books the meeting in your calendar.`
          : "The requester has not agreed to this version yet."
      }
      id="proposal-review"
      label={`Proposal, version ${proposal.version}`}
      title={awaiting ? "Approve this meeting?" : "Waiting for the requester"}
    >
      <DetailList
        rows={[
          ["When", when(proposal.start, proposal.end, view)],
          ["Length", `${proposal.durationMinutes} minutes`],
          ["Mode", MODE_LABELS[proposal.mode]],
          ...(proposal.mode === "in_person" ? ([["Place", proposal.location ?? "Not set"]] as const) : []),
          ...(proposal.mode === "online" ? ([["Meeting link", linkText(proposal.linkPlan) ?? "Not set"]] as const) : []),
          ["With", `${view.requester.name} <${view.requester.email}>${view.requester.emailConfirmed ? "" : " (address not confirmed)"}`],
          ...(view.details.purpose ? ([["Purpose", view.details.purpose]] as const) : []),
        ]}
      />
      {confirmDecline ? (
        <div className="flex flex-col gap-2" role="group" aria-label="Confirm decline">
          <p>Decline this request? {view.requester.name} is told by email, and the request closes.</p>
          <GuestCardActions>
            <Button disabled={busy} onClick={() => void act("request.decline", {})} type="button" variant="destructive">
              Decline request
            </Button>
            <Button onClick={() => setConfirmDecline(false)} type="button" variant="ghost">
              Keep it
            </Button>
          </GuestCardActions>
        </div>
      ) : (
        <GuestCardActions>
          <Button disabled={busy || !awaiting} onClick={() => void act("request.approve", { version: proposal.version })} type="button">
            Approve this proposal
          </Button>
          <Button disabled={busy} onClick={onRequestChanges} type="button" variant="outline">
            Request changes
          </Button>
          <Button disabled={busy} onClick={() => setConfirmDecline(true)} type="button" variant="ghost">
            Decline
          </Button>
        </GuestCardActions>
      )}
      <StatusLine message={error} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// Request changes: the suggestion editor

function localParts(instant: string | undefined, timeZone: string) {
  if (!instant) return { date: "", time: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit", month: "2-digit", timeZone, year: "numeric" })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function SuggestionEditor({ context, onClose }: { readonly context: HostCardContext; readonly onClose: () => void }) {
  const { view } = context;
  const base = view.proposal;
  const initial = localParts(base?.start, view.hostTimezone);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(String(base?.durationMinutes ?? view.details.durationMinutes ?? 30));
  const [mode, setMode] = useState<"online" | "in_person">(base?.mode ?? (view.details.mode === "in_person" ? "in_person" : "online"));
  const [place, setPlace] = useState(base?.location ?? view.details.location ?? "");
  const [link, setLink] = useState(base?.linkPlan?.kind === "requester_link" ? base.linkPlan.url : "");
  const [problem, setProblem] = useState<string | null>(null);
  const { act, busy, error } = useAction(context);
  const ids = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const start = date && time ? instantFromLocal(date, time, view.hostTimezone) : null;
    if ((date || time) && !start) {
      setProblem("That local time does not exist or is incomplete. Give a date and a time.");
      return;
    }
    setProblem(null);

    const changes: Record<string, unknown> = {};
    if (start && start !== base?.start) changes.start = start;
    if (Number(duration) !== (base?.durationMinutes ?? view.details.durationMinutes)) changes.durationMinutes = Number(duration);
    if (mode !== base?.mode) changes.mode = mode;
    if (mode === "in_person" && place.trim() && place.trim() !== base?.location) changes.location = place.trim();
    if (mode === "online" && link.trim()) changes.linkPlan = { kind: "requester_link", url: link.trim() };

    if (Object.keys(changes).length === 0) {
      setProblem("Change at least one detail.");
      return;
    }

    const outcome = await act("request.suggest_changes", { changes }, null);
    if (outcome.ok) onClose();
  }

  return (
    <GuestCard
      description={`Times are in your time zone, ${zoneLabel(view.hostTimezone)}. Nothing is shared until you review the suggestion and press Share revised details.`}
      id="suggestion-editor"
      label="Request changes"
      title="What should change?"
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1" htmlFor={`${ids}-date`}>
            <span className="text-muted-foreground">Date</span>
            <Input id={`${ids}-date`} onChange={(event) => setDate(event.target.value)} type="date" value={date} />
          </label>
          <label className="flex flex-col gap-1" htmlFor={`${ids}-time`}>
            <span className="text-muted-foreground">Start time</span>
            <Input id={`${ids}-time`} onChange={(event) => setTime(event.target.value)} step={900} type="time" value={time} />
          </label>
          <label className="flex flex-col gap-1" htmlFor={`${ids}-duration`}>
            <span className="text-muted-foreground">Length</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-2"
              id={`${ids}-duration`}
              onChange={(event) => setDuration(event.target.value)}
              value={duration}
            >
              {[...new Set([...DURATIONS, Number(duration)])].sort((a, b) => a - b).map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1" htmlFor={`${ids}-mode`}>
            <span className="text-muted-foreground">Mode</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-2"
              id={`${ids}-mode`}
              onChange={(event) => setMode(event.target.value as "online" | "in_person")}
              value={mode}
            >
              <option value="online">Online</option>
              <option value="in_person">In person</option>
            </select>
          </label>
        </div>
        {mode === "in_person" ? (
          <label className="flex flex-col gap-1" htmlFor={`${ids}-place`}>
            <span className="text-muted-foreground">Place</span>
            <Input id={`${ids}-place`} maxLength={300} onChange={(event) => setPlace(event.target.value)} value={place} />
          </label>
        ) : (
          <label className="flex flex-col gap-1" htmlFor={`${ids}-link`}>
            <span className="text-muted-foreground">Meeting link (https:), or leave empty to keep the current plan</span>
            <Input id={`${ids}-link`} inputMode="url" maxLength={500} onChange={(event) => setLink(event.target.value)} value={link} />
          </label>
        )}
        <GuestCardActions>
          <Button disabled={busy} type="submit">
            Save suggestion
          </Button>
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
        </GuestCardActions>
        <StatusLine message={problem ?? error} />
      </form>
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// Review proposed shared changes

function suggestionRows(suggestion: HostSuggestion, view: HostRequestView): [string, ReactNode, ReactNode][] {
  const base = view.proposal;
  const rows: [string, ReactNode, ReactNode][] = [];
  const { changes } = suggestion;

  if (changes.start) {
    const minutes = changes.durationMinutes ?? base?.durationMinutes ?? 30;
    const end = new Date(Date.parse(changes.start) + minutes * 60_000).toISOString();
    rows.push(["When", base ? when(base.start, base.end, view) : "Not set", when(changes.start, end, view)]);
  }
  if (changes.durationMinutes) rows.push(["Length", base ? `${base.durationMinutes} minutes` : "Not set", `${changes.durationMinutes} minutes`]);
  if (changes.mode) rows.push(["Mode", base ? MODE_LABELS[base.mode] : "Not set", MODE_LABELS[changes.mode]]);
  if (changes.location) rows.push(["Place", base?.location ?? "Not set", changes.location]);
  if (changes.linkPlan) rows.push(["Meeting link", linkText(base?.linkPlan) ?? "Not set", linkText(changes.linkPlan)]);

  return rows;
}

export function SuggestionCard({ context, onRequestChanges }: { readonly context: HostCardContext; readonly onRequestChanges: () => void }) {
  const { view } = context;
  const suggestion = view.suggestion!;
  const { act, busy, error } = useAction(context);
  const rows = suggestionRows(suggestion, view);

  if (suggestion.state === "checking") {
    return (
      <GuestCard description="Checking the suggested time against your calendar and rules." id="suggestion" label="Proposed shared changes" title="Checking the time">
        <p className="text-muted-foreground" role="status">
          This takes a few seconds.
        </p>
      </GuestCard>
    );
  }

  if (suggestion.state === "rejected") {
    return (
      <GuestCard description={suggestion.rejectionReason ?? "That time did not pass the check."} id="suggestion" label="Proposed shared changes" title="That time does not work">
        <p className="text-muted-foreground">The details were shared, but no new proposal was sent. The requester can still find other times.</p>
        <GuestCardActions>
          <Button onClick={onRequestChanges} type="button" variant="outline">
            Request changes
          </Button>
        </GuestCardActions>
      </GuestCard>
    );
  }

  if (suggestion.state === "shared") {
    return (
      <GuestCard
        description={`Version ${suggestion.proposalVersion ?? ""} was sent to ${view.requester.name}, who needs to agree to it before you approve.`}
        id="suggestion"
        label="Proposed shared changes"
        title="Shared with the requester"
      />
    );
  }

  return (
    <GuestCard
      description={`${suggestion.source === "assistant" ? "Thyme drafted these from your conversation." : "Your suggestion."} Sharing replaces the current proposal, so ${view.requester.name} agrees again and you approve again.`}
      id="suggestion"
      label="Review proposed shared changes"
      title="Share these changes?"
    >
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">Current and suggested details</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th className="w-1/4 font-normal" scope="col">
              Detail
            </th>
            <th className="font-normal" scope="col">
              Current
            </th>
            <th className="font-normal" scope="col">
              Suggested
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, current, next]) => (
            <tr className="align-top" key={label}>
              <th className="pr-2 font-normal text-muted-foreground" scope="row">
                {label}
              </th>
              <td className="pr-2 break-words">{current}</td>
              <td className="break-words font-medium">{next}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <GuestCardActions>
        <Button disabled={busy} onClick={() => void act("request.share_changes", { suggestionId: suggestion.id })} type="button">
          Share revised details
        </Button>
        <Button disabled={busy} onClick={() => void act("request.dismiss_changes", { suggestionId: suggestion.id }, null)} type="button" variant="ghost">
          Dismiss suggestions
        </Button>
      </GuestCardActions>
      <StatusLine message={error} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// Rule and travel review

function TripAllowance({ candidate, context, evaluationId }: { readonly candidate: HostCandidate; readonly context: HostCardContext; readonly evaluationId: string }) {
  const leg = candidate.hostLegs.find((entry) => entry.canAllow)!;
  const [minutes, setMinutes] = useState("30");
  const { act, busy, error } = useAction(context);
  const id = useId();

  return (
    <li className="flex flex-col gap-1.5">
      <span>
        {displayTime(new Date(candidate.start), context.view.hostTimezone)}: your {leg.direction === "inbound" ? "trip there" : "trip after"} could not be estimated.
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={id}>
          Minutes to allow for this trip
        </label>
        <select className="h-9 rounded-md border border-input bg-background px-2" id={id} onChange={(event) => setMinutes(event.target.value)} value={minutes}>
          {Array.from({ length: 48 }, (_, index) => (index + 1) * 5).map((value) => (
            <option key={value} value={value}>
              {value} minutes
            </option>
          ))}
        </select>
        <Button
          disabled={busy}
          onClick={() =>
            void act("request.allow_host_trip", { candidateId: candidate.id, direction: leg.direction, evaluationId, minutes: Number(minutes) }, null)
          }
          size="sm"
          type="button"
          variant="outline"
        >
          Allow {minutes} minutes for this trip
        </Button>
      </div>
      <StatusLine message={error} />
    </li>
  );
}

export function RuleTravelCard({ context }: { readonly context: HostCardContext }) {
  const { view } = context;
  const evaluation = view.evaluation;
  const { act, busy, error } = useAction(context);
  const allowable = evaluation?.candidates.filter((candidate) => candidate.status === "host_unresolved" && candidate.hostLegs.some((leg) => leg.canAllow)).slice(0, 5) ?? [];

  return (
    <GuestCard
      description="Only you see this. Busy time, your hours and trips that do not fit cannot be waived."
      id="rule-review"
      label="Rule and travel review"
      title={evaluation?.weeklyLimitHold ? "Every time falls in a full week" : allowable.length > 0 ? "Some trips need your estimate" : "Your rules for this request"}
    >
      {evaluation?.weeklyLimitHold ? (
        <div className="flex flex-col gap-2">
          <p>
            Each time that fits falls in a week that already has {view.weeklyLimit} meetings, so none is offered to {view.requester.name}.
          </p>
          <GuestCardActions>
            <Button disabled={busy} onClick={() => void act("request.waive_weekly_limit", {}, null)} type="button">
              Allow this request beyond my weekly limit
            </Button>
          </GuestCardActions>
        </div>
      ) : null}
      {allowable.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {allowable.map((candidate) => (
            <TripAllowance candidate={candidate} context={context} evaluationId={evaluation!.id} key={candidate.id} />
          ))}
        </ul>
      ) : null}
      {evaluation && evaluation.exclusions.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Why some times were left out ({evaluation.exclusions.length})</summary>
          <ul className="flex flex-col gap-1 pt-1.5">
            {evaluation.exclusions.slice(0, 8).map((entry) => (
              <li key={entry.start}>
                {displayTime(new Date(entry.start), view.hostTimezone)}: {entry.explanation}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {view.weeklyLimitWaived ? <p className="text-muted-foreground">You allowed this request beyond your weekly limit.</p> : null}
      <GuestCardActions>
        <Button disabled={busy} onClick={() => void act("request.host_evaluate", {}, null)} type="button" variant="outline">
          Find times
        </Button>
      </GuestCardActions>
      <StatusLine message={error} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// Booking status and receipt

const FAILURE_TEXT: Readonly<Record<BookingFailure, string>> = {
  calendar_access_revoked: "Google Calendar access was revoked. Reconnect your calendar from setup, then retry.",
  calendar_rejected: "Google Calendar refused the event. Check your booking calendar, then retry.",
  conflict: "The time no longer fits your calendar, so nothing was booked. The requester can choose another time.",
  declined: "You declined before booking started.",
  event_removed: "The event was removed from your calendar.",
  expired: "The request expired before booking started.",
  revalidation_unavailable: "Your calendar could not be checked just before booking, so nothing was booked. Retry when ready.",
  stale_decision: "The proposal changed before booking started, so nothing was booked.",
  withdrawn: "The requester withdrew before booking started.",
};

const RETRYABLE: readonly BookingFailure[] = ["calendar_access_revoked", "calendar_rejected", "revalidation_unavailable", "stale_decision"];

export function BookingCard({ context }: { readonly context: HostCardContext }) {
  const { view } = context;
  const booking = view.booking!;
  const { act, busy, error } = useAction(context);
  const retry = booking.state === "failed" && booking.failure && RETRYABLE.includes(booking.failure) && view.state === "awaiting_host_approval" && view.proposal;

  return (
    <GuestCard
      description={booking.state === "failed" && booking.failure ? FAILURE_TEXT[booking.failure] : BOOKING_STATUS_TEXT[booking.state].en}
      id="booking"
      label="Booking"
      title={
        booking.state === "confirmed"
          ? "Booked"
          : booking.state === "failed" || booking.state === "cancelled"
            ? "Not booked"
            : "Booking in progress"
      }
    >
      {booking.receipt ? <Receipt receipt={booking.receipt} timeZone={view.hostTimezone} /> : null}
      <GuestCardActions>
        {retry ? (
          <Button disabled={busy} onClick={() => void act("request.approve", { version: view.proposal!.version })} type="button">
            Retry booking
          </Button>
        ) : null}
        <Button disabled={busy} onClick={() => void act("booking.check", {}, null)} type="button" variant="outline">
          Check booking status
        </Button>
      </GuestCardActions>
      <StatusLine message={error} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// The next step

export type HostStep = "suggestion" | "editor" | "rules" | "proposal" | "booking" | "find";

// One actionable card at a time (design principle 4): a suggestion in progress
// first, then the rule and travel review while it has something to decide, then
// the proposal, then the booking.
export function nextHostStep(view: HostRequestView, editing: boolean): HostStep {
  if (editing) return "editor";
  if (view.suggestion && ["pending", "checking"].includes(view.suggestion.state)) return "suggestion";

  const booking = view.booking;
  if (booking && ["reserved", "dispatching", "confirmed"].includes(booking.state)) return "booking";
  if (booking?.state === "failed" && booking.failure && RETRYABLE.includes(booking.failure) && view.state === "awaiting_host_approval") {
    return "booking";
  }

  const unresolved = view.evaluation?.candidates.some((candidate) => candidate.status === "host_unresolved" && candidate.hostLegs.some((leg) => leg.canAllow));
  if (view.evaluation?.weeklyLimitHold || unresolved) return "rules";
  if (view.proposal) return "proposal";
  if (view.suggestion && ["rejected", "shared"].includes(view.suggestion.state)) return "suggestion";
  return "find";
}
