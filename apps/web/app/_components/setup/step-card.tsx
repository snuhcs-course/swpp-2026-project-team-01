"use client";

import type { ReactNode } from "react";
import {
  Questionnaire,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { cn } from "@/lib/utils";
import { BackButton, CardNotice, CardProgress, cardHeadingId, HEADING_CLASS } from "./card";
import { useStepper } from "./setup-context";
import { STEP_CARD_IDS, type StepId } from "./steps";

// A step of setup, on the shadcn/ui Questionnaire: the steps are its items in
// order, the stepper controls which one is active, and only that one renders,
// as one question with its progress and Back. Questionnaire's own navigation
// (Back, arrow keys) asks the stepper to move rather than moving by itself, so
// the server-derived order and the Skip and Edit rules stay in one place.
export function StepCard({
  children,
  description,
  multiple,
  scroll,
  step,
  title,
}: {
  readonly children?: ReactNode;
  readonly description?: ReactNode;
  // The step's choices are checkboxes rather than radios.
  readonly multiple?: boolean;
  readonly scroll?: boolean;
  readonly step: StepId;
  readonly title: string;
}) {
  const stepper = useStepper();
  const total = stepper.steps.length;
  const position = stepper.steps.indexOf(step) + 1;
  const id = STEP_CARD_IDS[step];
  // Questionnaire's Back shows from the second step; the first one still has a
  // way back while editing from the review or before Calendar is connected.
  const ownBack = position <= 1 && stepper.canGoBack;

  const onItemChange = (requested: string) => {
    const index = stepper.steps.indexOf(requested as StepId) + 1;
    if (index > 0 && index < position) stepper.back();
    else if (index > position) stepper.forward();
  };

  return (
    <section
      aria-labelledby={cardHeadingId(id)}
      className={cn(
        "setup-card-enter relative flex min-w-0 scroll-mt-4 scroll-mb-4 flex-col rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground",
        // A long editor scrolls the whole card (a fieldset does not shrink in a
        // flex column), with its save row sticky at the bottom.
        scroll ? "max-h-[var(--setup-card-room,calc(100dvh-16rem))] overflow-y-auto pb-0" : "overflow-hidden",
      )}
      data-setup-card={id}
      id={id}
    >
      {position > 0 ? <CardProgress value={(position - 1) / total} /> : null}
      <Questionnaire
        className="gap-0"
        item={step}
        items={stepper.steps.map((name) => ({ name }))}
        // Every card action is its own button; nothing submits the questionnaire.
        onItemChange={onItemChange}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="-mt-1 flex min-h-7 items-center justify-between gap-2">
          {ownBack ? (
            <BackButton onClick={stepper.back} />
          ) : (
            <QuestionnairePrevious
              className="-ml-2 min-h-9 gap-1 px-2 text-muted-foreground hover:text-foreground data-hidden:invisible sm:min-h-9"
              data-trigger="back"
              variant="ghost"
            >
              Back
            </QuestionnairePrevious>
          )}
          {position > 0 ? (
            <QuestionnaireProgress aria-label="Setup progress" className="min-w-0 text-right">
              Step {position} of {total}
            </QuestionnaireProgress>
          ) : null}
        </div>
        <QuestionnaireItem aria-labelledby={cardHeadingId(id)} className="gap-0" multiple={multiple} name={step}>
          <QuestionnaireTitle className={cn(HEADING_CLASS, "mb-0!")} render={<h3 id={cardHeadingId(id)} tabIndex={-1} />}>
            {title}
          </QuestionnaireTitle>
          {description ? <QuestionnaireDescription className="mt-0.5">{description}</QuestionnaireDescription> : null}
          <div className="flex min-w-0 flex-col gap-3 pt-2.5">
            <CardNotice anchor={id} />
            {children}
          </div>
        </QuestionnaireItem>
      </Questionnaire>
    </section>
  );
}
