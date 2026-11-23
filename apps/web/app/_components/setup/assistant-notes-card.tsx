"use client";

import { cleanHostNotes, HOST_NOTES_MAX_LENGTH } from "@lib/contracts/host-notes";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { CardActions, QuietButton } from "./card";
import { useSetup, useStepper } from "./setup-context";
import { StepCard } from "./step-card";
import { STEP_CARD_IDS, stepAccepted } from "./steps";

// The host's notes for Thyme (host-preference-notes): the last, optional setup
// step and the Settings section share this field. Notes are saved at once to the
// account, outside the draft, so neither the review nor a confirmation is needed.

export const NOTES_PLACEHOLDER = "For example: investment advisory meetings are 30 minutes. A first meeting is online.";

export const NOTES_PRIVACY =
  "Thyme uses these only to suggest a length, form or place to your guests. Guests never see them, and your settings still decide which times and options are offered.";

export function AssistantNotesField({
  disabled,
  id,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  readonly id: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const hintId = useId();
  const tooLong = cleanHostNotes(value).length > HOST_NOTES_MAX_LENGTH;

  return (
    <Field className="min-w-0 gap-1" data-invalid={tooLong ? true : undefined}>
      <FieldLabel htmlFor={id}>Notes for Thyme</FieldLabel>
      <Textarea
        aria-describedby={hintId}
        aria-invalid={tooLong ? true : undefined}
        className="min-h-24 bg-card text-base md:text-base"
        disabled={disabled}
        id={id}
        maxLength={HOST_NOTES_MAX_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        placeholder={NOTES_PLACEHOLDER}
        value={value}
      />
      <FieldDescription id={hintId}>
        {tooLong ? `Keep the notes to ${HOST_NOTES_MAX_LENGTH} characters.` : NOTES_PRIVACY}
      </FieldDescription>
    </Field>
  );
}

export const ASSISTANT_NOTES_INPUT_ID = "setup-assistant-notes-input";

export function AssistantNotesStep() {
  const { busy, run, state } = useSetup();
  const stepper = useStepper();
  const id = STEP_CARD_IDS.assistantNotes;
  const saved = state.assistantNotes?.text ?? "";
  const [notes, setNotes] = useState(saved);
  const accepted = stepAccepted(state, "assistantNotes");
  const cleaned = cleanHostNotes(notes);
  const changed = cleaned !== saved;
  const canSave = cleaned.length <= HOST_NOTES_MAX_LENGTH;

  const save = async (value: string) => {
    if (accepted && value === saved) {
      stepper.forward();
      return;
    }
    const ok = await run(id, [{ expectedRevision: null, input: { notes: value }, operation: "setup.save_assistant_notes" }]);
    if (ok) stepper.saved();
  };

  return (
    <StepCard
      description="Optional. Preferences Thyme should keep in mind when it suggests a meeting to your guests."
      step="assistantNotes"
      title="Anything Thyme should know when talking with your guests?"
    >
      <AssistantNotesField disabled={busy !== null} id={ASSISTANT_NOTES_INPUT_ID} onChange={setNotes} value={notes} />
      <CardActions>
        <Button data-trigger="use" disabled={!canSave || busy !== null} onClick={() => void save(cleaned)} type="button">
          {busy === id ? "Saving..." : cleaned.length === 0 ? (accepted ? "Keep no notes" : "No notes") : changed ? "Save notes" : "Keep these"}
        </Button>
        {accepted ? null : (
          <QuietButton className="ml-auto" disabled={busy !== null} onClick={stepper.skip}>
            Skip for now
          </QuietButton>
        )}
      </CardActions>
    </StepCard>
  );
}
