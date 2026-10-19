"use client";

import type { AnalysisCard as AnalysisView } from "@lib/contracts/analysis";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { QuestionnaireChoice, QuestionnaireChoices } from "@/components/ui/questionnaire";
import { CardActions, QuietButton, SetupCard } from "./card";
import { calendarErrorText, formatDay } from "./format";
import { Provenance } from "./suggestion-cards";
import { useSetup, useStepper } from "./setup-context";
import { StepCard } from "./step-card";
import { noteEntries, STEP_CARD_IDS } from "./steps";

// The scan (H5): while it runs, one compact card names the calendars and range
// with a spinner; a failed or partial scan is one compact card with **Analyze
// again** and **Set up manually**. A completed scan has no card of its own: each
// suggestion carries its evidence, and the note-like entries it found get a step.

export const ANALYSIS_CARD_ID = "setup-analysis";

function rangeText(analysis: AnalysisView) {
  return `${formatDay(analysis.range.start)} – ${formatDay(analysis.range.end)}`;
}

// A scan that needs the host: failed, or finished without reading every calendar,
// and not yet set aside with Set up manually.
export function scanNeedsHost(state: ReturnType<typeof useSetup>["state"]) {
  const analysis = state.analysis;
  if (!analysis || state.analysisSkipped) return false;
  return analysis.state === "failed" || (analysis.state === "completed" && analysis.calendars.some((calendar) => calendar.ok === false));
}

export function AnalysisCard() {
  const { busy, run, state } = useSetup();
  const analysis = state.analysis;

  if (!analysis) return null;

  const analyzeAgain = () => run(ANALYSIS_CARD_ID, [{ expectedRevision: null, input: {}, operation: "setup.analyze_again" }]);
  const setUpManually = () => run(ANALYSIS_CARD_ID, [{ expectedRevision: null, input: {}, operation: "setup.set_up_manually" }]);
  const calendars = analysis.calendars.map((calendar) => calendar.summary).join(", ") || "your conflict calendars";
  const failed = analysis.calendars.filter((calendar) => calendar.ok === false);

  if (analysis.state === "pending") {
    return (
      <SetupCard
        description={
          <>
            <span className="text-foreground">{calendars}</span> · {rangeText(analysis)}
          </>
        }
        id={ANALYSIS_CARD_ID}
        label="Calendar scan"
        title="Reading your calendars"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status">
            <span className="shimmer text-muted-foreground motion-reduce:shimmer-none">This can take a minute.</span>
          </p>
          <QuietButton disabled={busy !== null} onClick={() => void setUpManually()}>
            Set up manually
          </QuietButton>
        </div>
      </SetupCard>
    );
  }

  return (
    <SetupCard id={ANALYSIS_CARD_ID} label="Calendar scan" title="Some calendars couldn't be read">
      <p role="status">
        {failed.length > 0 ? (
          <>
            Couldn&apos;t read <span className="font-medium">{failed.map((calendar) => calendar.summary).join(", ")}</span>.{" "}
          </>
        ) : null}
        {analysis.state === "failed" ? (calendarErrorText(analysis.failureCategory) ?? "The scan didn't finish.") : null} Nothing is
        assumed free because of it.
      </p>
      <CardActions>
        <Button disabled={busy !== null} onClick={() => void analyzeAgain()} type="button">
          {busy === ANALYSIS_CARD_ID ? "Working..." : "Analyze again"}
        </Button>
        <Button disabled={busy !== null} onClick={() => void setUpManually()} type="button" variant="outline">
          Set up manually
        </Button>
      </CardActions>
    </SetupCard>
  );
}

// The note-like entries a scan found. They stay busy unless the host ticks one;
// Save writes the whole exclusion list as the host's own choice.
export function NotesStep() {
  const { busy, run, state } = useSetup();
  const stepper = useStepper();
  const id = STEP_CARD_IDS.notes;
  const entries = noteEntries(state);
  const proposed = state.fields.noteExclusions.proposed;
  const key = (entry: { calendarId: string; eventId: string }) => `${entry.calendarId}/${entry.eventId}`;
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set((proposed?.value ?? []).map(key)));
  const disabled = busy !== null;

  const save = async () => {
    const value = entries
      .filter((entry) => ticked.has(key(entry)))
      .map((entry) => ({ calendarId: entry.calendarId, eventId: entry.eventId, fingerprint: entry.fingerprint }));
    const saved = await run(id, [
      {
        expectedRevision: state.draft.revision,
        input: { action: "choose_own", field: "noteExclusions", value },
        operation: "setup.update_draft",
      },
    ]);
    if (saved) stepper.saved();
  };

  return (
    <StepCard
      description="No other attendee, place or link. They stay busy unless you tick them."
      multiple
      step="notes"
      title="Should any of these entries leave you free?"
    >
      <QuestionnaireChoices className="max-h-52 gap-1.5 overflow-y-auto">
        {entries.map((entry) => {
          const entryKey = key(entry);
          const title = entry.title || "Untitled entry";
          return (
            <QuestionnaireChoice
              checked={ticked.has(entryKey)}
              className="min-h-11 items-center rounded-lg px-3 py-2"
              disabled={disabled}
              key={entryKey}
              onChange={(event) =>
                setTicked((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(entryKey);
                  else next.delete(entryKey);
                  return next;
                })
              }
              value={entryKey}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="sr-only">Exclude from busy time: </span>
                <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDay(entry.start)}
                  {entry.allDay ? " · all day" : null}
                </span>
              </span>
            </QuestionnaireChoice>
          );
        })}
      </QuestionnaireChoices>
      <Provenance field="noteExclusions" />
      <CardActions>
        <Button data-trigger="use" disabled={disabled} onClick={() => void save()} type="button">
          {busy === id ? "Saving..." : ticked.size === 0 ? "Keep all busy" : `Free ${ticked.size} entr${ticked.size === 1 ? "y" : "ies"}`}
        </Button>
        {proposed?.accepted ? null : (
          <QuietButton className="ml-auto" disabled={disabled} onClick={stepper.skip}>
            Skip for now
          </QuietButton>
        )}
      </CardActions>
    </StepCard>
  );
}
