"use client";

import type { SetupFieldName, SetupFieldValue, WeeklyWindow } from "@lib/contracts/setup";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardActions, focusTrigger, SetupCard, SourceBadge } from "./card";
import { describeLimit, formatMinutes, parseMinutes, summarizeWindows, weeklyPreview } from "./format";
import { type SetupStep, useSetup } from "./setup-context";
import { TimezoneEditor } from "./timezone-editor";
import { WeeklyWindowsEditor } from "./weekly-windows-editor";

// Suggestion cards (H6): one compact card per field group with the proposed
// value, its source badge and reason, and **Use this**, **Adjust** or **Choose my
// own**. Use this accepts the value the card shows, a suggestion or the
// assistant's draft: the server saves its own current value and only checks that
// it is still the one shown. Adjust and Choose my own save the host's own value.
// Accepted groups collapse to one line with **Edit**.

type EditorMode = "adjust" | "own";
type Values = Partial<{ [F in SetupFieldName]: SetupFieldValue<F> }>;

export const SUGGESTION_CARD_IDS = {
  duration: "setup-duration",
  limit: "setup-limit",
  timezone: "setup-timezone",
  windows: "setup-windows",
} as const;

function useFieldGroup(fields: readonly SetupFieldName[]) {
  const { state } = useSetup();
  const views = fields.map((field) => ({ field, view: state.fields[field] }));
  return {
    accepted: views.every(({ view }) => view.proposed?.accepted),
    views,
  };
}

function SuggestionCard({
  editor,
  eyebrow = "Preferences",
  fields,
  id,
  summary,
  title,
  value,
}: {
  readonly editor: (props: {
    readonly mode: EditorMode;
    readonly onCancel: () => void;
    readonly onSave: (values: Values) => void;
    readonly saving: boolean;
  }) => ReactNode;
  readonly eyebrow?: string;
  readonly fields: readonly SetupFieldName[];
  readonly id: string;
  readonly summary: string;
  readonly title: string;
  readonly value: ReactNode;
}) {
  const { busy, run, state } = useSetup();
  const { accepted, views } = useFieldGroup(fields);
  const [editing, setEditing] = useState<{ mode: EditorMode; trigger: string } | null>(null);
  const saving = busy === id;
  const disabled = busy !== null;

  const open = (mode: EditorMode, trigger: string) => setEditing({ mode, trigger });

  // Back to the button that opened the editor, or to Edit once accepted.
  const close = () => {
    const trigger = editing?.trigger ?? "edit";
    setEditing(null);
    focusTrigger(id, trigger, "edit");
  };

  const save = async (mode: EditorMode, values: Values) => {
    const steps: SetupStep[] = fields.map((field, index) => ({
      expectedRevision: index === 0 ? state.draft.revision : "previous",
      input: { action: mode === "own" ? "choose_own" : "adjust", field, value: values[field] },
      operation: "setup.update_draft",
    }));

    if (await run(id, steps)) close();
  };

  // Accepts each shown, unaccepted value with its label; a value that changed
  // since this card rendered is refused as stale and the card reloads.
  const useThis = async () => {
    const pending = views.filter(({ view }) => view.proposed && !view.proposed.accepted);
    const steps: SetupStep[] = pending.map(({ field, view }, index) => ({
      expectedRevision: index === 0 ? state.draft.revision : "previous",
      input: { action: "use_suggestion", field, shown: view.proposed!.value },
      operation: "setup.update_draft",
    }));

    if (await run(id, steps)) focusTrigger(id, "edit");
  };

  const canUseThis = views.every(({ view }) => view.proposed);

  return (
    <SetupCard eyebrow={eyebrow} id={id} title={title}>
      {editing ? (
        editor({ mode: editing.mode, onCancel: close, onSave: (values) => void save(editing.mode, values), saving })
      ) : accepted ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CheckIcon aria-hidden className="size-4 shrink-0 text-success" />
          <p className="min-w-0 flex-1 break-words">
            <span className="sr-only">Accepted: </span>
            {summary}
          </p>
          <Button
            aria-label={`Edit ${title.toLowerCase()}`}
            data-trigger="edit"
            disabled={disabled}
            onClick={() => open("adjust", "edit")}
            type="button"
            variant="outline"
          >
            Edit
          </Button>
        </div>
      ) : (
        <>
          {value}
          <CardActions>
            {canUseThis ? (
              <Button data-trigger="use" disabled={disabled} onClick={() => void useThis()} type="button">
                {saving ? "Saving..." : "Use this"}
              </Button>
            ) : null}
            <Button data-trigger="adjust" disabled={disabled} onClick={() => open("adjust", "adjust")} type="button" variant="outline">
              Adjust
            </Button>
            <Button data-trigger="own" disabled={disabled} onClick={() => open("own", "own")} type="button" variant="ghost">
              Choose my own
            </Button>
          </CardActions>
        </>
      )}
    </SetupCard>
  );
}

// A proposed value's source badge and its one-line reason.
function Provenance({ field }: { readonly field: SetupFieldName }) {
  const { state } = useSetup();
  const proposed = state.fields[field].proposed;
  if (!proposed) return null;

  return (
    <div className="flex flex-col gap-1">
      <SourceBadge sampleSize={proposed.sampleSize} source={proposed.source} />
      {proposed.reason ? <p className="text-sm text-muted-foreground">{proposed.reason}</p> : null}
    </div>
  );
}

export function WeeklyPreview({ windows }: { readonly windows: readonly WeeklyWindow[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm tabular-nums">
      {weeklyPreview(windows).map((row) => (
        <div className="contents" key={row.weekday}>
          <dt className="font-medium">{row.label}</dt>
          <dd className={row.ranges.length === 0 ? "text-muted-foreground" : "break-words"}>
            {row.ranges.length === 0 ? "Unavailable" : row.ranges.join(", ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TimezoneCard() {
  const { state } = useSetup();
  const zone = state.fields.timezone.proposed?.value ?? null;

  return (
    <SuggestionCard
      editor={({ mode, onCancel, onSave, saving }) => (
        <TimezoneEditor
          initial={mode === "adjust" ? zone : null}
          onCancel={onCancel}
          onSave={(timezone) => onSave({ timezone })}
          saving={saving}
        />
      )}
      fields={["timezone"]}
      id={SUGGESTION_CARD_IDS.timezone}
      summary={`Time zone: ${zone?.replaceAll("_", " ") ?? "not set"}`}
      title="Time zone"
      value={
        <div className="flex flex-col gap-2">
          <p className="text-lg font-medium break-words">{zone?.replaceAll("_", " ") ?? "Not set"}</p>
          <Provenance field="timezone" />
        </div>
      }
    />
  );
}

export function WeeklyWindowsCard() {
  const { state } = useSetup();
  const windows = state.fields.weeklyWindows.proposed?.value ?? null;

  return (
    <SuggestionCard
      editor={({ mode, onCancel, onSave, saving }) => (
        <WeeklyWindowsEditor
          initial={mode === "adjust" ? windows : null}
          onCancel={onCancel}
          onSave={(weeklyWindows) => onSave({ weeklyWindows })}
          saving={saving}
        />
      )}
      fields={["weeklyWindows"]}
      id={SUGGESTION_CARD_IDS.windows}
      summary={`Weekly windows: ${windows ? summarizeWindows(windows) : "not set"}`}
      title="Weekly windows"
      value={
        <div className="flex flex-col gap-3">
          {windows ? <WeeklyPreview windows={windows} /> : <p className="text-muted-foreground">No windows yet.</p>}
          <Provenance field="weeklyWindows" />
        </div>
      }
    />
  );
}

export function WeeklyLimitCard() {
  const { state } = useSetup();
  const limit = state.fields.weeklyLimit.proposed;

  return (
    <SuggestionCard
      editor={({ mode, onCancel, onSave, saving }) => (
        <LimitEditor
          initial={mode === "adjust" ? (limit?.value ?? null) : undefined}
          onCancel={onCancel}
          onSave={(weeklyLimit) => onSave({ weeklyLimit })}
          saving={saving}
        />
      )}
      fields={["weeklyLimit"]}
      id={SUGGESTION_CARD_IDS.limit}
      summary={limit ? describeLimit(limit.value) : "No weekly limit"}
      title="Weekly meeting limit"
      value={
        <div className="flex flex-col gap-2">
          <p className="text-lg font-medium">{limit ? describeLimit(limit.value) : "Not set"}</p>
          <Provenance field="weeklyLimit" />
        </div>
      }
    />
  );
}

const DURATION_FIELDS = ["durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes"] as const;

export function DurationCard() {
  const { state } = useSetup();
  const duration = state.fields.durationMinutes.proposed?.value;
  const before = state.fields.bufferBeforeMinutes.proposed?.value;
  const after = state.fields.bufferAfterMinutes.proposed?.value;
  const describe = (value: number | undefined) => (value === undefined ? "not set" : formatMinutes(value));

  return (
    <SuggestionCard
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
      id={SUGGESTION_CARD_IDS.duration}
      summary={`${describe(duration)} meetings, ${describe(before)} before and ${describe(after)} after`}
      title="Meeting length and buffers"
      value={
        <dl className="flex flex-col gap-3">
          {(
            [
              ["Meeting length", "durationMinutes", duration],
              ["Buffer before", "bufferBeforeMinutes", before],
              ["Buffer after", "bufferAfterMinutes", after],
            ] as const
          ).map(([label, field, minutes]) => (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4" key={field}>
              <dt className="text-sm font-medium sm:w-32 sm:shrink-0">{label}</dt>
              <dd className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{minutes === undefined ? "Not set" : formatMinutes(minutes)}</span>
                <Provenance field={field} />
              </dd>
            </div>
          ))}
        </dl>
      }
    />
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
          className="h-11 w-28 bg-card text-base tabular-nums md:text-base"
          id={id}
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => onChange(event.target.value)}
          step={step}
          type="number"
          value={value}
        />
        <span className="text-sm text-muted-foreground">minutes</span>
      </div>
    </div>
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

  return (
    <form
      aria-label="Edit meeting length and buffers"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave(parsed as { duration: number; before: number; after: number });
      }}
    >
      <div className="flex flex-wrap gap-4">
        <MinutesInput id={`${id}-duration`} label="Meeting length" max={240} min={15} onChange={setDuration} step={5} value={duration} />
        <MinutesInput id={`${id}-before`} label="Buffer before" max={120} min={0} onChange={setBefore} value={before} />
        <MinutesInput id={`${id}-after`} label="Buffer after" max={120} min={0} onChange={setAfter} value={after} />
      </div>
      <p className="text-sm text-muted-foreground" id={`${id}-hint`}>
        Meetings run 15 to 240 minutes in steps of 5; buffers are 0 to 120 minutes.
      </p>
      <CardActions>
        <Button disabled={!valid || saving} type="submit">
          {saving ? "Saving..." : "Save length and buffers"}
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </CardActions>
    </form>
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

  return (
    <form
      aria-label="Edit weekly meeting limit"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave(noLimit ? null : limit);
      }}
    >
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
            Meetings per week, at most
          </label>
          <Input
            className="h-11 w-28 bg-card text-base tabular-nums md:text-base"
            id={`${id}-limit`}
            inputMode="numeric"
            max={50}
            min={1}
            onChange={(event) => setRaw(event.target.value)}
            type="number"
            value={raw}
          />
          <p className="text-sm text-muted-foreground">Between 1 and 50.</p>
        </div>
      ) : null}
      <CardActions>
        <Button disabled={!valid || saving} type="submit">
          {saving ? "Saving..." : "Save limit"}
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </CardActions>
    </form>
  );
}
