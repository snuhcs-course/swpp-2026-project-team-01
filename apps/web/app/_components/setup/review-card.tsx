"use client";

import { displayNameSchema, type SetupFieldName } from "@lib/contracts/setup";
import type { HandleAvailability } from "@lib/server/handles";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkHandle } from "@/lib/setup/client";
import { ANALYSIS_CARD_ID } from "./analysis-card";
import { CALENDARS_CARD_ID } from "./calendar-cards";
import { CardActions, focusCard, SetupCard, SourceBadge } from "./card";
import {
  describeLimit,
  describeLocation,
  describeTravelMode,
  FIELD_LABELS,
  formatMinutes,
  handleMessage,
  MEETING_MODE_LABELS,
} from "./format";
import { answeredMode, QUESTION_CARD_IDS } from "./question-cards";
import { useSetup } from "./setup-context";
import { SUGGESTION_CARD_IDS, WeeklyPreview } from "./suggestion-cards";

// The setup review (H8, H9): the exact settings confirmation would save, each
// with its source, the editable display name and handle, the calendar roles, the
// values still missing, and **Confirm and save proposed settings**, which names
// the reviewed draft revision and proposal hash so a newer draft rejects it.

export const REVIEW_CARD_ID = "setup-review";
export const DISPLAY_NAME_INPUT_ID = "setup-display-name";
export const HANDLE_INPUT_ID = "setup-handle";
export const CHANGE_CALENDARS_ID = "setup-change-calendars";

// Where each field is answered, so a missing value can take the host there.
export const FIELD_TARGETS: Readonly<Record<SetupFieldName, { readonly card: string; readonly input?: string }>> = {
  bufferAfterMinutes: { card: SUGGESTION_CARD_IDS.duration },
  bufferBeforeMinutes: { card: SUGGESTION_CARD_IDS.duration },
  displayName: { card: REVIEW_CARD_ID, input: DISPLAY_NAME_INPUT_ID },
  durationMinutes: { card: SUGGESTION_CARD_IDS.duration },
  handle: { card: REVIEW_CARD_ID, input: HANDLE_INPUT_ID },
  location: { card: QUESTION_CARD_IDS.location },
  meetingMode: { card: QUESTION_CARD_IDS.mode },
  noteExclusions: { card: ANALYSIS_CARD_ID },
  timezone: { card: SUGGESTION_CARD_IDS.timezone },
  travelBufferMinutes: { card: QUESTION_CARD_IDS.travelBuffer },
  travelMode: { card: QUESTION_CARD_IDS.transport },
  weeklyLimit: { card: SUGGESTION_CARD_IDS.limit },
  weeklyWindows: { card: SUGGESTION_CARD_IDS.windows },
};

export function focusField(field: SetupFieldName) {
  const target = FIELD_TARGETS[field];
  if (target.input) {
    const input = document.getElementById(target.input);
    if (input) {
      input.focus();
      input.scrollIntoView({ block: "center" });
      return;
    }
  }
  focusCard(target.card);
}

export function ReviewCard({ pending = false }: { readonly pending?: boolean }) {
  const { busy, run, setEditingCalendars, state } = useSetup();
  const { fields } = state;
  const mode = answeredMode(state);
  const inPerson = mode === "in_person" || mode === "either";
  const missing = state.missingFields;
  const saving = busy === REVIEW_CARD_ID;

  const confirm = () =>
    run(REVIEW_CARD_ID, [
      {
        expectedRevision: state.draft.revision,
        input: { proposalHash: state.proposalHash },
        operation: "setup.confirm_settings",
      },
    ]);

  const row = (field: SetupFieldName, value: ReactNode) => {
    const proposed = fields[field].proposed;
    return (
      <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4" key={field}>
        <dt className="text-sm font-medium sm:w-40 sm:shrink-0">{FIELD_LABELS[field]}</dt>
        <dd className="flex min-w-0 flex-1 flex-col gap-1">
          {proposed ? value : <span className="text-muted-foreground">Not set yet</span>}
          {proposed ? <SourceBadge sampleSize={proposed.sampleSize} source={proposed.source} /> : null}
        </dd>
      </div>
    );
  };

  const exclusions = fields.noteExclusions.proposed?.value.length ?? 0;

  return (
    <SetupCard
      eyebrow="Review"
      id={REVIEW_CARD_ID}
      title={pending ? "Review your changes" : "Review your booking settings"}
      description={
        pending
          ? "People still book with your confirmed settings until you confirm these."
          : "This is exactly what will be saved. Nothing is public until you confirm."
      }
    >
      <dl className="flex flex-col divide-y divide-border">
        {row("timezone", <span className="break-words">{fields.timezone.proposed?.value.replaceAll("_", " ")}</span>)}
        {row("weeklyWindows", fields.weeklyWindows.proposed ? <WeeklyPreview windows={fields.weeklyWindows.proposed.value} /> : null)}
        {row("weeklyLimit", describeLimit(fields.weeklyLimit.proposed?.value ?? null))}
        {row("noteExclusions", exclusions === 0 ? "None excluded" : `${exclusions} excluded from busy time`)}
        {row("durationMinutes", formatMinutes(fields.durationMinutes.proposed?.value ?? 0))}
        {row("bufferBeforeMinutes", formatMinutes(fields.bufferBeforeMinutes.proposed?.value ?? 0))}
        {row("bufferAfterMinutes", formatMinutes(fields.bufferAfterMinutes.proposed?.value ?? 0))}
        {mode
          ? row("meetingMode", MEETING_MODE_LABELS[mode])
          : (
              <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
                <dt className="text-sm font-medium sm:w-40 sm:shrink-0">{FIELD_LABELS.meetingMode}</dt>
                <dd className="text-muted-foreground">Not answered yet</dd>
              </div>
            )}
        {inPerson ? (
          <>
            {row("location", fields.location.proposed ? describeLocation(fields.location.proposed.value) : null)}
            {row("travelMode", fields.travelMode.proposed ? describeTravelMode(fields.travelMode.proposed.value) : null)}
            {row("travelBufferMinutes", formatMinutes(fields.travelBufferMinutes.proposed?.value ?? 0))}
          </>
        ) : null}
      </dl>

      <IdentityFields />

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <h4 className="font-medium">Calendars</h4>
        {state.roles ? (
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex flex-col sm:flex-row sm:gap-4">
              <dt className="font-medium sm:w-40 sm:shrink-0">Check for conflicts</dt>
              <dd className="min-w-0 break-words">{state.roles.conflictCalendars.map((calendar) => calendar.summary).join(", ")}</dd>
            </div>
            <div className="flex flex-col sm:flex-row sm:gap-4">
              <dt className="font-medium sm:w-40 sm:shrink-0">Add bookings to</dt>
              <dd className="min-w-0 break-words">{state.roles.bookingCalendar.summary}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No calendars chosen yet.</p>
        )}
        <Button
          className="self-start"
          disabled={busy !== null || !state.calendar.connected}
          id={CHANGE_CALENDARS_ID}
          onClick={() => {
            setEditingCalendars(true);
            focusCard(CALENDARS_CARD_ID);
          }}
          type="button"
          variant="outline"
        >
          Change calendars
        </Button>
      </div>

      {missing.length > 0 ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm font-medium">Still needed before you can confirm:</p>
          <ul className="flex flex-wrap gap-2">
            {missing.map((field) => (
              <li key={field}>
                <Button className="h-auto min-h-11" onClick={() => focusField(field)} type="button" variant="link">
                  {FIELD_LABELS[field]}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <CardActions>
        <Button disabled={missing.length > 0 || busy !== null} onClick={() => void confirm()} type="button">
          {saving ? "Saving..." : "Confirm and save proposed settings"}
        </Button>
      </CardActions>
    </SetupCard>
  );
}

// Display name and handle, edited in place and saved as the host's own values.
// The handle is checked as it is typed, and again when saved and confirmed.
function IdentityFields() {
  const { busy, run, state } = useSetup();
  const savedName = state.fields.displayName.proposed?.value ?? "";
  const savedHandle = state.fields.handle.proposed?.value ?? "";
  const [name, setName] = useState(savedName);
  const [handle, setHandle] = useState(savedHandle);
  const [check, setCheck] = useState<{ handle: string; availability: HandleAvailability | "checking" | "error" } | null>(null);
  const id = useId();

  // A new server value (after a save or another change) resets an untouched field.
  const [seen, setSeen] = useState({ handle: savedHandle, name: savedName });
  if (seen.name !== savedName || seen.handle !== savedHandle) {
    setSeen({ handle: savedHandle, name: savedName });
    if (name === seen.name) setName(savedName);
    if (handle === seen.handle) setHandle(savedHandle);
  }

  const candidate = handle.trim().toLowerCase();
  const handleChanged = candidate !== savedHandle;

  useEffect(() => {
    if (!handleChanged || candidate.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCheck({ availability: "checking", handle: candidate });
      checkHandle(candidate, controller.signal)
        .then((result) => setCheck({ availability: result.availability, handle: candidate }))
        .catch(() => {
          if (!controller.signal.aborted) setCheck({ availability: "error", handle: candidate });
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [candidate, handleChanged]);

  const nameResult = displayNameSchema.safeParse(name);
  const nameChanged = nameResult.success && nameResult.data !== savedName;
  const current = check?.handle === candidate ? check.availability : null;
  const handleText = !handleChanged
    ? handleMessage(state.handleAvailability)
    : candidate.length === 0
      ? "Enter a handle."
      : current === "checking" || current === null
        ? "Checking..."
        : current === "error"
          ? "The handle couldn't be checked right now."
          : current === "available"
            ? "Available."
            : handleMessage(current);
  const canSaveHandle = handleChanged && current === "available";
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const save = (field: "displayName" | "handle", value: string) =>
    run(REVIEW_CARD_ID, [
      {
        expectedRevision: state.draft.revision,
        input: { action: "adjust", field, value },
        operation: "setup.update_draft",
      },
    ]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form
        className="flex min-w-0 flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (nameChanged) void save("displayName", nameResult.data);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium" htmlFor={DISPLAY_NAME_INPUT_ID}>
            Display name
          </label>
          <FieldSource field="displayName" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-describedby={`${id}-name-hint`}
            className="h-11 min-w-0 flex-1 bg-card text-base md:text-base"
            id={DISPLAY_NAME_INPUT_ID}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <Button disabled={!nameChanged || busy !== null} type="submit" variant="outline">
            Save name
          </Button>
        </div>
        <p className="text-sm text-muted-foreground" id={`${id}-name-hint`}>
          {nameResult.success ? "Shown on your booking page." : "Enter a name of up to 80 characters."}
        </p>
      </form>
      <form
        className="flex min-w-0 flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSaveHandle) void save("handle", candidate);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium" htmlFor={HANDLE_INPUT_ID}>
            Handle
          </label>
          <FieldSource field="handle" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-describedby={`${id}-handle-hint`}
            aria-invalid={handleChanged && current !== null && current !== "checking" && current !== "available" ? true : undefined}
            autoCapitalize="none"
            autoComplete="off"
            className="h-11 min-w-0 flex-1 bg-card font-mono text-base md:text-base"
            id={HANDLE_INPUT_ID}
            maxLength={64}
            onChange={(event) => setHandle(event.target.value)}
            spellCheck={false}
            value={handle}
          />
          <Button disabled={!canSaveHandle || busy !== null} type="submit" variant="outline">
            Save handle
          </Button>
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground" id={`${id}-handle-hint`}>
          {handleText ?? (
            <>
              Your link: <span className="break-all text-foreground">{`${origin}/${candidate}`}</span>
            </>
          )}
        </p>
      </form>
    </div>
  );
}

function FieldSource({ field }: { readonly field: "displayName" | "handle" }) {
  const { state } = useSetup();
  const proposed = state.fields[field].proposed;
  return proposed ? <SourceBadge sampleSize={proposed.sampleSize} source={proposed.source} /> : null;
}
