import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The guest thread's conversation card (DESIGN.md: conversation card): placed in
// the thread after the message that calls for it, one question as a 16px
// heading, a short reason, then actions, in 16px by 12px padding. It is the
// setup card's shell without the host setup controller.

export function guestCardHeadingId(id: string) {
  return `${id}-heading`;
}

export function GuestCard({
  children,
  className,
  description,
  id,
  label,
  title,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly id: string;
  readonly label?: string;
  readonly title: string;
}) {
  return (
    <section
      aria-labelledby={guestCardHeadingId(id)}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground",
        className,
      )}
      data-guest-card={id}
      id={id}
    >
      <div className="flex flex-col gap-0.5">
        {label ? <p className="min-h-6 text-xs leading-6 font-medium text-muted-foreground">{label}</p> : null}
        <h3 className="text-base leading-snug font-semibold text-foreground outline-none" id={guestCardHeadingId(id)} tabIndex={-1}>
          {title}
        </h3>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3 pt-2.5">{children}</div>
    </section>
  );
}

export function GuestCardActions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

// An answered or superseded card, kept in the thread where it was called for
// as one quiet line (DESIGN.md: conversation card receipts): what was offered
// and chosen, or **Out of date** with a way to the current card of its kind.
export function GuestReceipt({
  action,
  id,
  label,
  outOfDate = false,
  value,
}: {
  readonly action?: ReactNode;
  readonly id: string;
  readonly label: string;
  readonly outOfDate?: boolean;
  readonly value?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm"
      data-guest-card={id}
      data-guest-receipt={outOfDate ? "out-of-date" : "answered"}
      id={`receipt-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
      role="note"
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {value ? <span className={cn("min-w-0 break-words", outOfDate && "text-muted-foreground line-through")}>{value}</span> : null}
      {outOfDate ? (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">Out of date</span>
      ) : null}
      {action}
    </div>
  );
}
