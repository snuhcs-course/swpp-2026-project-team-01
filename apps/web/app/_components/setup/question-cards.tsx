"use client";

import {
  type LocationAnswer,
  MEETING_MODES,
  type MeetingMode,
  type SetupFieldName,
  TRAVEL_MODES,
  type TravelMode,
} from "@lib/contracts/setup";
import { CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardActions, focusTrigger, SetupCard, SourceBadge } from "./card";
import { describeLocation, describeTravelMode, formatMinutes, MEETING_MODE_LABELS, parseMinutes } from "./format";
import { useSetup } from "./setup-context";
import { MinutesInput } from "./suggestion-cards";

// Mode, location and transport (H7). These are the host's own answers and count
// only once accepted on a card: every choice is saved as Choose my own, and a
// value the assistant recorded from the conversation shows as "You said" with
// **Use this**, never preselected. Online hides the in-person questions.

export const QUESTION_CARD_IDS = {
  location: "setup-location",
  mode: "setup-mode",
  transport: "setup-transport",
  travelBuffer: "setup-travel-buffer",
} as const;

// Whether a field holds the host's answer: accepted on a card.
function useAnswer<F extends SetupFieldName>(field: F) {
  const { state } = useSetup();
  const proposed = state.fields[field].proposed;
  return { answered: proposed?.accepted ?? false, proposed };
}

function useAnswerAction(id: string) {
  const { run, state } = useSetup();
  return async (field: SetupFieldName, value: unknown) =>
    run(id, [
      {
        expectedRevision: state.draft.revision,
        input: { action: "choose_own", field, value },
        operation: "setup.update_draft",
      },
    ]);
}

export function answeredMode(state: ReturnType<typeof useSetup>["state"]): MeetingMode | null {
  const proposed = state.fields.meetingMode.proposed;
  return proposed?.accepted ? proposed.value : null;
}

// What the host told the assistant, recorded but not yet an answer: shown as
// "You said" with Use this, which accepts exactly the value shown.
function YouSaid({ children, field, id }: { readonly children: ReactNode; readonly field: SetupFieldName; readonly id: string }) {
  const { busy, run, state } = useSetup();
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
    if (saved) focusTrigger(id, "change");
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-secondary/60 p-3">
      <p className="min-w-0 flex-1 text-sm break-words">
        <span className="font-medium">You said:</span> {children}
      </p>
      <Button data-trigger="use" disabled={busy !== null} onClick={() => void use()} type="button">
        {busy === id ? "Saving..." : "Use this"}
      </Button>
    </div>
  );
}

// A one-line answer with a Change button that reopens the choices.
function AnsweredLine({ children, label, onChange }: { readonly children: ReactNode; readonly label: string; readonly onChange: () => void }) {
  const { busy } = useSetup();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <CheckIcon aria-hidden className="size-4 shrink-0 text-success" />
      <p className="min-w-0 flex-1 break-words">
        <span className="sr-only">Your answer: </span>
        {children}
      </p>
      <Button aria-label={`Change ${label}`} data-trigger="change" disabled={busy !== null} onClick={onChange} type="button" variant="outline">
        Change
      </Button>
    </div>
  );
}

// Reopening an answered question; closing returns focus to its Change button.
function useReopen(id: string) {
  const [open, setOpen] = useState(false);
  return {
    close() {
      setOpen(false);
      focusTrigger(id, "change");
    },
    open,
    reopen() {
      setOpen(true);
    },
  };
}

function ChoiceButtons<T extends string>({
  current,
  labels,
  onChoose,
  options,
}: {
  readonly current: T | null;
  readonly labels: Readonly<Record<T, string>>;
  readonly onChoose: (value: T) => void;
  readonly options: readonly T[];
}) {
  const { busy } = useSetup();
  return (
    <CardActions>
      {options.map((option) => (
        <Button
          aria-pressed={current === option}
          disabled={busy !== null}
          key={option}
          onClick={() => onChoose(option)}
          type="button"
          variant={current === option ? "default" : "outline"}
        >
          {labels[option]}
        </Button>
      ))}
    </CardActions>
  );
}

export function ModeCard() {
  const id = QUESTION_CARD_IDS.mode;
  const { answered, proposed } = useAnswer("meetingMode");
  const answer = useAnswerAction(id);
  const reopen = useReopen(id);

  const choose = async (mode: MeetingMode) => {
    if (await answer("meetingMode", mode)) reopen.close();
  };

  return (
    <SetupCard eyebrow="Meeting style" id={id} title="Do you prefer online meetings, in-person meetings, or either?">
      {answered && proposed && !reopen.open ? (
        <AnsweredLine label="meeting style" onChange={reopen.reopen}>
          {MEETING_MODE_LABELS[proposed.value]}
        </AnsweredLine>
      ) : (
        <>
          {proposed ? (
            <YouSaid field="meetingMode" id={id}>
              {MEETING_MODE_LABELS[proposed.value]}
            </YouSaid>
          ) : null}
          <ChoiceButtons
            current={answered && proposed ? proposed.value : null}
            labels={MEETING_MODE_LABELS}
            onChoose={(mode) => void choose(mode)}
            options={MEETING_MODES}
          />
        </>
      )}
    </SetupCard>
  );
}

export function LocationCard() {
  const id = QUESTION_CARD_IDS.location;
  const { state, busy } = useSetup();
  const { answered, proposed } = useAnswer("location");
  const answer = useAnswerAction(id);
  const reopen = useReopen(id);
  const [entering, setEntering] = useState(false);
  const hint = state.placeHint;
  const hintPlaces = hint && (hint.area || hint.venue) ? hint : null;

  const save = async (value: LocationAnswer) => {
    if (await answer("location", value)) {
      setEntering(false);
      reopen.close();
    }
  };

  return (
    <SetupCard eyebrow="Meeting style" id={id} title="Where do you prefer to meet?">
      {answered && proposed && !reopen.open && !entering ? (
        <AnsweredLine label="where you meet" onChange={reopen.reopen}>
          {describeLocation(proposed.value)}
        </AnsweredLine>
      ) : entering ? (
        <PlaceEditor
          initial={proposed?.value.kind === "places" ? proposed.value : null}
          onCancel={() => {
            setEntering(false);
            focusTrigger(id, "enter", "change");
          }}
          onSave={(value) => void save(value)}
          saving={busy === id}
        />
      ) : (
        <>
          {proposed ? (
            <YouSaid field="location" id={id}>
              {describeLocation(proposed.value)}
            </YouSaid>
          ) : null}
          {hintPlaces ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/60 p-3">
              <p className="text-sm">
                <span className="font-medium">Suggested from your calendar</span>
                <span className="text-muted-foreground">
                  {" "}
                  · most frequent in {hintPlaces.sampleSize} in-person meeting{hintPlaces.sampleSize === 1 ? "" : "s"}. Nothing
                  is saved until you choose.
                </span>
              </p>
              <CardActions>
                {hintPlaces.area ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => void save({ areas: [hintPlaces.area!], kind: "places", venue: null })}
                    type="button"
                    variant="outline"
                  >
                    Area: {hintPlaces.area}
                  </Button>
                ) : null}
                {hintPlaces.venue ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => void save({ areas: [], kind: "places", venue: hintPlaces.venue })}
                    type="button"
                    variant="outline"
                  >
                    Venue: {hintPlaces.venue}
                  </Button>
                ) : null}
                {hintPlaces.area && hintPlaces.venue ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => void save({ areas: [hintPlaces.area!], kind: "places", venue: hintPlaces.venue })}
                    type="button"
                    variant="outline"
                  >
                    Use both
                  </Button>
                ) : null}
              </CardActions>
            </div>
          ) : null}
          <CardActions>
            <Button data-trigger="enter" disabled={busy !== null} onClick={() => setEntering(true)} type="button">
              Enter a place
            </Button>
            <Button disabled={busy !== null} onClick={() => void save({ kind: "decide_per_meeting" })} type="button" variant="outline">
              Decide per meeting
            </Button>
          </CardActions>
        </>
      )}
    </SetupCard>
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

  return (
    <form
      aria-label="Enter a place"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave({ areas: cleanAreas, kind: "places", venue: cleanVenue || null });
      }}
    >
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
          <Button className="self-start" onClick={() => setAreas((current) => [...current, ""])} type="button" variant="ghost">
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
          className="h-11 bg-card text-base md:text-base"
          id={`${id}-venue`}
          maxLength={200}
          onChange={(event) => setVenue(event.target.value)}
          placeholder="e.g. a café you like"
          value={venue}
        />
      </div>
      <p className="text-sm text-muted-foreground">Name at least one area or a venue. Home and work addresses are never guessed.</p>
      <CardActions>
        <Button disabled={!valid || saving} type="submit">
          {saving ? "Saving..." : "Save place"}
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </CardActions>
    </form>
  );
}

export function TransportCard() {
  const id = QUESTION_CARD_IDS.transport;
  const { answered, proposed } = useAnswer("travelMode");
  const answer = useAnswerAction(id);
  const reopen = useReopen(id);
  const labels = Object.fromEntries(TRAVEL_MODES.map((mode) => [mode, describeTravelMode(mode)])) as Record<TravelMode, string>;

  return (
    <SetupCard eyebrow="Meeting style" id={id} title="How do you usually get to meetings?">
      {answered && proposed && !reopen.open ? (
        <AnsweredLine label="how you travel" onChange={reopen.reopen}>
          {describeTravelMode(proposed.value)}
        </AnsweredLine>
      ) : (
        <>
          {proposed ? (
            <YouSaid field="travelMode" id={id}>
              {describeTravelMode(proposed.value)}
            </YouSaid>
          ) : null}
          <ChoiceButtons
            current={answered && proposed ? proposed.value : null}
            labels={labels}
            onChoose={(mode) =>
              void answer("travelMode", mode).then((ok) => {
                if (ok) reopen.close();
              })
            }
            options={TRAVEL_MODES}
          />
        </>
      )}
    </SetupCard>
  );
}

export function TravelBufferCard() {
  const id = QUESTION_CARD_IDS.travelBuffer;
  const { busy } = useSetup();
  const { answered, proposed } = useAnswer("travelBufferMinutes");
  const answer = useAnswerAction(id);
  const reopen = useReopen(id);
  const [raw, setRaw] = useState(proposed ? String(proposed.value) : "15");
  const inputId = useId();
  const minutes = parseMinutes(raw, 0, 180);

  return (
    <SetupCard eyebrow="Meeting style" id={id} title="How much extra time should I leave around travel?">
      {answered && proposed && !reopen.open ? (
        <AnsweredLine label="travel buffer" onChange={reopen.reopen}>
          {formatMinutes(proposed.value)} around travel
        </AnsweredLine>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (minutes !== null) {
              void answer("travelBufferMinutes", minutes).then((ok) => {
                if (ok) reopen.close();
              });
            }
          }}
        >
          {proposed ? (
            <div className="flex flex-col gap-1">
              <SourceBadge sampleSize={proposed.sampleSize} source={proposed.source} />
              {proposed.reason ? <p className="text-sm text-muted-foreground">{proposed.reason}</p> : null}
            </div>
          ) : null}
          <MinutesInput describedBy={`${inputId}-hint`} id={inputId} label="Extra travel time" max={180} min={0} onChange={setRaw} value={raw} />
          <p className="text-sm text-muted-foreground" id={`${inputId}-hint`}>
            Added before and after an in-person meeting, 0 to 180 minutes.
          </p>
          <CardActions>
            <Button disabled={minutes === null || busy !== null} type="submit">
              {busy === id ? "Saving..." : "Save travel buffer"}
            </Button>
          </CardActions>
        </form>
      )}
    </SetupCard>
  );
}
