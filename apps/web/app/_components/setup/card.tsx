"use client";

import type { ValueSource } from "@lib/contracts/setup";
import { AlertCircleIcon, InfoIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sourceBadgeText } from "./format";
import { useSetup } from "./setup-context";

// The shell every setup card shares: one small open card at a time, a labeled
// section whose heading (one question) takes focus when the step changes, a
// quiet eyebrow label, and the notice for an action taken on this card (a stale
// revision, a refusal or an uncertain save). A long card (the weekly windows
// editor, the review) scrolls inside itself with its actions kept in view.
// Answered cards leave the bottom and stay above as receipts (receipt.tsx).

export function cardHeadingId(id: string) {
  return `${id}-heading`;
}

// Moves focus to a card's heading, as after a step change or when an editor's
// trigger is gone after saving.
export function focusCard(id: string) {
  window.requestAnimationFrame(() => {
    const heading = document.getElementById(cardHeadingId(id));
    heading?.focus({ preventScroll: true });
    heading?.closest("[data-setup-card]")?.scrollIntoView({ block: "nearest" });
  });
}

// Brings a card that just grew (an editor opened) fully into view.
export function revealCard(id: string) {
  window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "nearest" }));
}

// Returns focus to the control that opened an editor, found again by its
// data-trigger name because the editor replaced it while open; then to the
// first alternative present; then to the card's heading.
export function focusTrigger(cardId: string, ...triggers: string[]) {
  window.requestAnimationFrame(() => {
    const card = document.getElementById(cardId);
    for (const trigger of triggers) {
      const element = card?.querySelector<HTMLElement>(`[data-trigger="${trigger}"]:not(:disabled)`);
      if (element) {
        element.focus();
        return;
      }
    }
    focusCard(cardId);
  });
}

export function SetupCard({
  children,
  className,
  description,
  label,
  progress,
  scroll = false,
  id,
  title,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  // A short eyebrow above the question, such as "Review".
  readonly label?: string;
  // How far along the steps this card is, from 0 to 1, drawn as a hairline.
  readonly progress?: number;
  readonly scroll?: boolean;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <section
      aria-labelledby={cardHeadingId(id)}
      className={cn(
        "setup-card-enter relative flex min-w-0 scroll-mt-4 scroll-mb-4 flex-col overflow-hidden rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground",
        scroll && "max-h-[var(--setup-card-room,calc(100dvh-16rem))] pb-0",
        className,
      )}
      data-setup-card={id}
      id={id}
    >
      {progress !== undefined ? <CardProgress value={progress} /> : null}
      <div className="flex shrink-0 flex-col gap-0.5">
        {label ? <p className="min-h-6 text-xs leading-6 font-medium text-muted-foreground tabular-nums">{label}</p> : null}
        <h3 className={HEADING_CLASS} id={cardHeadingId(id)} tabIndex={-1}>
          {title}
        </h3>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className={cn("flex min-w-0 flex-col gap-3 pt-2.5", scroll && "-mx-4 min-h-0 overflow-y-auto px-4")}>
        <CardNotice anchor={id} />
        {children}
      </div>
    </section>
  );
}

export const HEADING_CLASS = "text-base leading-snug font-semibold text-foreground outline-none";

// How far along setup this card is, as a hairline across its top edge. The
// step label carries the same information as text.
export function CardProgress({ value }: { readonly value: number }) {
  return (
    <Progress
      aria-hidden
      className="absolute inset-x-0 top-0 h-0.5 rounded-none bg-secondary *:data-[slot=progress-indicator]:bg-botanical"
      tabIndex={-1}
      value={Math.round(Math.min(1, Math.max(0, value)) * 100)}
    />
  );
}

export function CardNotice({ anchor }: { readonly anchor: string }) {
  const { busy, dismissNotice, notice, retry } = useSetup();

  if (!notice || notice.anchor !== anchor) return null;

  const Icon = notice.tone === "error" ? AlertCircleIcon : InfoIcon;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        notice.tone === "error" ? "border-destructive/40 text-foreground" : "border-input bg-secondary text-foreground",
      )}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", notice.tone === "error" ? "text-destructive" : "text-primary")} />
      <p className="min-w-0 flex-1">{notice.message}</p>
      {notice.canRetry ? (
        <Button className="min-h-9" disabled={busy !== null} onClick={() => void retry()} size="sm" type="button" variant="outline">
          <RotateCcwIcon aria-hidden />
          Try again
        </Button>
      ) : null}
      <Button aria-label="Dismiss" className="-my-2 -mr-2" onClick={dismissNotice} size="icon-sm" type="button" variant="ghost">
        <XIcon aria-hidden className="size-4" />
      </Button>
    </div>
  );
}

const BADGE_TONE: Readonly<Record<ValueSource, string>> = {
  inferred: "border-input bg-card text-foreground",
  starter_default: "border-border bg-muted text-muted-foreground",
  stated: "border-success/50 bg-card text-success",
};

export function SourceBadge({ sampleSize, source }: { readonly source: ValueSource; readonly sampleSize?: number | null }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE_TONE[source],
      )}
    >
      {sourceBadgeText(source, sampleSize)}
    </span>
  );
}

// A row of card actions that wraps on narrow screens. `sticky` keeps it at the bottom of a card that scrolls inside itself.
export function CardActions({
  children,
  className,
  sticky = false,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        sticky && "sticky bottom-0 z-10 -mx-4 mt-auto border-t border-border bg-card px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

// A quiet secondary action beside the primary ones, such as Skip for now.
export function QuietButton({
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button className={cn("min-h-9 px-2 text-muted-foreground hover:text-foreground", className)} type="button" variant="ghost" {...props}>
      {children}
    </Button>
  );
}

export function FieldError({ children, id }: { readonly children?: ReactNode; readonly id: string }) {
  if (!children) return null;
  return (
    <p className="text-sm text-destructive" id={id}>
      {children}
    </p>
  );
}

export function SavingStatus({ anchor, label = "Saving..." }: { readonly anchor: string; readonly label?: string }) {
  const { busy } = useSetup();
  return busy === anchor ? (
    <span className="text-sm text-muted-foreground" role="status">
      {label}
    </span>
  ) : null;
}

// An editor inside a step. Steps live in the Questionnaire's form, so an editor
// is a labeled form region rather than a nested form: Enter in one of its text
// fields saves, and its save button calls `onSubmit` directly.
export function EditorForm({
  children,
  className,
  label,
  onSubmit,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
  readonly onSubmit: () => void;
}) {
  return (
    <div
      aria-label={label}
      className={cn("flex flex-col gap-3", className)}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.key !== "Enter" || !(target instanceof HTMLInputElement) || target.type === "checkbox") return;
        // Also keeps the Questionnaire from treating Enter as navigation.
        event.preventDefault();
        onSubmit();
      }}
      role="form"
    >
      {children}
    </div>
  );
}
