"use client";

import type { BookingReceipt } from "@lib/contracts/booking";
import type { RequesterView } from "@lib/contracts/requester-view";
import { useCallback, useMemo, useState } from "react";
import { Receipt } from "@/app/_components/booking-receipt";
import { ClosedImessageUpdates } from "@/app/_components/requester/cards";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import type { ChatRequestError } from "@/lib/chat/discussion";
import { guestDiscussionClient } from "@/lib/chat/guest";
import { GuestConversation, type ThreadEntry } from "./guest-conversation";
import { GuestFrame, openingMessages, RequestPanel } from "./guest-frame";
import { AuthoredMessages } from "@/app/_components/setup/authored-messages";

// A booked meeting's page keeps the guest's conversation with Thyme
// (post-booking-changes; #329): the earlier conversation, then the confirmed
// receipt where the thread stands now, and an open composer. A guest who linked
// no messenger can ask about the meeting, cancel it or start a change in words
// here; the assistant asks once and cancels or reopens only after a clear yes.
// When a turn settles the page reads the request again: a cancelled meeting
// shows its closed status, and a change reopens the usual guest workspace.

// Thyme's line above the receipt.
export function bookedLine(hostName: string) {
  return `Your meeting with ${hostName} is booked. If you need to move it, change where it happens or cancel it, tell me here.`;
}

export function BookedWorkspace({
  bookingId,
  host,
  receipt,
  timezone,
  workspaceLink = false,
}: {
  readonly bookingId: string;
  readonly host: { readonly displayName: string; readonly handle: string | null };
  readonly receipt: BookingReceipt | null;
  readonly timezone: string;
  readonly workspaceLink?: boolean;
}) {
  const client = useMemo(() => guestDiscussionClient(bookingId), [bookingId]);
  // The receipt sits where the thread stands when the page opens: after the
  // earlier conversation, before anything written now.
  const [openedAt] = useState(() => new Date().toISOString());

  // The request changed state (cancelled, or reopened for a change): the
  // booking page shows it as it now is.
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${bookingId}/state`, { cache: "no-store" });
      const next = (await response.json()) as RequesterView;
      if (!response.ok || next.open || next.request.state !== "booked") window.location.reload();
    } catch {
      // The page keeps its last view; the next turn reads it again.
    }
  }, [bookingId]);

  const onError = useCallback(
    (error: unknown) => {
      const code = (error as ChatRequestError).code;
      if (code === "unavailable" || code === "closed") void refresh();
    },
    [refresh],
  );

  const entries: ThreadEntry[] = useMemo(
    () => [{ at: openedAt, id: "booked", node: <BookedCard hostName={host.displayName} receipt={receipt} timezone={timezone} /> }],
    [host.displayName, openedAt, receipt, timezone],
  );

  const aside = (
    <RequestPanel
      host={host}
      note={
        <>
          This conversation is private to you: anyone with its link can act on this meeting, so keep the link to yourself.{" "}
          <a className="underline underline-offset-4" href="/privacy">
            How we handle your data
          </a>
        </>
      }
      timezone={<p className="px-1 text-sm text-muted-foreground">Times are shown in {timezone}.</p>}
    >
      {receipt ? (
        <section aria-label="Booking" className="flex flex-col gap-2 py-2 text-sm">
          <Receipt receipt={receipt} timeZone={timezone} />
        </section>
      ) : null}
      <ClosedImessageUpdates bookingId={bookingId} timezone={timezone} />
    </RequestPanel>
  );

  return (
    <GuestFrame aside={aside} asideLabel={`Meeting with ${host.displayName}`} workspaceLink={workspaceLink}>
      <GuestConversation
        ariaLabel={`Meeting with ${host.displayName}`}
        before={<AuthoredMessages messages={openingMessages(host.displayName)} />}
        client={client}
        entries={entries}
        onError={onError}
        onRecover={async (generation) => {
          const response = await fetch(`/api/requests/${bookingId}/recover`, {
            body: JSON.stringify({ observedGeneration: generation }),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          return (await response.json()) as { status: string; delivered?: boolean };
        }}
        onSettled={() => void refresh()}
        placeholder="Write to Thyme"
      />
    </GuestFrame>
  );
}

// The booked meeting in the thread: Thyme's line and the confirmed receipt.
export function BookedCard({
  hostName,
  receipt,
  timezone,
}: {
  readonly hostName: string;
  readonly receipt: BookingReceipt | null;
  readonly timezone: string;
}) {
  return (
    <article className="w-full min-w-0" data-guest-card="booked">
      <Message>
        <MessageContent className="gap-1.5 text-base leading-[1.65] text-foreground">
          <MessageHeader>Thyme</MessageHeader>
          <p className="px-3 break-words" role="status">
            {bookedLine(hostName)}
          </p>
          {receipt ? (
            <section aria-label="Booking" className="mx-3 rounded-3xl bg-card px-5 py-4 text-sm">
              <Receipt receipt={receipt} timeZone={timezone} />
            </section>
          ) : null}
        </MessageContent>
      </Message>
    </article>
  );
}
