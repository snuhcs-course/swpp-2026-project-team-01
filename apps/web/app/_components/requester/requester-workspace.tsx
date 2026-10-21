"use client";

import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import type { OpenRequesterView, RequesterView } from "@lib/contracts/requester-view";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GuestConversation, projectMessages } from "@/app/_components/guest/guest-conversation";
import { TimezoneLine, useGuestTimezone } from "@/app/_components/guest/timezone";
import { AgentMessage } from "@/components/chat/message";
import { guestDiscussionClient, readNdjson } from "@/lib/chat/guest";
import { RequesterCards, useRequesterCards } from "./cards";

// The booking page's conversation (design decision 2): the host's public
// identity, the read-only transcript of the public intake the request came from,
// the request conversation with its one open card, and the timezone line. The
// page reads everything through /api/requests/{bookingId}/*; it never calls
// /eve/v1.

const GOOGLE_NOTICES: Readonly<Record<string, string>> = {
  cancelled: "Google sign-in was cancelled. Nothing was changed.",
  connected: "Google is connected for this request.",
};

export function RequesterWorkspace({ bookingId, initial }: { readonly bookingId: string; readonly initial: OpenRequesterView }) {
  const [view, setView] = useState<OpenRequesterView>(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const timezone = useGuestTimezone();
  const client = useMemo(() => guestDiscussionClient(`/api/requests/${bookingId}`), [bookingId]);

  useEffect(() => {
    const google = new URLSearchParams(window.location.search).get("google");
    if (google) {
      setNotice(GOOGLE_NOTICES[google] ?? null);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${bookingId}/state`, { cache: "no-store" });
      const next = (await response.json()) as RequesterView;
      if (!response.ok || !next.open) {
        window.location.reload();
        return;
      }
      setView(next);
    } catch {
      // The cards keep their last view; the next action refreshes again.
    }
  }, [bookingId]);

  const cards = useRequesterCards(bookingId, view, timezone.zone, refresh);

  const before = (
    <div className="flex flex-col gap-4 pb-2">
      <section className="flex flex-col gap-1">
        <p className="font-medium text-muted-foreground text-sm">Meeting request</p>
        <h1 className="break-words font-display text-[clamp(24px,3.5vw,34px)] leading-tight">
          With {view.host.displayName}
        </h1>
        <p className="text-muted-foreground text-sm">
          This page is private to you: anyone with its link can act on this request, so keep the link to yourself.
        </p>
      </section>
      {notice ? (
        <p className="rounded-xl border border-border bg-card p-3 text-sm" role="status">
          {notice}
        </p>
      ) : null}
      {view.hasIntakeTranscript ? <IntakeTranscript bookingId={bookingId} /> : null}
    </div>
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <GuestConversation
        ariaLabel={`Meeting request with ${view.host.displayName}`}
        before={before}
        card={<RequesterCards context={cards} />}
        client={client}
        composerFooter={<TimezoneLine onChoose={timezone.choose} zone={timezone.zone} />}
        onSettled={() => void refresh()}
      />
    </div>
  );
}

// The public intake's transcript, read-only above the request conversation.
function IntakeTranscript({ bookingId }: { readonly bookingId: string }) {
  const [events, setEvents] = useState<DiscussionEvent[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/requests/${bookingId}/intake?cursor=0`, { cache: "no-store", signal: controller.signal });
        const collected: DiscussionEvent[] = [];
        for await (const event of readNdjson(response)) collected.push(event);
        setEvents(collected);
      } catch {
        if (!controller.signal.aborted) setEvents([]);
      }
    })();
    return () => controller.abort();
  }, [bookingId]);

  const messages = useMemo(() => (events ? projectMessages(events) : []), [events]);

  if (!events || messages.length === 0) return null;

  return (
    <details className="rounded-xl border border-border px-4 py-3 text-sm" open>
      <summary className="cursor-pointer font-medium">Your conversation on the public page</summary>
      <div aria-label="Earlier conversation, read only" className="flex flex-col gap-2 pt-3" role="log">
        {messages.map((message) => (
          <AgentMessage canRespond={false} isStreaming={false} key={message.id} message={message} onInputResponses={() => {}} />
        ))}
      </div>
    </details>
  );
}
