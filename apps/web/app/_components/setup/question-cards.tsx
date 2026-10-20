"use client";

import {
  type LocationAnswer,
  MEETING_MODES,
  type SetupFieldName,
  TRAVEL_MODES,
  type TravelMode,
} from "@lib/contracts/setup";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuestionnaireChoice, QuestionnaireChoices } from "@/components/ui/questionnaire";
import { CardActions, EditorForm, focusTrigger, revealCard } from "./card";
import { describeLocation, describeTravelMode, MEETING_MODE_LABELS } from "./format";
import { useSetup, useStepper } from "./setup-context";
import { StepCard } from "./step-card";
import { STEP_CARD_IDS } from "./steps";

// Mode, location and transport (H7). These are the host's own answers and count
// only once accepted on a card: every choice is saved as Choose my own, and a
// value the assistant recorded from the conversation shows as "You said" with
// **Use this**, never preselected. Online leaves the in-person steps out.

export const QUESTION_CARD_IDS = {
  location: STEP_CARD_IDS.location,
  mode: STEP_CARD_IDS.mode,
  transport: STEP_CARD_IDS.transport,
} as const;

// Whether a field holds the host's answer: accepted on a card.
function useAnswer<F extends SetupFieldName>(field: F) {
  const { state } = useSetup();
  const proposed = state.fields[field].proposed;
  return { answered: proposed?.accepted ?? false, proposed };
}

// Saves a choice as the host's answer, then hands over to the next open step.
function useAnswerAction(id: string) {
  const { run, state } = useSetup();
  const stepper = useStepper();
  return async (field: SetupFieldName, value: unknown) => {
    const saved = await run(id, [
      {
        expectedRevision: state.draft.revision,
        input: { action: "choose_own", field, value },
        operation: "setup.update_draft",
      },
    ]);
    if (saved) stepper.saved();
    return saved;
  };
}

// What the host told the assistant, recorded but not yet an answer: shown as
// "You said" with Use this, which accepts exactly the value shown.
function YouSaid({ children, field, id }: { readonly children: ReactNode; readonly field: SetupFieldName; readonly id: string }) {
  const { busy, run, state } = useSetup();
  const stepper = useStepper();
  const proposed = state.fields[field].proposed;

  if (!proposed || proposed.accepted || proposed.source !== "stated") return null;

  const use = async () => {
    const saved = await run(id, [
      {
        expectedRevision: state.draft.revision,
        input: { action: "use_suggestion", field, shown: proposed.value },
        operation: "setup.update_draft",
      },
    ]);
    if (saved) stepper.saved();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-secondary/60 px-3 py-2">
      <p className="min-w-0 flex-1 break-words">
        <span className="font-medium">You said:</span> {children}
      </p>
      <Button data-trigger="use" disabled={busy !== null} onClick={() => void use()} type="button">
        {busy === id ? "Saving..." : "Use this"}
      </Button>
    </div>
  );
}

// An answered step asked again with Edit: the answer stays pressed, and Keep
// this moves on without saving again.
function KeepAnswer({ answer }: { readonly answer: ReactNode }) {
  const { busy } = useSetup();
  const stepper = useStepper();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 flex-1 break-words">
        <span className="text-muted-foreground">Your answer: </span>
        <span className="font-medium">{answer}</span>
      </p>
      <Button data-trigger="keep" disabled={busy !== null} onClick={stepper.forward} type="button" variant="outline">
        Keep this
      </Button>
    </div>
  );
}

// The answers as Questionnaire choices (native radios, so arrow keys move and
// select without saving), then Continue saves the one chosen.
function AnswerChoices<T extends string>({
  current,
  field,
  id,
  labels,
  options,
}: {
  readonly current: T | null;
  readonly field: SetupFieldName;
  readonly id: string;
  readonly labels: Readonly<Record<T, string>>;
  readonly options: readonly T[];
}) {
  const { busy } = useSetup();
  const answer = useAnswerAction(id);
  const stepper = useStepper();
  const [chosen, setChosen] = useState<T | null>(current);
  const keeping = chosen !== null && chosen === current;

  return (
    <>
      <QuestionnaireChoices className="gap-2">
        {options.map((option) => (
          <QuestionnaireChoice
            checked={chosen === option}
            className="min-h-11 rounded-lg px-3 py-2.5"
            disabled={busy !== null}
            key={option}
            onChange={() => setChosen(option)}
            value={option}
          >
            {labels[option]}
          </QuestionnaireChoice>
        ))}
      </QuestionnaireChoices>
      <CardActions>
        <Button
          data-trigger="continue"
          disabled={chosen === null || busy !== null}
          onClick={() => {
            if (keeping) stepper.forward();
            else if (chosen) void answer(field, chosen);
          }}
          type="button"
        >
          {busy === id ? "Saving..." : keeping ? "Keep this" : "Continue"}
        </Button>
      </CardActions>
    </>
  );
}

export function ModeStep() {
  const id = STEP_CARD_IDS.mode;
  const { answered, proposed } = useAnswer("meetingMode");
  const current = answered && proposed ? proposed.value : null;

  return (
    <StepCard step="mode" title="Do you prefer online meetings, in-person meetings, or either?">
      {proposed ? (
        <YouSaid field="meetingMode" id={id}>
          {MEETING_MODE_LABELS[proposed.value]}
        </YouSaid>
      ) : null}
      <AnswerChoices current={current} field="meetingMode" id={id} labels={MEETING_MODE_LABELS} options={MEETING_MODES} />
    </StepCard>
  );
}

export function LocationStep() {
  const id = STEP_CARD_IDS.location;
  const { state, busy } = useSetup();
  const { answered, proposed } = useAnswer("location");
  const answer = useAnswerAction(id);
  const [entering, setEntering] = useState(false);
  const hint = state.placeHint;
  const hintPlaces = hint && (hint.area || hint.venue) ? hint : null;
  const disabled = busy !== null;

  const save = (value: LocationAnswer) => void answer("location", value);

  return (
    <StepCard step="location" title="Where do you prefer to meet?">
      {entering ? (
        <PlaceEditor
          initial={proposed?.value.kind === "places" ? proposed.value : null}
          onCancel={() => {
            setEntering(false);
            focusTrigger(id, "enter");
          }}
          onSave={save}
          saving={busy === id}
        />
      ) : (
        <>
          {answered && proposed ? <KeepAnswer answer={describeLocation(proposed.value)} /> : null}
          {proposed ? (
            <YouSaid field="location" id={id}>
              {describeLocation(proposed.value)}
            </YouSaid>
          ) : null}
          {hintPlaces ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground">
                Most frequent in {hintPlaces.sampleSize} in-person meeting{hintPlaces.sampleSize === 1 ? "" : "s"}. Nothing is saved
                until you choose.
              </p>
              <CardActions>
                {hintPlaces.area ? (
                  <Button
                    className="rounded-full"
                    disabled={disabled}
                    onClick={() => save({ areas: [hintPlaces.area!], kind: "places", venue: null })}
                    type="button"
                    variant="outline"
                  >
                    Area: {hintPlaces.area}
                  </Button>
                ) : null}
                {hintPlaces.venue ? (
                  <Button
                    className="rounded-full"
                    disabled={disabled}
                    onClick={() => save({ areas: [], kind: "places", venue: hintPlaces.venue })}
                    type="button"
                    variant="outline"
                  >
                    Venue: {hintPlaces.venue}
                  </Button>
                ) : null}
              </CardActions>
            </div>
          ) : null}
          <CardActions>
            <Button data-trigger="enter" disabled={disabled} onClick={() => {
                setEntering(true);
                revealCard(id);
              }} type="button">
              Enter a place
            </Button>
            <Button disabled={disabled} onClick={() => save({ kind: "decide_per_meeting" })} type="button" variant="outline">
              Decide per meeting
            </Button>
          </CardActions>
        </>
      )}
    </StepCard>
  );
}

function PlaceEditor({
  initial,
  onCancel,
  onSave,
  saving,
}: {
  readonly initial: Extract<LocationAnswer, { kind: "places" }> | null;
  readonly onCancel: () => void;
  readonly onSave: (value: LocationAnswer) => void;
  readonly saving: boolean;
}) {
  const [areas, setAreas] = useState<string[]>(initial?.areas.length ? [...initial.areas] : [""]);
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const id = useId();
  const cleanAreas = areas.map((area) => area.trim()).filter(Boolean);
  const cleanVenue = venue.trim();
  const valid = (cleanAreas.length > 0 || cleanVenue.length > 0) && cleanAreas.every((area) => area.length <= 100) && cleanVenue.length <= 200;
  const submit = () => {
    if (valid) onSave({ areas: cleanAreas, kind: "places", venue: cleanVenue || null });
  };

  return (
    <EditorForm label="Enter a place" onSubmit={submit}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Areas (up to 5)</legend>
        {areas.map((area, index) => (
          // Areas have no identity of their own; their position is it.
          // oxlint-disable-next-line react/no-array-index-key
          <div className="flex items-center gap-2" key={index}>
            <Input
              aria-label={`Area ${index + 1}`}
              className="h-11 bg-card text-base md:text-base"
              maxLength={100}
              onChange={(event) => setAreas((current) => current.map((value, at) => (at === index ? event.target.value : value)))}
              placeholder="e.g. Seongsu"
              value={area}
            />
            {areas.length > 1 ? (
              <Button
                aria-label={`Remove area ${index + 1}`}
                onClick={() => setAreas((current) => current.filter((_, at) => at !== index))}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2Icon aria-hidden className="size-4" />
              </Button>
            ) : null}
          </div>
        ))}
        {areas.length < 5 ? (
          <Button className="min-h-9 self-start px-2" onClick={() => setAreas((current) => [...current, ""])} type="button" variant="ghost">
            <PlusIcon aria-hidden />
            Add an area
          </Button>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor={`${id}-venue`}>
          Venue (optional)
        </label>
        <Input
          aria-describedby={`${id}-hint`}
          className="h-11 bg-card text-base md:text-base"
          id={`${id}-venue`}
          maxLength={200}
          onChange={(event) => setVenue(event.target.value)}
          placeholder="e.g. a café you like"
          value={venue}
        />
      </div>
      <p className="text-sm text-muted-foreground" id={`${id}-hint`}>
        Name an area or a venue. Home and work addresses are never guessed.
      </p>
      <CardActions>
        <Button disabled={!valid || saving} onClick={submit} type="button">
          {saving ? "Saving..." : "Save place"}
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </CardActions>
    </EditorForm>
  );
}

export function TransportStep() {
  const id = STEP_CARD_IDS.transport;
  const { answered, proposed } = useAnswer("travelMode");
  const labels = Object.fromEntries(TRAVEL_MODES.map((mode) => [mode, describeTravelMode(mode)])) as Record<TravelMode, string>;
  const current = answered && proposed ? proposed.value : null;

  return (
    <StepCard step="transport" title="How do you usually get to meetings?">
      {proposed ? (
        <YouSaid field="travelMode" id={id}>
          {describeTravelMode(proposed.value)}
        </YouSaid>
      ) : null}
      <AnswerChoices current={current} field="travelMode" id={id} labels={labels} options={TRAVEL_MODES} />
    </StepCard>
  );
}
