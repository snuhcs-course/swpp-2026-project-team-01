"use client";

import { EVALUATION_FAILURE_MESSAGES, NO_MATCH_MESSAGE, TIMES_SHOWN } from "@lib/contracts/feasibility";
import type { LinkPlan, RequesterCandidate, RequestLanguage, RequestWindow, ReviewPatch } from "@lib/contracts/request";
import { displayTime, zoneLabel } from "@lib/contracts/timezone";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { GUEST_CARD_SURFACE, GuestCard, GuestCardActions } from "@/app/_components/guest/guest-card";
import { groupWindows } from "@/app/_components/setup/format";
import { WeeklyWindowsEditor } from "@/app/_components/setup/weekly-windows-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommandOutcome, RequesterCardContext } from "./cards";

// The guest's scheduling cards (design decision 12; DESIGN.md: conversation
// card and proposal card): the meeting step (guest-flow-completion U9), the
// review of extracted details, the meeting details editor (opened in the
// thread with **Edit details**), the proposal awaiting agreement and the
// candidate times. Each posts one command with the expected
// revision and keeps its retry key until the service answers. A message in the
// conversation records none of these decisions.

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

function windowSummary(windows: readonly RequestWindow[], timeZone: string) {
  const groups: RequestWindow[][] = [];
  for (const window of windows) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const start = localParts(window.start, timeZone);
    const end = localParts(window.end, timeZone);
    const previousStart = previous && localParts(previous.start, timeZone);
    const previousEnd = previous && localParts(previous.end, timeZone);
    const nextDay = previousStart && Date.parse(`${start.date}T00:00:00Z`) - Date.parse(`${previousStart.date}T00:00:00Z`) === 86_400_000;
    if (group && previous && previousStart && previousEnd && nextDay && start.date === end.date && previousStart.date === previousEnd.date && clockOf(new Date(window.start), timeZone) === clockOf(new Date(previous.start), timeZone) && clockOf(new Date(window.end), timeZone) === clockOf(new Date(previous.end), timeZone)) {
      group.push(window);
    } else {
      groups.push([window]);
    }
  }
  return groups.map((group) => {
    const first = group[0]!;
    if (group.length === 1) return timeRange(first, timeZone);
    const last = group.at(-1)!;
    const from = displayTime(new Date(first.start), timeZone).split(", ")[0];
    const to = displayTime(new Date(last.start), timeZone).split(", ")[0];
    const start = localParts(first.start, timeZone).time;
    const end = localParts(first.end, timeZone).time;
    const offset = clockOf(new Date(first.start), timeZone).split(" ")[1];
    const hours = start === "00:00" && end === "23:59" ? "All day" : `${start}–${end}`;
    return `${from} – ${to} · ${hours} ${offset}`;
  });
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

function patchRows(patch: ReviewPatch, timeZone: string, preferenceTimezone = timeZone): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [];

  if (patch.purpose !== undefined) rows.push(["Purpose", patch.purpose]);
  if (patch.durationMinutes !== undefined && patch.durationMinutes !== null) rows.push(["Length", `${patch.durationMinutes} minutes`]);
  if (patch.mode) rows.push(["Mode", MODE_LABELS[patch.mode]]);
  if (patch.location) rows.push(["Place", patch.location]);
  if (patch.linkPlan) rows.push(["Meeting link", linkPlanText(patch.linkPlan)]);
  if (patch.travelMode) rows.push(["Your travel", TRAVEL_LABELS[patch.travelMode]]);
  if (patch.timezone) rows.push(["Your time zone", patch.timezone]);
  if (patch.windows) {
    rows.push([
      "Free times",
      <ul className="flex flex-col" key="windows">
        {windowSummary(patch.windows, timeZone).map((summary) => (
          <li key={summary}>{summary}</li>
        ))}
      </ul>,
    ]);
  }
  if (patch.preferredWindows) {
    rows.push(["Preferred times", patch.preferredWindows.length ? windowSummary(patch.preferredWindows, timeZone).join("; ") : "No preference"]);
  }
  if (patch.lessPreferredWindows) {
    rows.push(["Less preferred", patch.lessPreferredWindows.length ? windowSummary(patch.lessPreferredWindows, timeZone).join("; ") : "No less-preferred times"]);
  }
  if (patch.preferredWeeklyWindows !== undefined) {
    const groups = groupWindows(patch.preferredWeeklyWindows).filter((group) => group.ranges);
    rows.push(["Weekly preferences", groups.length ? `${groups.map((group) => `${group.days}: ${group.ranges}`).join("; ")} (${preferenceTimezone})` : "No preference"]);
  }
  if (patch.contactName !== undefined) rows.push(["Your name", patch.contactName || "(empty)"]);
  if (patch.contactEmail !== undefined) rows.push(["Your email", patch.contactEmail || "(empty)"]);

  return rows;
}

export function MeetingDetailsList({ patch, timeZone, contact, preferenceTimezone }: { readonly patch: ReviewPatch; readonly timeZone: string; readonly contact: RequesterCardContext["view"]["contact"]; readonly preferenceTimezone?: string }) {
  const rows = patchRows(patch, timeZone, preferenceTimezone);
  if (contact) {
    if (patch.contactName === undefined) rows.push(["Your name", contact.name]);
    if (patch.contactEmail === undefined) rows.push(["Your email", contact.email]);
  }
  return <DetailList rows={rows} />;
}

export function AppliedDetailsCard({ patch, timeZone, contact, preferenceTimezone, action }: { readonly patch: ReviewPatch; readonly timeZone: string; readonly contact: RequesterCardContext["view"]["contact"]; readonly preferenceTimezone?: string; readonly action?: ReactNode }) {
  return (
    <section aria-label="Applied meeting details" className={`flex min-w-0 flex-col gap-2 ${GUEST_CARD_SURFACE}`}>
      <h3 className="text-base font-semibold">Meeting details</h3>
      <MeetingDetailsList patch={patch} timeZone={timeZone} contact={contact} preferenceTimezone={preferenceTimezone} />
      {action}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Online or in person as two buttons (guest-flow-completion U22), like the host
// onboarding's mode step, when Thyme's question review asks missing_mode. A
// press answers in the conversation as the guest's own message, in the
// request's language, and Thyme carries on from it.

const MODE_ANSWERS: Readonly<Record<RequestLanguage, Readonly<Record<"online" | "in_person", string>>>> = {
  en: { in_person: "In person", online: "Online" },
  ko: { in_person: "대면", online: "온라인" },
};

export function ModeChoiceCard({
  context,
  onAnswer,
}: {
  readonly context: RequesterCardContext;
  readonly onAnswer: (text: string) => Promise<void>;
}) {
  const review = context.view.pendingReview!;
  const answers = MODE_ANSWERS[language(context)];
  const [busy, setBusy] = useState(false);

  async function answer(text: string) {
    setBusy(true);
    await onAnswer(text);
    setBusy(false);
  }

  return (
    <GuestCard id="mode-choice" label="Meeting" title={review.questions[review.clarifications.indexOf("missing_mode")] ?? "Online or in person?"}>
      <GuestCardActions>
        {(["online", "in_person"] as const).map((mode) => (
          <Button className="min-h-11" disabled={busy} key={mode} onClick={() => void answer(answers[mode])} type="button" variant="outline">
            {answers[mode]}
          </Button>
        ))}
      </GuestCardActions>
    </GuestCard>
  );
}

// ---------------------------------------------------------------------------
// Review extracted details: **Apply these details** and **Dismiss**

export function ReviewCard({ context }: { readonly context: RequesterCardContext }) {
  const review = context.view.pendingReview!;
  const { act, busy, error } = useAction(context);
  const canApply = review.patch !== null && review.clarifications.length === 0;
  const awaiting = context.view.request.state === "awaiting_host_approval";
  const patch = review.patch;
  const contact = context.view.contact;
  const rows = patch ? patchRows(patch, context.timezone, context.view.request.details.timezone) : [];
  if (patch && contact) {
    if (patch.contactName === undefined) rows.push(["Your name", contact.name]);
    if (patch.contactEmail === undefined) rows.push(["Your email", contact.email]);
  }

  // Applying details finds times for them at once (U13) when the meeting then
  // has its purpose, length and form; the assistant gathers them first.
  async function apply() {
    const applied = await act("request.apply_review", { reviewId: review.id });
    const { details, state } = context.view.request;
    const patch = review.patch ?? {};
    const ready =
      state !== "draft" &&
      Boolean((patch.purpose ?? details.purpose) && (patch.durationMinutes ?? details.durationMinutes) && (patch.mode ?? details.mode));
    if (applied.ok && ready) await act("request.evaluate", {}, null);
  }

  return (
    <GuestCard
      description={
        canApply
          ? "Review your contact details and Thyme's draft. Nothing changes until you apply it."
          : "Thyme needs one more detail before anything can change."
      }
      id="review"
      label="Review details"
      title={canApply ? "Apply these details?" : (review.questions[0] ?? "One more detail")}
    >
      {review.patch ? <DetailList rows={rows} /> : null}
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
            onClick={() => void apply()}
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

export function DetailsCard({ context }: { readonly context: RequesterCardContext }) {
  const id = useId();
  const { details } = context.view.request;
  const [purpose, setPurpose] = useState(details.purpose ?? "");
  const [duration, setDuration] = useState(details.durationMinutes ? String(details.durationMinutes) : "");
  const [mode, setMode] = useState<string>(details.mode ?? "");
  const [location, setLocation] = useState(details.location ?? "");
  const [link, setLink] = useState(details.linkPlan?.kind === "requester_link" ? details.linkPlan.url : "");
  const [travel, setTravel] = useState<string>(details.travelMode ?? "");
  const [windows, setWindows] = useState<WindowRow[]>(() => windowRows(details.windows, context.timezone));
  const [editingPreferences, setEditingPreferences] = useState(false);
  const { act, busy, error, setError } = useAction(context);

  if (editingPreferences) {
    return (
      <GuestCard id="meeting-details" label="Your preferences" title="Preferred weekly times">
        <p className="text-muted-foreground">Weekly preferences use {zoneLabel(details.timezone ?? context.timezone)}.</p>
        <WeeklyWindowsEditor
          initial={details.preferredWeeklyWindows ?? []}
          preferences
          onCancel={() => setEditingPreferences(false)}
          onSave={(preferredWeeklyWindows) => void (async () => {
            const outcome = await act("request.update_details", { details: { preferredWeeklyWindows }, timezone: context.timezone });
            if (outcome.ok) setEditingPreferences(false);
          })()}
          saving={busy}
        />
        <StatusLine message={error} />
      </GuestCard>
    );
  }

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
      context.closeDetails();
      return;
    }

    const outcome = await act("request.update_details", { details: changes, timezone: context.timezone });
    if (outcome.ok) context.closeDetails();
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
        <div className="flex flex-col gap-1">
          <span className="font-medium">Preferred weekly times</span>
          <p className="text-muted-foreground">{details.preferredWeeklyWindows?.length ? groupWindows(details.preferredWeeklyWindows).filter((group) => group.ranges).map((group) => `${group.days}: ${group.ranges}`).join("; ") : "No weekly preference set."}</p>
          <div><Button className="min-h-11" onClick={() => setEditingPreferences(true)} type="button" variant="outline">Edit weekly preferences</Button></div>
        </div>
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
          <Button className="min-h-11" onClick={() => context.closeDetails()} type="button" variant="outline">
            Cancel
          </Button>
        </GuestCardActions>
      </form>
      <StatusLine message={error} />
    </GuestCard>
  );
}

export function DetailsButton({ context, label = "Edit details" }: { readonly context: RequesterCardContext; readonly label?: string }) {
  return (
    <Button className="min-h-11" onClick={() => context.openDetails()} type="button" variant="ghost">
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Proposal: **Agree to this proposal**

export function ProposalCard({ context }: { readonly context: RequesterCardContext }) {
  const proposal = context.view.proposal!;
  const { act, busy, error, setError } = useAction(context);

  // The host's calendar is read again on agreement; a time that stopped fitting
  // records nothing and new times are found.
  async function agree() {
    const outcome = await act("request.agree", { version: proposal.version });
    if (outcome.ok && (outcome.result as { outcome?: string }).outcome === "time_unavailable") {
      setError("This time is no longer free on the host's calendar, so nothing was agreed. Choose another time.");
    }
  }
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
        <Button className="min-h-11" disabled={busy} onClick={() => void agree()} type="button">
          {busy ? "Agreeing..." : "Agree to this proposal"}
        </Button>
        <Button className="min-h-11" onClick={() => context.chooseAnotherTime()} type="button" variant="outline">
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

// What a search used, for Thyme's message: the
// guest's days and times, or the default span, with the meeting's length and
// form. A whole day shows as its date.
export function searchedFor(context: RequesterCardContext, found: boolean) {
  const { details } = context.view.request;
  const zone = context.timezone;
  const ko = language(context) === "ko";
  const days = (details.windows ?? []).map((window) => {
    const start = new Date(window.start);
    const end = new Date(window.end);
    const date = new Intl.DateTimeFormat(ko ? "ko-KR" : "en-GB", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(start);
    const wholeDay = end.getTime() - start.getTime() >= 23 * 60 * 60_000;
    if (wholeDay) return date;
    const clock = (instant: Date) => new Intl.DateTimeFormat(ko ? "ko-KR" : "en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
    return `${date} ${clock(start)}–${clock(end)}`;
  });
  if (ko) {
    const when = days.length ? `${days.join(", ")}을 기준으로` : `앞으로 2주 동안 ${context.view.host.displayName}님의 일정에 맞춰`;
    const length = details.durationMinutes ? `${details.durationMinutes}분 ` : "";
    const form = details.mode === "online" ? "온라인" : details.mode === "in_person" ? `대면${details.location ? ` (${details.location})` : ""}` : "";
    return `${when} ${length}${form} 미팅이 ${found ? "가능한 시간을 찾았어요" : "가능한지 확인했어요"}. 다른 날짜나 시간, 조건이 있으면 말씀해 주세요. 시간대는 ${zoneLabel(zone)}입니다.`;
  }
  const when = days.length ? days.join(", ") : `the next two weeks, within ${context.view.host.displayName}'s hours`;
  const form = details.mode === "online" ? "online" : details.mode === "in_person" ? `in-person${details.location ? ` at ${details.location}` : ""}` : "";
  const meeting = `${details.durationMinutes ? `${details.durationMinutes}-minute ` : ""}${form ? `${form} ` : ""}meeting`;
  return `${found ? "I found available times" : "I checked for times"} for a ${meeting} during ${when}. Tell me if you prefer other days, times or conditions. Times are in ${zoneLabel(zone)}.`;
}

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
    <li className="flex flex-col gap-2 rounded-xl bg-secondary p-3">
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
  ];
}

export function CandidatesCard({ context }: { readonly context: RequesterCardContext }) {
  const { evaluation, request } = context.view;
  const { act, busy, error } = useAction(context);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [tripRevealed, setTripRevealed] = useState<{ evaluationId: string; count: number } | null>(null);
  const missing = missingLabels(context);
  const lang = language(context);

  useEffect(() => setPage(0), [evaluation?.id]);

  useEffect(() => {
    if (evaluation?.state !== "pending") return;
    const timer = setInterval(() => void context.refresh(), 1500);
    return () => clearInterval(timer);
  }, [evaluation?.state, context.refresh]);

  const offeredCount = evaluation?.candidates.filter((candidate) => !candidate.unresolvedRequesterLeg).length ?? 0;

  const findTimes = async () => {
    setNotice(null);
    if ((page + 1) * TIMES_SHOWN < offeredCount) {
      setPage(page + 1);
      return;
    }
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
        className="mx-auto w-[94%] max-w-xl"
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
      <GuestCard className="mx-auto w-[94%] max-w-xl" id="candidates" label="Times" title="Finding times...">
        <p role="status">Checking both calendars. This takes a few seconds.</p>
      </GuestCard>
    );
  }

  const offered = evaluation.candidates.filter((candidate) => !candidate.unresolvedRequesterLeg);
  const trips = evaluation.candidates.filter((candidate) => candidate.unresolvedRequesterLeg);
  const tripVisibleCount = tripRevealed?.evaluationId === evaluation.id ? tripRevealed.count : Math.max(0, 5 - Math.min(offered.length, 5));
  const remainingTrips = Math.max(0, trips.length - tripVisibleCount);
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
      className="mx-auto w-[94%] max-w-xl"
      id="candidates"
      label="Times"
      title={offered.length > 0 ? "Choose a time" : trips.length > 0 ? "These times depend on your trip" : "No times found yet"}
    >
      {message ? <p>{message}</p> : null}
      {needsLink && offered.length > 0 ? <p>The host cannot create a Google Meet link, so add your own meeting link to choose a time.</p> : null}
      {offered.length > 0 ? (
        <ul aria-label="Candidate times" className="flex flex-col gap-2">
          {offered.slice(page * TIMES_SHOWN, (page + 1) * TIMES_SHOWN).map((candidate) => (
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary p-3" key={candidate.id}>
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
          {trips.slice(0, tripVisibleCount).map((candidate) => (
            <TripAllowance candidate={candidate} context={context} evaluationId={evaluation.id} key={candidate.id} />
          ))}
        </ul>
      ) : null}
      {remainingTrips > 0 ? <Button className="min-h-11 self-start" onClick={() => setTripRevealed({ evaluationId: evaluation.id, count: tripVisibleCount + 5 })} type="button" variant="outline">Show {Math.min(5, remainingTrips)} more trip-dependent times ({remainingTrips} remaining)</Button> : null}
      <GuestCardActions>
        {findButton("Find other times")}
        <DetailsButton context={context} label={needsLink ? "Add a meeting link" : "Edit details"} />
      </GuestCardActions>
      <StatusLine message={error ?? notice} tone={error ? "error" : "info"} />
    </GuestCard>
  );
}
