"use client";

import type { ReactNode } from "react";
import {
  Questionnaire,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireProgress,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { cn } from "@/lib/utils";
import { CardNotice, CardProgress, cardHeadingId, HEADING_CLASS, QuietButton } from "./card";
import { useStepper } from "./setup-context";
import { STEP_CARD_IDS, type StepId } from "./steps";

// A step of setup, on the shadcn/ui Questionnaire: the open step is its one
// item, rendered as one question with a quiet progress hint in its eyebrow. There is no Back: an answered step collapses into a
// receipt in the conversation, and Edit on the receipt asks it again here. The
// Questionnaire's own navigation never moves the step, so the server-derived
// order and the Skip and Edit rules stay in one place (useStepper).
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
      data-setup-editing={stepper.editing ? "" : undefined}
      id={id}
    >
      {position > 0 ? <CardProgress value={(position - 1) / total} /> : null}
      <Questionnaire
        className="gap-0"
        item={step}
        // Only the open step renders, and the Questionnaire never navigates, so
        // it knows just that one item.
        items={[{ name: step }]}
        // Every card action is its own button; nothing submits or navigates the questionnaire.
        onItemChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex min-h-6 items-center justify-between gap-2">
          {position > 0 ? (
            <QuestionnaireProgress aria-label="Setup progress" className="min-w-0">
              {stepper.editing ? "Changing an answer" : `${position} of ${total}`}
            </QuestionnaireProgress>
          ) : (
            <span />
          )}
          {stepper.early ? (
            <QuietButton className="-mr-2 min-h-8 text-xs" onClick={stepper.leaveEarly}>
              Connect Calendar first
            </QuietButton>
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
