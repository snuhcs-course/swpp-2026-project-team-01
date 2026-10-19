"use client";

import type { ValueSource } from "@lib/contracts/setup";
import { AlertCircleIcon, InfoIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sourceBadgeText } from "./format";
import { useSetup } from "./setup-context";

// The shell every setup card shares: a labeled section whose heading takes focus
// when the step changes, an optional step label, and the notice for an action
// taken on this card (a stale revision, a refusal or an uncertain save).

export function cardHeadingId(id: string) {
  return `${id}-heading`;
}

// Moves focus to a card's heading, as after a step change or when an editor's
// trigger is gone after saving.
export function focusCard(id: string) {
  window.requestAnimationFrame(() => {
    const heading = document.getElementById(cardHeadingId(id));
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "nearest" });
  });
}

// Returns focus to the control that opened an editor, found again by its
// data-trigger name because the editor replaced it while open; then to the
// first alternative present (as Edit after a value is accepted); then to the
// card's heading.
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
  eyebrow,
  footer,
  id,
  title,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly eyebrow?: string;
  readonly footer?: ReactNode;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <section
      aria-labelledby={cardHeadingId(id)}
      className={cn("min-w-0 scroll-mt-4 rounded-xl border border-border bg-card text-card-foreground", className)}
      data-setup-card={id}
      id={id}
    >
      <div className="flex flex-col gap-1 px-4 pt-4 sm:px-5">
        {eyebrow ? (
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span aria-hidden className="h-px w-4 bg-botanical" />
            {eyebrow}
          </p>
        ) : null}
        <h3 className="text-base leading-snug font-semibold outline-none sm:text-lg" id={cardHeadingId(id)} tabIndex={-1}>
          {title}
        </h3>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4 px-4 pt-3 pb-4 sm:px-5">
        <CardNotice anchor={id} />
        {children}
      </div>
      {footer ? <div className="border-t border-border px-4 py-3 sm:px-5">{footer}</div> : null}
    </section>
  );
}

export function CardNotice({ anchor }: { readonly anchor: string }) {
  const { busy, dismissNotice, notice, retry } = useSetup();

  if (!notice || notice.anchor !== anchor) return null;

  const Icon = notice.tone === "error" ? AlertCircleIcon : InfoIcon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm",
        notice.tone === "error" ? "border-destructive/40 text-foreground" : "border-input bg-secondary text-foreground",
      )}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", notice.tone === "error" ? "text-destructive" : "text-primary")} />
      <p className="min-w-0 flex-1">{notice.message}</p>
      {notice.canRetry ? (
        <Button disabled={busy !== null} onClick={() => void retry()} size="sm" type="button" variant="outline">
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

// A row of card actions that wraps on narrow screens.
export function CardActions({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
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
