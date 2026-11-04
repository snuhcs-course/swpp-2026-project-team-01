import type { ReactNode } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";

// The guest thread's conversation card (DESIGN.md: conversation card): placed in
// the thread after the message that calls for it, one question as a serif
// heading, a short reason, then actions, on a white 24px board. It is the
// setup card's shell without the host setup controller.

export const GUEST_CARD_SURFACE = "mx-auto my-3 w-[94%] max-w-xl rounded-3xl bg-card px-5 py-5 text-sm text-card-foreground sm:px-6";

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
        "flex min-w-0 flex-col", GUEST_CARD_SURFACE,
        className,
      )}
      data-guest-card={id}
      id={id}
    >
      <div className="flex flex-col gap-0.5">
        {label ? <p className="min-h-6 text-xs leading-6 font-semibold text-primary">{label}</p> : null}
        <h3 className="font-display text-[26px] leading-[1.15] text-foreground outline-none" id={guestCardHeadingId(id)} tabIndex={-1}>
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

// An answered card, kept in the thread where it was called for as the guest's
// own reply (guest-flow-completion U12): a bubble on the guest's side, like a
// message they wrote, with what was chosen and its **Change** under it.
export function GuestReceipt({
  action,
  id,
  label,
  value,
}: {
  readonly action?: ReactNode;
  readonly id: string;
  readonly label: string;
  readonly value?: ReactNode;
}) {
  return (
    <Message align="end">
      <MessageContent>
        <p className="sr-only">You</p>
        <Bubble align="end" className="max-w-[85%]" variant="me">
          <BubbleContent className="rounded-2xl rounded-br-[6px] px-4 text-base leading-[1.55]">
            <div
              className="flex min-w-0 flex-col"
              data-guest-card={id}
              data-guest-receipt="answered"
              id={`receipt-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
              role="note"
            >
              {label ? <span className="text-muted-foreground text-xs">{label}</span> : null}
              {value ? <span className="min-w-0 break-words">{value}</span> : null}
            </div>
          </BubbleContent>
        </Bubble>
        {action ? <div className="self-end">{action}</div> : null}
      </MessageContent>
    </Message>
  );
}
