"use client";

import { type DiscussionEvent, isRedeliveredInput } from "@lib/contracts/discussion-events";
import { isCurrentTurnBoundaryEvent } from "eve/client";
import { conversationReducer, type EveMessage } from "eve/react";
import { AlertCircleIcon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat/composer";
import { ChatConversation, ChatConversationContent, ChatItem, ChatScrollButton } from "@/components/chat/conversation";
import { AgentMessage, AgentThinking } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import { ChatRequestError, type DiscussionStatus } from "@/lib/chat/discussion";
import type { GuestDiscussionClient } from "@/lib/chat/guest";

// The conversation column of the public intake page and the booking page,
// following the host workspace (host-workspace.tsx): history and live output
// come from the application's events route from a discussion cursor, a message
// is posted with a retry identity kept until it is accepted, the reply streams
// in as the runtime records it, and the unsent text stays in the composer on a
// failure or a temporary limit. One open card (the `card` slot) follows the
// last message, above the composer.

type Phase = "loading" | "ready" | "sending" | "streaming";

// An application-authored message, such as a new request's intake summary,
// starts with this line and is shown as a quiet note rather than as the
// requester's own words.
const AUTHORED_PREFIX = "Intake summary from the public page, written by Find Me a Time";

function hasOpenTurn(events: readonly DiscussionEvent[]) {
  let open = false;

  for (const event of events) {
    if (isRedeliveredInput(event)) continue;
    if (event.type === "turn.started") open = true;
    else if (isCurrentTurnBoundaryEvent(event)) open = false;
  }

  return open;
}

export function projectMessages(events: readonly DiscussionEvent[]) {
  let state = conversationReducer.initial();

  for (const event of events) {
    if (isRedeliveredInput(event)) continue;
    state = conversationReducer.reduce(state, event);
  }

  return state.messages;
}

function isWritingText(message: EveMessage | undefined) {
  const part = message?.role === "assistant" ? message.parts.at(-1) : undefined;
  return (part?.type === "text" || part?.type === "reasoning") && part.state === "streaming";
}

function authored(message: EveMessage) {
  const part = message.parts[0];
  return message.role === "user" && part?.type === "text" && part.text.startsWith(AUTHORED_PREFIX);
}

function errorMessage(error: unknown) {
  return error instanceof ChatRequestError ? error.message : "Something went wrong. Try again.";
}

export function GuestConversation({
  ariaLabel,
  before,
  card,
  client,
  closedReason,
  composerFooter,
  extra,
  onAccepted,
  onError,
  onSettled,
  placeholder = "Message Thyme",
}: {
  readonly ariaLabel: string;
  // Read-only content above the messages (host identity, an intake transcript).
  readonly before?: ReactNode;
  // The one open card, after the last message.
  readonly card?: ReactNode;
  readonly client: GuestDiscussionClient;
  // Why the composer is closed, when it is.
  readonly closedReason?: string;
  readonly composerFooter?: ReactNode;
  // Extra fields each message carries (the intake's timezone and language).
  readonly extra?: () => Record<string, unknown>;
  // A message the service accepted; the intake page keeps its new token.
  readonly onAccepted?: (outcome: { intakeToken?: string }) => void;
  readonly onError?: (error: unknown) => void;
  // A followed turn settled: the cards' records may have changed.
  readonly onSettled?: () => void;
  readonly placeholder?: string;
}) {
  const [events, setEvents] = useState<DiscussionEvent[]>([]);
  const eventsRef = useRef<DiscussionEvent[]>([]);
  const [status, setStatus] = useState<DiscussionStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const retryRef = useRef<{ id: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Read when a turn settles, so a new callback never restarts the history read.
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const append = useCallback((event: DiscussionEvent) => {
    eventsRef.current = [...eventsRef.current, event];
    setEvents(eventsRef.current);
  }, []);

  const follow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");
    let total = 0;

    try {
      for (;;) {
        let received = 0;

        for await (const event of client.readEvents(eventsRef.current.length, { follow: true, signal: controller.signal })) {
          append(event);
          received += 1;
          total += 1;
          if (event.type === "message.received") {
            const text = event.data.message;
            setPendingText((pending) => (pending === text ? null : pending));
          }
        }

        const next = await client.readStatus(controller.signal);
        setStatus(next);
        if (received === 0 || next.state !== "active" || next.pendingInputs === 0) break;
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (abortRef.current === controller) {
        setPendingText(null);
        setPhase("ready");
      }
      settledRef.current?.();
    }

    return total;
  }, [append, client]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const current = await client.readStatus(controller.signal);
        setStatus(current);
        const history: DiscussionEvent[] = [];
        for await (const event of client.readEvents(0, { follow: false, signal: controller.signal })) history.push(event);
        eventsRef.current = history;
        setEvents(history);
        setPhase("ready");
        if (hasOpenTurn(history) || current.pendingInputs > 0) await follow();
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause));
          setPhase("ready");
        }
      }
    })();

    return () => {
      controller.abort();
      abortRef.current?.abort();
    };
  }, [client, follow]);

  const send = useCallback(
    async (text: string) => {
      const retry = retryRef.current?.text === text ? retryRef.current : { id: crypto.randomUUID(), text };
      retryRef.current = retry;
      setError(null);
      setPhase("sending");
      setPendingText(text);
      setDraft("");
      const following = status?.state === "active" && status.generation !== null ? follow() : null;

      try {
        const outcome = await client.postMessage(retry.id, text, extra?.());
        retryRef.current = null;
        onAccepted?.(outcome);

        if (outcome.status === "sent" || outcome.status === "queued") {
          if (!following || (await following) === 0) await follow();
          return;
        }

        abortRef.current?.abort();
        setPendingText(null);
        setPhase("ready");
      } catch (cause) {
        abortRef.current?.abort();
        // A token the failed message's new intake got is kept all the same.
        const token = (cause as { intakeToken?: string }).intakeToken;
        if (token) onAccepted?.({ intakeToken: token });
        setPendingText(null);
        setDraft(text);
        setError(errorMessage(cause));
        onError?.(cause);
        setPhase("ready");
      }
    },
    [client, extra, follow, onAccepted, onError, status],
  );

  const messages = useMemo(() => projectMessages(events), [events]);
  const busy = phase !== "ready";
  const openTurn = useMemo(() => hasOpenTurn(events), [events]);
  const lastMessage = messages.at(-1);
  const thinking =
    (phase === "sending" || phase === "streaming") && (pendingText !== null || openTurn) && !isWritingText(lastMessage);
  const failed = status?.state === "failed";

  return (
    <>
      <main aria-label={ariaLabel} className="flex min-h-0 flex-1 flex-col">
        {error ? <ErrorNotice message={error} onDismiss={() => setError(null)} /> : null}
        <ChatConversation>
          <ChatConversationContent aria-busy={busy} aria-label="Messages">
            {before}
            {messages.map((message, index) =>
              authored(message) ? (
                <ChatItem key={message.id} messageId={message.id}>
                  <p className="px-3 text-sm text-muted-foreground">Your details from the public page were passed on to Thyme.</p>
                </ChatItem>
              ) : (
                <ChatItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                  <AgentMessage
                    canRespond={false}
                    isStreaming={phase === "streaming" && index === messages.length - 1}
                    message={message}
                    onInputResponses={() => {}}
                  />
                </ChatItem>
              ),
            )}
            {pendingText ? (
              <ChatItem messageId="pending" scrollAnchor>
                <AgentMessage
                  canRespond={false}
                  isStreaming={false}
                  message={{ id: "pending", parts: [{ state: "done", text: pendingText, type: "text" }], role: "user" }}
                  onInputResponses={() => {}}
                />
              </ChatItem>
            ) : null}
            {failed ? (
              <p className="px-3 text-sm text-muted-foreground" role="status">
                Thyme stopped responding in this conversation. Your messages are kept; the cards below still work.
              </p>
            ) : null}
            {thinking ? (
              <ChatItem messageId="thinking">
                <AgentThinking withHeader={pendingText !== null || lastMessage?.role !== "assistant"} />
              </ChatItem>
            ) : null}
            {card ? (
              <ChatItem messageId="card">
                <div className="flex min-w-0 flex-col" role="group" aria-label="Next step">
                  {card}
                </div>
              </ChatItem>
            ) : null}
          </ChatConversationContent>
          <ChatScrollButton />
        </ChatConversation>
      </main>

      <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 sm:px-6">
          {composerFooter}
          <ChatComposer
            autoFocus={false}
            disabled={phase === "loading" || Boolean(closedReason)}
            disabledReason={closedReason}
            isBusy={phase === "sending" || phase === "streaming"}
            onChange={setDraft}
            onStop={() => {}}
            onSubmit={send}
            placeholder={placeholder}
            value={draft}
          />
        </div>
      </div>
    </>
  );
}

function ErrorNotice({ message, onDismiss }: { readonly message: string; readonly onDismiss: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-2 sm:px-6" role="alert">
      <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-card p-3 text-sm">
        <AlertCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1">{message}</p>
        <Button aria-label="Dismiss" onClick={onDismiss} size="icon-sm" type="button" variant="ghost">
          <XIcon aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
