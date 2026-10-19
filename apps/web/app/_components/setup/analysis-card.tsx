"use client";

import type { AnalysisCard as AnalysisView, AnalysisEvidence } from "@lib/contracts/analysis";
import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CardActions, SetupCard } from "./card";
import { calendarErrorText, formatDay, loadTotals, topSlots, WEEKDAY_SHORT, weekdayCounts } from "./format";
import { useSetup } from "./setup-context";

// The analysis card (H5): which calendars and range are read, a pending state,
// then evidence in four dimensions with sample sizes, or the failed calendars
// with **Analyze again** and **Set up manually**. Evidence feeds suggestions only.

export const ANALYSIS_CARD_ID = "setup-analysis";

function rangeText(analysis: AnalysisView) {
  return `${formatDay(analysis.range.start)} – ${formatDay(analysis.range.end)}`;
}

export function AnalysisCard() {
  const { busy, run, state } = useSetup();
  const analysis = state.analysis;
  const pending = analysis?.state === "pending";
  const [open, setOpen] = useState(state.nextAction === "analyzing" || state.nextAction === "review_suggestions");

  const analyzeAgain = () => run(ANALYSIS_CARD_ID, [{ expectedRevision: null, input: {}, operation: "setup.analyze_again" }]);
  const setUpManually = () => run(ANALYSIS_CARD_ID, [{ expectedRevision: null, input: {}, operation: "setup.set_up_manually" }]);

  if (!analysis) {
    return state.analysisSkipped ? (
      <SetupCard eyebrow="Calendar analysis" id={ANALYSIS_CARD_ID} title="Setting up manually">
        <p>You chose to set up without a calendar analysis. Suggestions below are starter defaults.</p>
      </SetupCard>
    ) : null;
  }

  const calendars = analysis.calendars.map((calendar) => calendar.summary).join(", ");
  const failed = analysis.calendars.filter((calendar) => calendar.ok === false);

  return (
    <SetupCard
      eyebrow="Calendar analysis"
      id={ANALYSIS_CARD_ID}
      title={pending ? "Reading your calendars" : analysis.state === "failed" ? "Some calendars couldn't be read" : "What your calendar shows"}
      description={
        <>
          Reading <span className="text-foreground">{calendars || "your conflict calendars"}</span> over the past four weeks and
          the next four weeks ({rangeText(analysis)}).
        </>
      }
    >
      {pending ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2" role="status">
            <Spinner aria-hidden className="size-4" />
            This can take a minute.
          </p>
          {state.analysisSkipped ? (
            <p className="text-sm text-muted-foreground">
              You chose to set up manually, so the suggestions below don&apos;t wait for this scan.
            </p>
          ) : (
            <CardActions>
              <Button disabled={busy !== null} onClick={() => void setUpManually()} type="button" variant="outline">
                Set up manually
              </Button>
            </CardActions>
          )}
        </div>
      ) : analysis.state === "failed" ? (
        <div className="flex flex-col gap-3">
          <p role="status">
            {failed.length > 0 ? (
              <>
                Couldn&apos;t read <span className="font-medium">{failed.map((calendar) => calendar.summary).join(", ")}</span>.{" "}
              </>
            ) : null}
            {calendarErrorText(analysis.failureCategory) ?? "The scan didn't finish."} Nothing is assumed free because of it.
          </p>
          {state.analysisSkipped ? <p className="text-sm text-muted-foreground">You chose to set up manually.</p> : null}
          <CardActions>
            <Button disabled={busy !== null} onClick={() => void analyzeAgain()} type="button">
              {busy === ANALYSIS_CARD_ID ? "Working..." : "Analyze again"}
            </Button>
            {!state.analysisSkipped ? (
              <Button disabled={busy !== null} onClick={() => void setUpManually()} type="button" variant="outline">
                Set up manually
              </Button>
            ) : null}
          </CardActions>
        </div>
      ) : analysis.evidence ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">This is evidence for suggestions, never a rule: nothing changes until you choose.</p>
          <Button
            aria-expanded={open}
            className="self-start"
            onClick={() => setOpen((current) => !current)}
            type="button"
            variant="ghost"
          >
            <ChevronDownIcon aria-hidden className={cn("transition-transform", open ? "rotate-180" : undefined)} />
            {open ? "Hide evidence" : "Show evidence"}
          </Button>
          {open ? <Evidence evidence={analysis.evidence} /> : null}
          <CardActions>
            <Button disabled={busy !== null} onClick={() => void analyzeAgain()} type="button" variant="outline">
              {busy === ANALYSIS_CARD_ID ? "Working..." : "Analyze again"}
            </Button>
          </CardActions>
        </div>
      ) : null}
    </SetupCard>
  );
}

function Dimension({ children, sample, title }: { readonly children: ReactNode; readonly sample: string; readonly title: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="font-medium">{title}</h4>
        <span className="text-xs text-muted-foreground">{sample}</span>
      </div>
      {children}
    </div>
  );
}

function meetings(count: number) {
  return `${count} meeting${count === 1 ? "" : "s"}`;
}

function Evidence({ evidence }: { readonly evidence: AnalysisEvidence }) {
  const days = weekdayCounts(evidence.preferredTimes);
  const peak = Math.max(1, ...days.map((day) => day.count));
  const slots = topSlots(evidence.preferredTimes);
  const load = evidence.meetingLoad;
  const totals = loadTotals(load);

  return (
    <div className="grid min-w-0 gap-3">
      <Dimension sample={`From ${meetings(evidence.preferredTimes.sampleSize)}`} title="Preferred times">
        <ol aria-label="Meetings by weekday" className="grid grid-cols-7 gap-1">
          {days.map((day) => (
            <li className="flex min-w-0 flex-col items-center gap-1" key={day.weekday}>
              <span aria-hidden className="flex h-10 w-full items-end overflow-hidden rounded-sm bg-secondary">
                <span className="w-full rounded-sm bg-primary/70" style={{ height: `${(day.count / peak) * 100}%` }} />
              </span>
              <span className="text-xs text-muted-foreground">
                {WEEKDAY_SHORT[day.weekday]}
                <span className="sr-only">: {meetings(day.count)}</span>
              </span>
            </li>
          ))}
        </ol>
        {slots.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-sm tabular-nums">
            {slots.map((slot) => (
              <li key={slot.label}>
                <span className="font-medium">{slot.label}</span> — {meetings(slot.count)} ({slot.share}%)
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No counted meetings in this range.</p>
        )}
        <p className="text-xs text-muted-foreground">Start times in {evidence.timezone.replaceAll("_", " ")}.</p>
      </Dimension>

      <Dimension sample={`From ${meetings(load.sampleSize)} over ${load.weeks.length} week${load.weeks.length === 1 ? "" : "s"}`} title="Weekly meeting load">
        <p className="text-sm">
          {load.weeks.length > 0 ? (
            <>
              {load.min === load.max ? `${meetings(load.max)} a week` : `${load.min}–${load.max} meetings a week`}; {totals.internal} internal and{" "}
              {totals.external} external.
            </>
          ) : (
            "No weeks with counted meetings."
          )}
        </p>
      </Dimension>

      <NoteLikeEntries entries={evidence.noteLike.entries} />

      <Dimension sample={`From ${meetings(evidence.places.sampleSize)} in person`} title="Frequent places">
        {evidence.places.area || evidence.places.venue ? (
          <ul className="flex flex-col gap-0.5 text-sm">
            {evidence.places.area ? (
              <li>
                Area: <span className="font-medium">{evidence.places.area.name}</span> ({meetings(evidence.places.area.count)})
              </li>
            ) : null}
            {evidence.places.venue ? (
              <li>
                Venue: <span className="font-medium">{evidence.places.venue.name}</span> ({meetings(evidence.places.venue.count)})
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No in-person places found.</p>
        )}
        <p className="text-xs text-muted-foreground">Only you see this. Places are never published unless you choose them.</p>
      </Dimension>
    </div>
  );
}

// Note-like entries stay busy unless the host ticks one; each tick writes the
// whole exclusion list as the host's own choice.
function NoteLikeEntries({ entries }: { readonly entries: AnalysisEvidence["noteLike"]["entries"] }) {
  const { busy, run, state, timeZone } = useSetup();
  const excluded = state.fields.noteExclusions.proposed?.value ?? [];
  // The box shows the host's tick at once; the next state read settles it.
  const [ticking, setTicking] = useState<{ readonly id: string; readonly checked: boolean } | null>(null);
  const isExcluded = (entry: (typeof entries)[number]) =>
    excluded.some((item) => item.calendarId === entry.calendarId && item.eventId === entry.eventId);

  const toggle = (entry: (typeof entries)[number], exclude: boolean) => {
    const next = exclude
      ? [...excluded, { calendarId: entry.calendarId, eventId: entry.eventId, fingerprint: entry.fingerprint }]
      : excluded.filter((item) => !(item.calendarId === entry.calendarId && item.eventId === entry.eventId));
    setTicking({ checked: exclude, id: `${entry.calendarId}/${entry.eventId}` });
    void run(ANALYSIS_CARD_ID, [
      {
        expectedRevision: state.draft.revision,
        input: { action: "choose_own", browserTimeZone: timeZone, field: "noteExclusions", value: next },
        operation: "setup.update_draft",
      },
    ]).finally(() => setTicking(null));
  };

  return (
    <Dimension sample={`${entries.length} entr${entries.length === 1 ? "y" : "ies"}`} title="Entries that look like notes">
      {entries.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">These have no other attendee, place or link. They stay busy unless you exclude them.</p>
          <ul className="flex flex-col divide-y divide-border">
            {entries.map((entry) => {
              const key = `${entry.calendarId}/${entry.eventId}`;
              const checked = ticking?.id === key ? ticking.checked : isExcluded(entry);
              const id = `note-${entry.calendarId}-${entry.eventId}`;
              return (
                <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3" key={id}>
                  <span className="min-w-0">
                    <span className="block font-medium break-words">{entry.title || "Untitled entry"}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDay(entry.start)}
                      {entry.allDay ? " · all day" : null}
                    </span>
                  </span>
                  <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm" htmlFor={id}>
                    <input
                      aria-label={`Exclude from busy time: ${entry.title || "Untitled entry"}`}
                      checked={checked}
                      className="size-5 accent-primary"
                      disabled={busy !== null}
                      id={id}
                      onChange={(event) => toggle(entry, event.target.checked)}
                      type="checkbox"
                    />
                    Exclude from busy time
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">None found.</p>
      )}
    </Dimension>
  );
}
