"use client";

import { BOOKING_STATUS_TEXT, type BookingFailure } from "@lib/contracts/booking";
import type { CommandFailure } from "@lib/contracts/command-errors";
import type { HostCandidate, HostRequestOperation, HostRequestView, HostSuggestion } from "@lib/contracts/host-request";
import type { LinkPlan } from "@lib/contracts/request";
import { isCalendarDate, MAX_DECLINED_DATES } from "@lib/contracts/declined-dates";
import { displayTime, instantFromLocal, localDate, zoneLabel } from "@lib/contracts/timezone";
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
  if (error.reason === "not_booked") return "Nothing is booked for this request.";
  if (error.reason === "time_unavailable") return "That time is no longer free on your calendar, so nothing was approved. Book another of the times, or decline.";
  if (error.reason === "time_choice_required") return "Choose which of the times to book.";
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
  const [declinedDates, setDeclinedDates] = useState<readonly string[]>([]);
  const closed = ["declined", "withdrawn", "expired", "cancelled"].includes(view.state);
  const awaiting = view.state === "awaiting_host_approval" && proposal.agreedAt !== null;
  // Several times the guest can make (multiple-candidate-times): the host books one.
  const times = proposal.times && proposal.times.length > 1 ? proposal.times : null;
  const start = new Date(proposal.start);
  const day = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: view.hostTimezone }).format(start);
  const weekday = new Intl.DateTimeFormat("en", { timeZone: view.hostTimezone, weekday: "long" }).format(start);
  const time = (instant: string) => new Intl.DateTimeFormat("en", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone: view.hostTimezone }).format(new Date(instant));
  const facts: readonly (readonly [string, ReactNode])[] = [
    ["Length", `${proposal.durationMinutes} minutes`],
    ...(times ? [] : ([["Mode", MODE_LABELS[proposal.mode]]] as const)),
    ...(!times && proposal.mode === "in_person" ? ([["Place", proposal.location ?? "Not set"]] as const) : []),
    ...(!times && proposal.mode === "online" ? ([["Meeting link", view.sample ? "Example Google Meet" : linkText(proposal.linkPlan) ?? "Not set"]] as const) : []),
    ["With", view.requester.email
      ? `${view.requester.name} <${view.requester.email}>${view.requester.emailConfirmed ? "" : " (address not confirmed)"}`
      : view.requester.name],
    ...(view.details.purpose ? ([["Purpose", view.details.purpose]] as const) : []),
  ];

  return (
    <section aria-labelledby="proposal-review-heading" className="flex min-w-0 flex-col gap-5 pt-5" id="proposal-review">
      <div>
        {view.sample ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">Sample request</p> : null}
        <h3 className="text-[21px] leading-[1.3] font-semibold tracking-tight" id="proposal-review-heading">{closed ? view.state === "withdrawn" ? "Request withdrawn" : view.state === "cancelled" ? "Meeting cancelled" : view.state === "expired" ? "Expired" : "Declined" : awaiting ? "Approve this meeting?" : "Waiting for the requester"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{view.sample ? "Try an action to complete this sample. No calendar event will be created and no guest will be notified." : closed ? "This request is closed." : awaiting && times ? `${view.requester.name} can make any of these ${times.length} times. Book the one you want; we’ll check your calendar for it and confirm the booking.` : awaiting ? `${view.requester.name} has agreed to the proposed details. Once you approve, we’ll check your calendar and confirm the booking.` : "We’re waiting for the requester to confirm the proposed details."}</p>
      </div>
      {times ? (
        <ol aria-label="Times the guest can make" className="flex flex-col gap-2">
          {times.map((entry, index) => {
            const label = `${displayTime(new Date(entry.start), view.hostTimezone)} – ${time(entry.end)}`;
            return (
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary px-4 py-3" key={entry.start}>
                <div className="min-w-0">
                  <p className="font-semibold">{index + 1}. {label}</p>
                  <p className="text-xs text-muted-foreground">
                    {MODE_LABELS[entry.mode]}{entry.mode === "in_person" ? ` · ${entry.location ?? "Place not set"}` : ` · ${linkText(entry.linkPlan) ?? "Link not set"}`}
                  </p>
                </div>
                {awaiting && !closed && !confirmDecline ? (
                  <Button aria-label={`Book time ${index + 1}: ${label}`} disabled={busy} onClick={() => void act("request.approve", { option: index + 1, version: proposal.version })} type="button">
                    Book this time
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
      <div className="grid grid-cols-[90px_1fr] items-center gap-3 rounded-2xl bg-secondary px-4 py-4 sm:grid-cols-[110px_1fr]">
        <div className="border-r border-border text-primary"><span className="block font-display text-[26px] leading-none">{day}</span><span className="text-xs font-semibold uppercase">{weekday}</span></div>
        <div className="min-w-0"><p className="text-lg font-semibold">{time(proposal.start)} – {time(proposal.end)}</p><p className="text-xs text-muted-foreground">{displayTime(start, view.hostTimezone).split(" ").at(-1)} · your time zone</p></div>
      </div>
      )}
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        {facts.map(([label, value]) => <div className={label === "With" ? "col-span-2 min-w-0" : "min-w-0"} key={label}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}
      </dl>
      {closed ? null : confirmDecline ? (
        <div className="flex flex-col gap-3" role="group" aria-label="Confirm decline">
          <p>Decline this request? {view.requester.name} is told by email, and the request closes.</p>
          {view.booking?.state === "confirmed" ? null : <DeclinedDatesField dates={declinedDates} onChange={setDeclinedDates} requester={view.requester.name} timeZone={view.hostTimezone} />}
          <GuestCardActions>
            <Button
              disabled={busy}
              onClick={() => void act("request.decline", declinedDates.length > 0 ? { excludedDates: declinedDates } : {})}
              type="button"
              variant="destructive"
            >
              Decline request
            </Button>
            <Button onClick={() => setConfirmDecline(false)} type="button" variant="ghost">
              Keep it
            </Button>
          </GuestCardActions>
        </div>
      ) : (
        <div className="border-t border-border pt-4"><GuestCardActions>
          {times ? null : (
            <Button disabled={busy || !awaiting} onClick={() => view.sample ? void act("tutorial.finish", { action: "approve", version: proposal.version }) : void act("request.approve", { version: proposal.version })} type="button">
              Approve this proposal
            </Button>
          )}
          <Button disabled={busy} onClick={view.sample ? () => void act("tutorial.finish", { action: "change" }) : onRequestChanges} type="button" variant="outline">
            Request changes
          </Button>
          <Button disabled={busy} onClick={() => view.sample ? void act("tutorial.finish", { action: "decline" }) : setConfirmDecline(true)} type="button" variant="ghost">
            Decline
          </Button>
          {view.sample ? <Button disabled={busy} onClick={() => void act("tutorial.finish", { action: "end" })} type="button" variant="ghost">End tutorial</Button> : null}
        </GuestCardActions></div>
      )}
      <StatusLine message={error} />
    </section>
  );
}

// Other dates that no longer work, named beside Decline
// (decline-with-unavailable-dates, #58): up to 14 dates from today in the
// host's zone. If the requester writes again, their next request leaves these
// days out and never says why, so no reason is asked for.
function DeclinedDatesField({
  dates,
  onChange,
  requester,
  timeZone,
}: {
  readonly dates: readonly string[];
  readonly onChange: (dates: readonly string[]) => void;
  readonly requester: string;
  readonly timeZone: string;
}) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const today = localDate(new Date(), timeZone);
  const full = dates.length >= MAX_DECLINED_DATES;
  const valid = isCalendarDate(draft) && draft >= today && !dates.includes(draft);
  const label = (date: string) =>
    new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T00:00:00Z`));

  function add() {
    if (!valid || full) return;
    onChange([...dates, draft].sort());
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={id}>
        Other dates that no longer work (optional)
      </label>
      <p className="text-xs text-muted-foreground" id={`${id}-hint`}>
        If {requester} writes again, their next request leaves these days out. They are not told why.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-describedby={`${id}-hint`}
          className="w-auto"
          disabled={full}
          id={id}
          min={today}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          type="date"
          value={draft}
        />
        <Button disabled={!valid || full} onClick={add} type="button" variant="outline">
          Add date
        </Button>
      </div>
      {dates.length > 0 ? (
        <ul aria-label="Dates that no longer work" className="flex flex-wrap gap-2">
          {dates.map((date) => (
            <li className="flex items-center gap-1 rounded-full bg-secondary py-1 pr-1 pl-3 text-sm" key={date}>
              {label(date)}
              <Button aria-label={`Remove ${label(date)}`} onClick={() => onChange(dates.filter((item) => item !== date))} size="icon-sm" type="button" variant="ghost">
                ×
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? <p className="text-xs text-muted-foreground">You can name up to {MAX_DECLINED_DATES} dates.</p> : null}
    </div>
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
        description={`The proposed details were sent to ${view.requester.name}. We’re waiting for their confirmation before you can approve.`}
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
            Each time that fits falls in a week already at your limit of {view.weeklyLimit}, so none is offered to {view.requester.name}.
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
  changed: "This meeting was moved; the new time is booked.",
  host_cancelled: "You cancelled this meeting. The requester was told, and the event is removed from your calendar.",
  requester_cancelled: "The requester cancelled this meeting. The event is removed from your calendar.",
  revalidation_unavailable: "Your calendar could not be checked just before booking, so nothing was booked. Retry when ready.",
  stale_decision: "The proposal changed before booking started, so nothing was booked.",
  withdrawn: "The requester withdrew before booking started.",
};

const RETRYABLE: readonly BookingFailure[] = ["calendar_access_revoked", "calendar_rejected", "revalidation_unavailable", "stale_decision"];

export function BookingCard({ context, onRequestChanges }: { readonly context: HostCardContext; readonly onRequestChanges?: () => void }) {
  const { view } = context;
  const booking = view.booking!;
  const { act, busy, error } = useAction(context);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Reopens the booked meeting for a change and opens the editor for the new details.
  async function change() {
    const outcome = await act("booking.change", {});
    if (outcome.ok) onRequestChanges?.();
  }
  const retry = booking.state === "failed" && booking.failure && RETRYABLE.includes(booking.failure) && view.state === "awaiting_host_approval" && view.proposal;
  // A booked meeting can be cancelled until it starts (post-booking-changes).
  const cancellable = view.state === "booked" && booking.state === "confirmed" && booking.receipt !== null && Date.parse(booking.receipt.start) > Date.now();

  return (
    <GuestCard
      description={(booking.state === "failed" || booking.state === "cancelled") && booking.failure ? FAILURE_TEXT[booking.failure] : BOOKING_STATUS_TEXT[booking.state].en}
      id="booking"
      label="Booking"
      title={
        booking.state === "confirmed"
          ? "Booked"
          : view.state === "cancelled"
            ? "Cancelled"
            : booking.state === "failed" || booking.state === "cancelled"
              ? "Not booked"
              : "Booking in progress"
      }
    >
      {booking.receipt ? <Receipt receipt={booking.receipt} timeZone={view.hostTimezone} /> : null}
      {confirmCancel ? (
        <div aria-label="Confirm cancellation" className="flex flex-col gap-2" role="group">
          <p>Cancel this meeting? {view.requester.name} is told, and the event is removed from your calendar. This cannot be undone.</p>
          <GuestCardActions>
            <Button
              disabled={busy}
              onClick={() => void act("booking.cancel", {}).then((outcome) => outcome.ok && setConfirmCancel(false))}
              type="button"
              variant="destructive"
            >
              Cancel meeting
            </Button>
            <Button onClick={() => setConfirmCancel(false)} type="button" variant="ghost">
              Keep it
            </Button>
          </GuestCardActions>
        </div>
      ) : null}
      <GuestCardActions>
        {retry ? (
          <Button disabled={busy} onClick={() => void act("request.approve", { version: view.proposal!.version })} type="button">
            Retry booking
          </Button>
        ) : null}
        {booking.state === "confirmed" || booking.state === "cancelled" ? null : (
          <Button disabled={busy} onClick={() => void act("booking.check", {}, null)} type="button" variant="outline">
            Check booking status
          </Button>
        )}
        {cancellable && !confirmCancel ? (
          <>
            <Button disabled={busy} onClick={() => void change()} type="button" variant="outline">
              Change meeting
            </Button>
            <Button disabled={busy} onClick={() => setConfirmCancel(true)} type="button" variant="ghost">
              Cancel meeting
            </Button>
          </>
        ) : null}
      </GuestCardActions>
      <StatusLine message={error} />
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// The next step

// A booked meeting reopened for a change: it stays confirmed while the
// request is open again (post-booking-changes design 5).
export function isChangingBooking(view: HostRequestView) {
  return view.booking?.state === "confirmed" && view.state !== "booked";
}

export type HostStep = "suggestion" | "editor" | "rules" | "proposal" | "booking" | "find";

// One actionable card at a time (design principle 4): a suggestion in progress
// first, then the rule and travel review while it has something to decide, then
// the proposal, then the booking.
export function nextHostStep(view: HostRequestView, editing: boolean): HostStep {
  if (editing) return "editor";
  if (view.suggestion && ["pending", "checking"].includes(view.suggestion.state)) return "suggestion";

  const booking = view.booking;
  if (booking && ["reserved", "dispatching"].includes(booking.state)) return "booking";
  if (booking?.state === "confirmed" && !isChangingBooking(view)) return "booking";
  if (view.state === "cancelled" && booking?.state === "cancelled") return "booking";
  if (booking?.state === "failed" && booking.failure && RETRYABLE.includes(booking.failure) && view.state === "awaiting_host_approval") {
    return "booking";
  }

  const unresolved = view.evaluation?.candidates.some((candidate) => candidate.status === "host_unresolved" && candidate.hostLegs.some((leg) => leg.canAllow));
  if (view.evaluation?.weeklyLimitHold || unresolved) return "rules";
  if (view.proposal) return "proposal";
  if (view.suggestion && ["rejected", "shared"].includes(view.suggestion.state)) return "suggestion";
  return "find";
}
