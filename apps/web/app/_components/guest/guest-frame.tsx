"use client";

import { type ReactNode, useState } from "react";
import { Brand, InkStage } from "@/app/_components/ink/chrome";
import { cn } from "@/lib/utils";

// The composer's words until the fixed steps hand over to Thyme (U9): the
// composer is always there, closed until then.
export const COMPOSER_LOCKED = "Finish the step above, then you can write to Thyme here";

// The two fixed messages the web chat opens with (U7, U8). The booking page
// keeps them at the top of the thread, so the conversation reads on from the
// web start.
export function openingMessages(hostName: string) {
  return [
    { id: "greeting", text: `Hi, I'm Thyme, ${hostName}'s scheduling assistant. I'll help you book a meeting with ${hostName}.` },
    {
      id: "google",
      text: "For a quick and exact booking, continue with your Google account and Calendar: your name and email come from Google, and I check your calendar privately so I only offer times you're free. You can also continue without Google.",
    },
  ];
}

// The request panel's content on the web start and the booking page alike:
// whose request it is, the timezone, the answered steps when there are any,
// and a note on privacy.
export function RequestPanel({
  children,
  host,
  note,
  timezone,
}: {
  readonly children?: ReactNode;
  readonly host: { readonly displayName: string; readonly handle: string | null };
  readonly note: ReactNode;
  readonly timezone: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <p className="font-medium text-muted-foreground text-sm">Meeting request with</p>
        <h2 className="break-words font-display text-[40px] leading-[1.05]">{host.displayName}</h2>
        {host.handle ? <p className="font-mono text-muted-foreground text-sm">@{host.handle}</p> : null}
      </section>
      {timezone}
      {children ? <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">{children}</div> : null}
      <p className="px-1 text-muted-foreground text-xs">{note}</p>
    </div>
  );
}

// The frame of the guest's web chat (guest-flow-completion U7, U12): the same
// ink stage and top bar as the booking-link landing and the host's onboarding
// screens, with the conversation filling the rest of the viewport. The request
// panel, when there is one, stays closed: **Request details** in the top bar
// opens it over the right side of the conversation (over all of it on a phone)
// and closes it again.
export function GuestFrame({
  aside,
  asideLabel,
  children,
}: {
  readonly aside?: ReactNode;
  readonly asideLabel?: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <InkStage locale="en">
      <div className="chat-frame">
        <header className="top">
          <Brand />
          {aside ? (
            <button aria-controls="request-panel" aria-expanded={open} className="secondary-btn" onClick={() => setOpen((value) => !value)} type="button">
              {open ? "Close details" : "Request details"}
            </button>
          ) : null}
        </header>
        <div className="relative flex min-h-0 flex-1">
          <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", open && "max-sm:invisible")}>{children}</div>
          {aside && open ? (
            <aside
              aria-label={asideLabel}
              className="absolute inset-y-0 right-0 z-20 w-full overflow-y-auto bg-secondary px-5 pt-4 pb-6 shadow-[var(--float-shadow)] sm:w-96 sm:rounded-l-3xl"
              id="request-panel"
            >
              {aside}
            </aside>
          ) : null}
        </div>
      </div>
    </InkStage>
  );
}
