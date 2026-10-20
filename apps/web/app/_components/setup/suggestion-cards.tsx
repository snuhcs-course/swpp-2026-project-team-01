"use client";

import type { AnalysisEvidence } from "@lib/contracts/analysis";
import type { SetupFieldName, SetupFieldValue, WeeklyWindow } from "@lib/contracts/setup";
import { SearchIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { CardActions, EditorForm, focusTrigger, QuietButton, revealCard, SourceBadge } from "./card";
import { describeLimit, formatDay, formatMinutes, groupWindows, loadTotals, parseMinutes, topSlots } from "./format";
import { type SetupStep, useSetup, useStepper } from "./setup-context";
import { StepCard } from "./step-card";
import { STEP_CARD_IDS, type StepId } from "./steps";
import { TimezoneEditor } from "./timezone-editor";
import { WeeklyWindowsEditor } from "./weekly-windows-editor";

// Suggestion steps (H6): one question per card with the proposed value, its
// source badge and one-line reason, and **Use this**, **Adjust** or **Choose my
// own**, plus a quiet **Skip for now**. Use this accepts the value the card
// shows: the server saves its own current value and only checks that it is still
// the one shown. Adjust and Choose my own save the host's own value. A saved step
// collapses into a receipt and hands over to the next open one; an answered step
// asked again with Edit offers **Keep this**, which leaves it as it was.

type EditorMode = "adjust" | "own";
type Values = Partial<{ [F in SetupFieldName]: SetupFieldValue<F> }>;

export type EditorProps = {
  readonly mode: EditorMode;
  readonly onCancel: () => void;
  readonly onSave: (values: Values) => void;
  readonly saving: boolean;
};

// A starter value offered as a Suggestion chip, saved as the host's own choice.
type QuickValue = { readonly label: string; readonly values: Values };

function SuggestionStep({
  editor,
  extra,
  fields,
  quick,
  scrollEditor = false,
  step,
  title,
  value,
}: {
  readonly editor: (props: EditorProps) => ReactNode;
  // Shown under the value, such as the "What I found" disclosure.
  readonly extra?: ReactNode;
  readonly fields: readonly SetupFieldName[];
  readonly quick?: readonly QuickValue[];
  // The editor is long and scrolls inside the card with its actions in view.
  readonly scrollEditor?: boolean;
  readonly step: StepId;
  readonly title: string;
  readonly value: ReactNode;
}) {
  const { busy, run, state } = useSetup();
  const stepper = useStepper();
  const id = STEP_CARD_IDS[step];
  const views = fields.map((field) => ({ field, view: state.fields[field] }));
  const accepted = views.every(({ view }) => view.proposed?.accepted);
  const canUseThis = views.every(({ view }) => view.proposed);
  const [editing, setEditing] = useState<{ mode: EditorMode; trigger: string } | null>(null);
  const saving = busy === id;
  const disabled = busy !== null;

  const close = () => {
    const trigger = editing?.trigger ?? "adjust";
    setEditing(null);
    focusTrigger(id, trigger, "adjust");
  };

  const save = async (mode: EditorMode, values: Values) => {
    const steps: SetupStep[] = fields.map((field, index) => ({
      expectedRevision: index === 0 ? state.draft.revision : "previous",
      input: { action: mode === "own" ? "choose_own" : "adjust", field, value: values[field] },
      operation: "setup.update_draft",
    }));

    if (await run(id, steps)) {
      setEditing(null);
      stepper.saved();
    }
  };

  // Accepts each shown, unaccepted value; a value that changed since this card
  // rendered is refused as stale and the card reloads.
  const useThis = async () => {
    const pending = views.filter(({ view }) => view.proposed && !view.proposed.accepted);
    const steps: SetupStep[] = pending.map(({ field, view }, index) => ({
      expectedRevision: index === 0 ? state.draft.revision : "previous",
      input: { action: "use_suggestion", field, shown: view.proposed!.value },
      operation: "setup.update_draft",
    }));

    if (await run(id, steps)) stepper.saved();
  };

  // A chip saves its values as the host's own and accepts the group's other
  // shown values, so the step is done in one press.
  const pick = async (values: Values) => {
    const steps: SetupStep[] = [];
    for (const { field, view } of views) {
      if (field in values) {
        steps.push({ expectedRevision: "previous", input: { action: "choose_own", field, value: values[field] }, operation: "setup.update_draft" });
      } else if (view.proposed && !view.proposed.accepted) {
        steps.push({ expectedRevision: "previous", input: { action: "use_suggestion", field, shown: view.proposed.value }, operation: "setup.update_draft" });
      }
    }
    const chained = steps.map((entry, index) => (index === 0 ? { ...entry, expectedRevision: state.draft.revision } : entry));
    if (chained.length > 0 && (await run(id, chained))) stepper.saved();
  };

  return (
    <StepCard scroll={Boolean(editing) && scrollEditor} step={step} title={title}>
      {editing ? (
        editor({ mode: editing.mode, onCancel: close, onSave: (values) => void save(editing.mode, values), saving })
      ) : (
        <>
          {value}
          {quick && quick.length > 0 ? (
            <div aria-label="Quick answers" className="scroll-fade-x flex gap-2 overflow-x-auto overscroll-x-contain no-scrollbar" role="group">
              {quick.map((option) => (
                <Button
                  className="shrink-0 rounded-full"
                  disabled={disabled}
                  key={option.label}
                  onClick={() => void pick(option.values)}
                  type="button"
                  variant="outline"
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}
          {extra}
          <CardActions>
            {accepted ? (
              <Button data-trigger="keep" disabled={disabled} onClick={stepper.forward} type="button">
                Keep this
              </Button>
            ) : canUseThis ? (
              <Button data-trigger="use" disabled={disabled} onClick={() => void useThis()} type="button">
                {saving ? "Saving..." : "Use this"}
              </Button>
            ) : null}
            <Button
              data-trigger="adjust"
              disabled={disabled}
              onClick={() => {
                setEditing({ mode: "adjust", trigger: "adjust" });
                revealCard(id);
              }}
              type="button"
              variant="outline"
            >
              Adjust
            </Button>
            <QuietButton data-trigger="own" disabled={disabled} onClick={() => {
                setEditing({ mode: "own", trigger: "own" });
                revealCard(id);
              }}>
              Choose my own
            </QuietButton>
            {!accepted ? (
              <QuietButton className="ml-auto" disabled={disabled} onClick={stepper.skip}>
                Skip for now
              </QuietButton>
            ) : null}
          </CardActions>
        </>
      )}
    </StepCard>
  );
}

// A proposed value's source badge and its one-line reason.
export function Provenance({ field }: { readonly field: SetupFieldName }) {
  const { state } = useSetup();
  const proposed = state.fields[field].proposed;
  if (!proposed) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <SourceBadge sampleSize={proposed.sampleSize} source={proposed.source} />
      {proposed.reason ? <p className="min-w-0 text-sm text-muted-foreground">{proposed.reason}</p> : null}
    </div>
  );
}

function ValueText({ children }: { readonly children: ReactNode }) {
  return <p className="text-base font-medium break-words">{children}</p>;
}

// The week in grouped lines, as "Mon–Fri 10:00 – 17:00".
export function WeeklySummary({ windows }: { readonly windows: readonly WeeklyWindow[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm tabular-nums">
      {groupWindows(windows).map((group) => (
        <div className="contents" key={group.days}>
          <dt className="font-medium">{group.days}</dt>
          <dd className={group.ranges ? "break-words" : "text-muted-foreground"}>{group.ranges ?? "Unavailable"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TimezoneStep() {
  const { state } = useSetup();
  const zone = state.fields.timezone.proposed?.value ?? null;

  return (
    <SuggestionStep
      editor={({ mode, onCancel, onSave, saving }) => (
        <TimezoneEditor
          initial={mode === "adjust" ? zone : null}
          onCancel={onCancel}
          onSave={(timezone) => onSave({ timezone })}
          saving={saving}
        />
      )}
      extra={<WhatIFound />}
      fields={["timezone"]}
      step="timezone"
      title="Which time zone do you meet in?"
      value={
        <div className="flex flex-col gap-1.5">
          <ValueText>{zone?.replaceAll("_", " ") ?? "Not set"}</ValueText>
          <Provenance field="timezone" />
        </div>
      }
    />
  );
}

export function WeeklyWindowsStep() {
  const { state } = useSetup();
  const windows = state.fields.weeklyWindows.proposed?.value ?? null;

  return (
    <SuggestionStep
      editor={({ mode, onCancel, onSave, saving }) => (
        <WeeklyWindowsEditor
          initial={mode === "adjust" ? windows : null}
          onCancel={onCancel}
          onSave={(weeklyWindows) => onSave({ weeklyWindows })}
          saving={saving}
        />
      )}
      fields={["weeklyWindows"]}
      scrollEditor
      step="windows"
      title="When can people book you?"
      value={
        <div className="flex flex-col gap-1.5">
          {windows ? <WeeklySummary windows={windows} /> : <p className="text-muted-foreground">No windows yet.</p>}
          <Provenance field="weeklyWindows" />
        </div>
      }
    />
  );
}

export function WeeklyLimitStep() {
  const { state } = useSetup();
  const limit = state.fields.weeklyLimit.proposed;

  return (
    <SuggestionStep
      editor={({ mode, onCancel, onSave, saving }) => (
        <LimitEditor
          initial={mode === "adjust" ? (limit?.value ?? null) : undefined}
          onCancel={onCancel}
          onSave={(weeklyLimit) => onSave({ weeklyLimit })}
          saving={saving}
        />
      )}
      fields={["weeklyLimit"]}
      quick={[
        { label: "No limit", values: { weeklyLimit: null } },
        { label: "5 a week", values: { weeklyLimit: 5 } },
        { label: "10 a week", values: { weeklyLimit: 10 } },
        { label: "15 a week", values: { weeklyLimit: 15 } },
      ]}
      step="limit"
      title="How many meetings a week, at most?"
      value={
        <div className="flex flex-col gap-1.5">
          <ValueText>{limit ? describeLimit(limit.value) : "Not set"}</ValueText>
          <Provenance field="weeklyLimit" />
        </div>
      }
    />
  );
}

const DURATION_FIELDS = ["durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes"] as const;

export function DurationStep() {
  const { state } = useSetup();
  const proposed = DURATION_FIELDS.map((field) => state.fields[field].proposed);
  const [duration, before, after] = proposed.map((entry) => entry?.value);
  const describe = (value: number | undefined) => (value === undefined ? "not set" : formatMinutes(value));
  // One badge when the three share a source, else one per value.
  const sameSource = proposed.every((entry) => entry?.source === proposed[0]?.source);

  return (
    <SuggestionStep
      editor={({ mode, onCancel, onSave, saving }) => (
        <DurationEditor
          initial={mode === "adjust" ? { after, before, duration } : null}
          onCancel={onCancel}
          onSave={(values) =>
            onSave({ bufferAfterMinutes: values.after, bufferBeforeMinutes: values.before, durationMinutes: values.duration })
          }
          saving={saving}
        />
      )}
      fields={DURATION_FIELDS}
      quick={[15, 30, 45, 60].map((minutes) => ({ label: `${minutes} min`, values: { durationMinutes: minutes } }))}
      step="duration"
      title="How long are meetings, with what buffers?"
      value={
        <div className="flex flex-col gap-1.5">
          <p className="flex flex-wrap items-baseline gap-x-2 text-base font-medium">
            <span>{duration === undefined ? "Not set" : `${formatMinutes(duration)} meetings`}</span>
            <span className="text-sm font-normal text-muted-foreground">
              <span>{describe(before)} before</span>
              <span aria-hidden> · </span>
              <span className="sr-only">, </span>
              <span>{describe(after)} after</span>
            </span>
          </p>
          {sameSource ? (
            <Provenance field="durationMinutes" />
          ) : (
            <ul className="flex flex-col gap-1">
              {(
                [
                  ["Length", "durationMinutes"],
                  ["Before", "bufferBeforeMinutes"],
                  ["After", "bufferAfterMinutes"],
                ] as const
              ).map(([label, field]) => (
                <li className="flex min-w-0 items-center gap-2" key={field}>
                  <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
                  <Provenance field={field} />
                </li>
              ))}
            </ul>
          )}
        </div>
      }
    />
  );
}

export function TravelBufferStep() {
  const { state } = useSetup();
  const minutes = state.fields.travelBufferMinutes.proposed?.value;

  return (
    <SuggestionStep
      editor={({ mode, onCancel, onSave, saving }) => (
        <SingleMinutesEditor
          hint="Added before and after an in-person meeting, 0 to 180 minutes."
          initial={mode === "adjust" ? minutes : undefined}
          label="Extra travel time"
          max={180}
          onCancel={onCancel}
          onSave={(travelBufferMinutes) => onSave({ travelBufferMinutes })}
          saving={saving}
          submit="Save travel buffer"
        />
      )}
      fields={["travelBufferMinutes"]}
      quick={[0, 15, 30, 45].map((minutes) => ({ label: minutes === 0 ? "None" : `${minutes} min`, values: { travelBufferMinutes: minutes } }))}
      step="travelBuffer"
      title="How much extra time should I leave around travel?"
      value={
        <div className="flex flex-col gap-1.5">
          <ValueText>{minutes === undefined ? "Not set" : `${formatMinutes(minutes)} around travel`}</ValueText>
          <Provenance field="travelBufferMinutes" />
        </div>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// What the scan found, folded away in the first step as a Trace step

function meetings(count: number) {
  return `${count} meeting${count === 1 ? "" : "s"}`;
}

export function WhatIFound() {
  const { busy, run, state } = useSetup();
  const analysis = state.analysis;
  if (analysis?.state !== "completed" || !analysis.evidence) return null;

  const calendars = analysis.calendars.map((calendar) => calendar.summary).join(", ");

  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger className="min-h-9">
          <TraceLine>
            <TraceIcon>
              <SearchIcon />
            </TraceIcon>
            <TraceTitle>What I found</TraceTitle>
            <TraceDescription>{meetings(analysis.evidence.preferredTimes.sampleSize)}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <EvidenceList evidence={analysis.evidence} />
          <p className="text-xs">
            From {calendars || "your conflict calendars"}, {formatDay(analysis.range.start)} – {formatDay(analysis.range.end)}.
            Only you see this; it suggests, never decides.
          </p>
          <QuietButton
            className="-ml-2 self-start"
            disabled={busy !== null}
            onClick={() => void run(STEP_CARD_IDS.timezone, [{ expectedRevision: null, input: {}, operation: "setup.analyze_again" }])}
          >
            Analyze again
          </QuietButton>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function EvidenceList({ evidence }: { readonly evidence: AnalysisEvidence }) {
  const slots = topSlots(evidence.preferredTimes, 2);
  const load = evidence.meetingLoad;
  const totals = loadTotals(load);
  const notes = evidence.noteLike.entries.length;
  const places = evidence.places;

  const rows: [string, ReactNode][] = [
    [
      "Busiest times",
      slots.length > 0 ? `${slots.map((slot) => slot.label).join(", ")} · ${meetings(evidence.preferredTimes.sampleSize)}` : "None counted",
    ],
    [
      "Weekly load",
      load.weeks.length > 0
        ? `${load.min === load.max ? load.max : `${load.min}–${load.max}`} a week · ${totals.internal} internal, ${totals.external} external`
        : "None counted",
    ],
    ["Note-like entries", notes > 0 ? `${notes} found` : "None found"],
    [
      "Places",
      places.area || places.venue ? (
        <>
          {places.area ? <span>{places.area.name}</span> : null}
          {places.area && places.venue ? <span aria-hidden> · </span> : null}
          {places.venue ? <span>{places.venue.name}</span> : null}
          <span className="text-muted-foreground"> ({meetings(places.sampleSize)})</span>
        </>
      ) : (
        "None found"
      ),
    ],
  ];

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
      {rows.map(([label, value]) => (
        <div className="contents" key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Editors

export function MinutesInput({
  describedBy,
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  readonly describedBy?: string;
  readonly id: string;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: string) => void;
  readonly step?: number;
  readonly value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          aria-describedby={describedBy}
          className="h-11 w-24 bg-card text-base tabular-nums md:text-base"
          id={id}
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => onChange(event.target.value)}
          step={step}
          type="number"
          value={value}
        />
        <span className="text-sm text-muted-foreground">min</span>
      </div>
    </div>
  );
}

function EditorActions({
  disabled,
  onCancel,
  onSubmit,
  saving,
  submit,
}: {
  readonly disabled: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
  readonly saving: boolean;
  readonly submit: string;
}) {
  return (
    <CardActions>
      <Button disabled={disabled || saving} onClick={onSubmit} type="button">
        {saving ? "Saving..." : submit}
      </Button>
      <Button onClick={onCancel} type="button" variant="outline">
        Cancel
      </Button>
    </CardActions>
  );
}

function DurationEditor({
  initial,
  onCancel,
  onSave,
  saving,
}: {
  readonly initial: { duration?: number; before?: number; after?: number } | null;
  readonly onCancel: () => void;
  readonly onSave: (values: { duration: number; before: number; after: number }) => void;
  readonly saving: boolean;
}) {
  const [duration, setDuration] = useState(initial?.duration?.toString() ?? "");
  const [before, setBefore] = useState(initial?.before?.toString() ?? "");
  const [after, setAfter] = useState(initial?.after?.toString() ?? "");
  const id = useId();
  const parsed = {
    after: parseMinutes(after, 0, 120),
    before: parseMinutes(before, 0, 120),
    duration: parseMinutes(duration, 15, 240, 5),
  };
  const valid = parsed.duration !== null && parsed.before !== null && parsed.after !== null;
  const submit = () => {
    if (valid) onSave(parsed as { duration: number; before: number; after: number });
  };

  return (
    <EditorForm label="Edit meeting length and buffers" onSubmit={submit}>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <MinutesInput describedBy={`${id}-hint`} id={`${id}-duration`} label="Meeting length" max={240} min={15} onChange={setDuration} step={5} value={duration} />
        <MinutesInput describedBy={`${id}-hint`} id={`${id}-before`} label="Buffer before" max={120} min={0} onChange={setBefore} value={before} />
        <MinutesInput describedBy={`${id}-hint`} id={`${id}-after`} label="Buffer after" max={120} min={0} onChange={setAfter} value={after} />
      </div>
      <p className="text-sm text-muted-foreground" id={`${id}-hint`}>
        Meetings run 15–240 minutes in steps of 5; buffers 0–120.
      </p>
      <EditorActions disabled={!valid} onCancel={onCancel} onSubmit={submit} saving={saving} submit="Save length and buffers" />
    </EditorForm>
  );
}

// `initial` undefined opens the editor neutral (Choose my own).
function LimitEditor({
  initial,
  onCancel,
  onSave,
  saving,
}: {
  readonly initial: number | null | undefined;
  readonly onCancel: () => void;
  readonly onSave: (limit: number | null) => void;
  readonly saving: boolean;
}) {
  const [noLimit, setNoLimit] = useState(initial === null);
  const [raw, setRaw] = useState(typeof initial === "number" ? String(initial) : "");
  const id = useId();
  const limit = parseMinutes(raw, 1, 50);
  const valid = noLimit || limit !== null;
  const submit = () => {
    if (valid) onSave(noLimit ? null : limit);
  };

  return (
    <EditorForm label="Edit weekly meeting limit" onSubmit={submit}>
      <label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-none`}>
        <input
          checked={noLimit}
          className="size-5 accent-primary"
          id={`${id}-none`}
          onChange={(event) => setNoLimit(event.target.checked)}
          type="checkbox"
        />
        No weekly limit
      </label>
      {!noLimit ? (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor={`${id}-limit`}>
            Meetings per week, at most (1–50)
          </label>
          <Input
            className="h-11 w-24 bg-card text-base tabular-nums md:text-base"
            id={`${id}-limit`}
            inputMode="numeric"
            max={50}
            min={1}
            onChange={(event) => setRaw(event.target.value)}
            type="number"
            value={raw}
          />
        </div>
      ) : null}
      <EditorActions disabled={!valid} onCancel={onCancel} onSubmit={submit} saving={saving} submit="Save limit" />
    </EditorForm>
  );
}

function SingleMinutesEditor({
  hint,
  initial,
  label,
  max,
  onCancel,
  onSave,
  saving,
  submit,
}: {
  readonly hint: string;
  readonly initial: number | undefined;
  readonly label: string;
  readonly max: number;
  readonly onCancel: () => void;
  readonly onSave: (minutes: number) => void;
  readonly saving: boolean;
  readonly submit: string;
}) {
  const [raw, setRaw] = useState(initial === undefined ? "" : String(initial));
  const id = useId();
  const minutes = parseMinutes(raw, 0, max);
  const save = () => {
    if (minutes !== null) onSave(minutes);
  };

  return (
    <EditorForm label={submit} onSubmit={save}>
      <MinutesInput describedBy={`${id}-hint`} id={id} label={label} max={max} min={0} onChange={setRaw} value={raw} />
      <p className="text-sm text-muted-foreground" id={`${id}-hint`}>
        {hint}
      </p>
      <EditorActions disabled={minutes === null} onCancel={onCancel} onSubmit={save} saving={saving} submit={submit} />
    </EditorForm>
  );
}
