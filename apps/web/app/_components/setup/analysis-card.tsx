"use client";

import type { AnalysisCard as AnalysisView } from "@lib/contracts/analysis";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CardActions, QuietButton, SetupCard } from "./card";
import { calendarErrorText, formatDay } from "./format";
import { useSetup, useStepper } from "./setup-context";
import { StepCard } from "./step-card";
import { STEP_CARD_IDS } from "./steps";
import { LOCALE_COOKIE, type Locale, localeOf } from "../ink/copy";
import { NOTE_REVIEW_COPY } from "../notes/note-review-copy";
import { NoteReviewPanel } from "../notes/note-review-panel";

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

// The note candidates a scan found, in the standalone note review
// (calendar-note-review design 7): rows the classifier recommends as notes start
// ticked, and 확인 records the host's decisions, which free time only once Google
// Calendar is updated. The step is then answered as the host's own choice; the
// decisions, not the draft's exclusion list, carry the effect.
export function NotesStep() {
  const { run, state } = useSetup();
  const stepper = useStepper();
  const locale = useLocaleCookie();
  const proposed = state.fields.noteExclusions.proposed;

  const answered = async () => {
    const saved = await run(STEP_CARD_IDS.notes, [
      {
        expectedRevision: state.draft.revision,
        input: { action: "choose_own", field: "noteExclusions", value: proposed?.value ?? [] },
        operation: "setup.update_draft",
      },
    ]);
    if (saved) stepper.saved();
  };

  return (
    <StepCard multiple step="notes" title={NOTE_REVIEW_COPY[locale].title}>
      <div className="max-h-[min(60dvh,32rem)] overflow-y-auto">
        <NoteReviewPanel locale={locale} onConfirmed={answered} />
      </div>
    </StepCard>
  );
}

// The page language from the `lang` cookie, read after hydration so the server
// and the first client render agree.
function useLocaleCookie(): Locale {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    setLocale(localeOf(document.cookie.split("; ").find((pair) => pair.startsWith(`${LOCALE_COOKIE}=`))?.slice(LOCALE_COOKIE.length + 1)));
  }, []);
  return locale;
}
