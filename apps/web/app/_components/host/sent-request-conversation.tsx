"use client";

import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import { useEffect, useMemo, useState } from "react";
import { projectMessages } from "@/app/_components/guest/guest-conversation";
import { AgentMessage } from "@/components/chat/message";
import { readNdjson } from "@/lib/chat/guest";

// A sent request's own conversation in the Requests list, read only, once the
// request is no longer open (guest-account-history D2). It is the guest
// conversation the account had on the request page, kept for as long as the
// account exists; nothing can be sent from here.
export function SentRequestConversation({ bookingPath, requestId }: { readonly bookingPath: string | null; readonly requestId: string }) {
  const [events, setEvents] = useState<DiscussionEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/host/workspace-requests/${requestId}/conversation?cursor=0`, { cache: "no-store", signal: controller.signal });
        const collected: DiscussionEvent[] = [];
        for await (const event of readNdjson(response)) collected.push(event);
        setEvents(collected);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [requestId]);

  const messages = useMemo(() => (events ? projectMessages(events) : []), [events]);

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border px-5 pt-4 pb-5 text-sm sm:px-6" id={`request-panel-${requestId}`} role="region">
      {failed ? <p role="alert">This conversation is unavailable right now. Try again later.</p> : null}
      {!failed && events === null ? (
        <p className="text-muted-foreground" role="status">
          Loading the conversation...
        </p>
      ) : null}
      {events && messages.length === 0 ? <p className="text-muted-foreground">No messages in this conversation.</p> : null}
      {messages.length > 0 ? (
        <div aria-label="Your conversation, read only" className="flex flex-col gap-2" role="log">
          {messages.map((message) => (
            <AgentMessage canRespond={false} isStreaming={false} key={message.id} message={message} onInputResponses={() => {}} />
          ))}
        </div>
      ) : null}
      {bookingPath ? (
        <a className="w-fit font-medium text-primary underline-offset-4 hover:underline" href={bookingPath}>
          Open the request page
        </a>
      ) : null}
    </div>
  );
}
