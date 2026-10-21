"use client";

import { displayNameSchema, type SetupFieldName } from "@lib/contracts/setup";
import type { HandleAvailability } from "@lib/server/handles";
import { CircleCheckIcon, CircleIcon, ListChecksIcon, ShieldCheckIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { Input } from "@/components/ui/input";
import { checkHandle } from "@/lib/setup/client";
import { cn } from "@/lib/utils";
import { CALENDARS_CARD_ID } from "./calendar-cards";
import { CardActions, EditorForm, focusCard, QuietButton, SetupCard, SourceBadge } from "./card";
import {
  describeLimit,
  describeLocation,
  describeTravelMode,
  FIELD_LABELS,
  formatMinutes,
  groupWindows,
  handleMessage,
  MEETING_MODE_LABELS,
} from "./format";
import { type SetupStep, useSetup, useStepper } from "./setup-context";
import { StepCard } from "./step-card";
import { acceptedMode, noteEntries, STEP_CARD_IDS, STEP_FIELDS, STEP_LABELS, type StepId, stepAccepted, stepForField } from "./steps";

// The setup review (H8, H9): the exact settings confirmation would save in one
// compact list, each with its source and an Edit link that asks its step again
// in a fresh card at the bottom, the calendar
// roles, the values still missing, and **Confirm and save proposed settings**,
// which names the reviewed draft revision and proposal hash so a newer draft
// rejects it. The identity step (display name and handle) comes just before it.

export const REVIEW_CARD_ID = STEP_CARD_IDS.review;
export const DISPLAY_NAME_INPUT_ID = "setup-display-name";
export const HANDLE_INPUT_ID = "setup-handle";
export const CHANGE_CALENDARS_ID = "setup-change-calendars";

export function ReviewCard({ pending = false }: { readonly pending?: boolean }) {
  const { busy, run, setEditingCalendars, state } = useSetup();
  const stepper = useStepper();
  const { fields } = state;
  const mode = acceptedMode(state);
  const inPerson = mode === "in_person" || mode === "either";
  const missing = state.missingFields;
  const saving = busy === REVIEW_CARD_ID;
  const exclusions = fields.noteExclusions.proposed?.value.length ?? 0;
  const reviewedCount = stepper.steps.filter((step) => stepAccepted(state, step)).length;
  // Missing values, one link per step.
  const missingSteps = [...new Set(missing.map(stepForField))];

  const confirm = () =>
    run(REVIEW_CARD_ID, [
      {
        expectedRevision: state.draft.revision,
        input: { proposalHash: state.proposalHash },
        operation: "setup.confirm_settings",
      },
    ]);

  const duration = fields.durationMinutes.proposed?.value;
  const before = fields.bufferBeforeMinutes.proposed?.value;
  const after = fields.bufferAfterMinutes.proposed?.value;
  const windows = fields.weeklyWindows.proposed?.value;
  const handle = fields.handle.proposed?.value;

  return (
    <SetupCard
      description={
        pending ? (
          <span role="status">
            <span className="font-medium text-warning">Not yet confirmed.</span> People still book with your confirmed settings.
          </span>
        ) : (
          "Nothing is public until you confirm."
        )
      }
      id={REVIEW_CARD_ID}
      label="Review"
      progress={pending ? undefined : 1}
      scroll
      title={pending ? "Review your changes" : "Review your booking settings"}
    >
      <Trace>
        <TraceLine>
          <TraceIcon>
            <ListChecksIcon />
          </TraceIcon>
          <TraceTitle>Your booking settings</TraceTitle>
          <TraceDescription>
            {reviewedCount} of {stepper.steps.length} reviewed
          </TraceDescription>
        </TraceLine>
      </Trace>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <Row label={FIELD_LABELS.timezone} step="timezone">
          {fields.timezone.proposed?.value.replaceAll("_", " ")}
        </Row>
        <Row label={FIELD_LABELS.weeklyWindows} step="windows">
          {windows
            ? groupWindows(windows).map((group) => (
                <span className="block tabular-nums" key={group.days}>
                  <span className="font-medium">{group.days}</span> {group.ranges ?? <span className="text-muted-foreground">unavailable</span>}
                </span>
              ))
            : null}
        </Row>
        <Row label={FIELD_LABELS.weeklyLimit} step="limit">
          {describeLimit(fields.weeklyLimit.proposed?.value ?? null)}
        </Row>
        <Row label="Meeting length" step="duration">
          {duration === undefined ? null : (
            <>
              <span>{formatMinutes(duration)}</span>
              <span className="text-muted-foreground">
                {" · "}
                <span>{formatMinutes(before ?? 0)} before</span>
                {" · "}
                <span>{formatMinutes(after ?? 0)} after</span>
              </span>
            </>
          )}
        </Row>
        <Row label={FIELD_LABELS.noteExclusions} step={noteEntries(state).length > 0 ? "notes" : null}>
          {exclusions === 0 ? "None excluded" : `${exclusions} excluded from busy time`}
        </Row>
        <Row label={FIELD_LABELS.meetingMode} step="mode">
          {mode ? MEETING_MODE_LABELS[mode] : null}
        </Row>
        {inPerson ? (
          <>
            <Row label={FIELD_LABELS.location} step="location">
              {fields.location.proposed?.accepted ? describeLocation(fields.location.proposed.value) : null}
            </Row>
            <Row label={FIELD_LABELS.travelMode} step="transport">
              {fields.travelMode.proposed?.accepted ? describeTravelMode(fields.travelMode.proposed.value) : null}
            </Row>
            <Row label={FIELD_LABELS.travelBufferMinutes} step="travelBuffer">
              {fields.travelBufferMinutes.proposed ? formatMinutes(fields.travelBufferMinutes.proposed.value) : null}
            </Row>
          </>
        ) : null}
        <Row label={FIELD_LABELS.displayName} step="identity" field="displayName">
          {fields.displayName.proposed?.value}
        </Row>
        <Row label={FIELD_LABELS.handle} step="identity" field="handle">
          {handle ? <span className="font-mono break-all">/{handle}</span> : null}
        </Row>
        <div className="flex min-w-0 items-start gap-2 border-t border-border py-2 sm:col-span-2">
          <div className="min-w-0 flex-1">
            <dt className="text-xs text-muted-foreground">Calendars</dt>
            <dd className="min-w-0 break-words">
              {state.roles ? (
                <>
                  Checks {state.roles.conflictCalendars.map((calendar) => calendar.summary).join(", ")}; adds bookings to{" "}
                  {state.roles.bookingCalendar.summary}
                </>
              ) : (
                <span className="text-muted-foreground">Not chosen yet</span>
              )}
            </dd>
          </div>
          <EditLink
            disabled={busy !== null || !state.calendar.connected}
            id={CHANGE_CALENDARS_ID}
            label="calendars"
            onClick={() => {
              setEditingCalendars(true);
              focusCard(CALENDARS_CARD_ID);
            }}
          />
        </div>
      </dl>

      {missingSteps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" role="status">
          <p className="font-medium">Still needed:</p>
          {missingSteps.map((step) => (
            <Button className="min-h-9 px-1" key={step} onClick={() => stepper.edit(step)} type="button" variant="link">
              {STEP_LABELS[step]}
            </Button>
          ))}
        </div>
      ) : null}

      {/* The Confirmation pattern: one prompt to approve, kept in view. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto bg-card px-4 pt-1 pb-3">
        <Item className="gap-2 rounded-lg px-3 py-2" size="sm" variant="outline">
          <ItemMedia variant="icon">
            <ShieldCheckIcon />
          </ItemMedia>
          <ItemContent className="min-w-40 gap-0">
            <ItemTitle>{pending ? "Publish these changes?" : "Ready to go live?"}</ItemTitle>
            <ItemDescription className="text-xs">Your booking page uses exactly these settings.</ItemDescription>
          </ItemContent>
          <ItemActions className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto" disabled={missing.length > 0 || busy !== null} onClick={() => void confirm()} type="button">
              {saving ? "Saving..." : "Confirm and save proposed settings"}
            </Button>
          </ItemActions>
        </Item>
      </div>
    </SetupCard>
  );
}

function EditLink({ disabled, id, label, onClick }: { readonly disabled?: boolean; readonly id?: string; readonly label: string; readonly onClick: () => void }) {
  return (
    <Button aria-label={`Edit ${label}`} className="-mr-1 min-h-9 shrink-0 px-1" disabled={disabled} id={id} onClick={onClick} type="button" variant="link">
      Edit
    </Button>
  );
}

// One reviewed value: its label, the value or "Not set yet", its source, and an
// Edit link that asks its step again. A value the host skipped is marked as only proposed.
function Row({
  children,
  field,
  label,
  step,
}: {
  readonly children: ReactNode;
  readonly field?: SetupFieldName;
  readonly label: string;
  readonly step: StepId | null;
}) {
  const { busy, state } = useSetup();
  const stepper = useStepper();
  const shown = field ?? (step ? STEP_FIELDS[step][0] : undefined);
  const proposed = shown ? state.fields[shown].proposed : null;
  const empty = children === null || children === undefined;
  const unreviewed = step !== null && !empty && !stepAccepted(state, step);

  return (
    <div className="flex min-w-0 items-start gap-2 border-t border-border py-2 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
      <TraceIcon className={cn("mt-0.5", empty || unreviewed ? "text-muted-foreground" : "text-success")}>
        {empty || unreviewed ? <CircleIcon /> : <CircleCheckIcon />}
      </TraceIcon>
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="flex min-w-0 flex-col gap-1">
          <span className={cn("min-w-0 break-words", empty && "text-muted-foreground")}>{empty ? "Not set yet" : children}</span>
          {!empty && proposed ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <SourceBadge sampleSize={proposed.sampleSize} source={proposed.source} />
              {unreviewed ? <span className="text-xs text-muted-foreground">Proposed, not reviewed</span> : null}
            </span>
          ) : null}
        </dd>
      </div>
      {step ? <EditLink disabled={busy !== null} label={label.toLowerCase()} onClick={() => stepper.edit(step)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The identity step: display name and handle, checked as they are typed.

export function IdentityStep() {
  const { busy, run, state } = useSetup();
  const stepper = useStepper();
  const id = STEP_CARD_IDS.identity;
  const savedName = state.fields.displayName.proposed?.value ?? "";
  const savedHandle = state.fields.handle.proposed?.value ?? "";
  const [name, setName] = useState(savedName);
  const [handle, setHandle] = useState(savedHandle);
  const [check, setCheck] = useState<{ handle: string; availability: HandleAvailability | "checking" | "error" } | null>(null);
  const hintId = useId();

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
  const handleOk = handleChanged ? current === "available" : state.handleAvailability === "available";
  const canSave = nameResult.success && handleOk && savedHandle.length + candidate.length > 0;
  const accepted = stepAccepted(state, "identity");
  const changed = nameChanged || handleChanged;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // Changed values are saved as the host's own; unchanged, unaccepted ones are
  // accepted as shown.
  const save = async () => {
    if (!canSave) return;
    const entries: { field: "displayName" | "handle"; changed: boolean; value: string }[] = [
      { changed: nameChanged, field: "displayName", value: nameResult.success ? nameResult.data : savedName },
      { changed: handleChanged, field: "handle", value: candidate },
    ];
    const steps: SetupStep[] = [];
    for (const entry of entries) {
      const proposed = state.fields[entry.field].proposed;
      if (entry.changed) {
        steps.push({ expectedRevision: "previous", input: { action: "adjust", field: entry.field, value: entry.value }, operation: "setup.update_draft" });
      } else if (proposed && !proposed.accepted) {
        steps.push({ expectedRevision: "previous", input: { action: "use_suggestion", field: entry.field, shown: proposed.value }, operation: "setup.update_draft" });
      }
    }
    if (steps.length === 0) {
      stepper.forward();
      return;
    }
    const chained = steps.map((step, index) => (index === 0 ? { ...step, expectedRevision: state.draft.revision } : step));
    if (await run(id, chained)) stepper.saved();
  };

  return (
    <StepCard step="identity" title="What should your booking page show?">
      <EditorForm label="Booking page identity" onSubmit={() => void save()}>
        <Field className="min-w-0 gap-1" data-invalid={nameResult.success ? undefined : true}>
          <FieldLabel htmlFor={DISPLAY_NAME_INPUT_ID}>Display name</FieldLabel>
          <Input
            aria-describedby={nameResult.success ? undefined : `${hintId}-name`}
            aria-invalid={nameResult.success ? undefined : true}
            className="h-11 min-w-0 bg-card text-base md:text-base"
            id={DISPLAY_NAME_INPUT_ID}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          {nameResult.success ? null : (
            <FieldDescription className="text-destructive" id={`${hintId}-name`}>
              Enter a name of up to 80 characters.
            </FieldDescription>
          )}
        </Field>
        <Field className="min-w-0 gap-1">
          <FieldLabel htmlFor={HANDLE_INPUT_ID}>Handle</FieldLabel>
          <Input
            aria-describedby={`${hintId}-handle`}
            aria-invalid={handleChanged && current !== null && current !== "checking" && current !== "available" ? true : undefined}
            autoCapitalize="none"
            autoComplete="off"
            className="h-11 min-w-0 bg-card font-mono text-base md:text-base"
            id={HANDLE_INPUT_ID}
            maxLength={64}
            onChange={(event) => setHandle(event.target.value)}
            spellCheck={false}
            value={handle}
          />
          <FieldDescription aria-live="polite" id={`${hintId}-handle`}>
            {handleText ?? (
              <>
                Your link: <span className="break-all text-foreground">{`${origin}/${candidate}`}</span>
              </>
            )}
          </FieldDescription>
        </Field>
        <CardActions>
          <Button data-trigger="use" disabled={!canSave || busy !== null} onClick={() => void save()} type="button">
            {busy === id ? "Saving..." : changed ? "Save" : accepted ? "Keep this" : "Use these"}
          </Button>
          {accepted ? null : (
            <QuietButton className="ml-auto" disabled={busy !== null} onClick={stepper.skip}>
              Skip for now
            </QuietButton>
          )}
        </CardActions>
      </EditorForm>
    </StepCard>
  );
}
