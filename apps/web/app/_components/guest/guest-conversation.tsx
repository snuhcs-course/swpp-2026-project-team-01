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
import type { GuestDiscussionClient, GuestPostOutcome } from "@/lib/chat/guest";

// The guest thread (design decisions 2 and 12, D13), following the host
// workspace (host-workspace.tsx): history and live output come from the
// application's events route from a discussion cursor, a message is posted with
// a retry identity kept until it is accepted, the reply streams in as the
// runtime records it, and the unsent text stays in the composer on a failure or
// a temporary limit. Every card is an entry of the thread, placed among the
// messages by the time the conversation called for it, so it follows the
// assistant message or tool result that raised it and stays in the history.
// Only the composer sits below the thread.

type Phase = "loading" | "ready" | "sending" | "streaming";

// One card or receipt in the thread, placed by `at`.
export type ThreadEntry = { readonly id: string; readonly at: string; readonly node: ReactNode };

// An application-authored message from before D13 (a request's intake
// summary) starts with this line and is shown as a quiet note rather than as
// the requester's own words.
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
  return project(events).messages;
}

// Each message's time is the meta.at of the event that first produced it,
// which places the thread's cards among the messages.
function project(events: readonly DiscussionEvent[]) {
  let state = conversationReducer.initial();
  const times = new Map<string, number>();

  for (const event of events) {
    if (isRedeliveredInput(event)) continue;
    state = conversationReducer.reduce(state, event);
    const at = event.meta?.at ? Date.parse(event.meta.at) : Number.NaN;
    if (Number.isNaN(at)) continue;
    // New messages are appended, so only the tail can be unseen.
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const id = state.messages[index]!.id;
      if (times.has(id)) break;
      times.set(id, at);
    }
  }

  return { messages: state.messages, times };
}

type Placed =
  | { readonly kind: "message"; readonly index: number; readonly message: EveMessage }
  | { readonly kind: "entry"; readonly entry: ThreadEntry };

// Messages in order, with each entry before the first message that started
// after it: an entry follows the message during which it was called for.
export function placeEntries(
  messages: readonly EveMessage[],
  times: ReadonlyMap<string, number>,
  entries: readonly ThreadEntry[],
): Placed[] {
  const sorted = [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const placed: Placed[] = [];
  let next = 0;
  let previous = Number.NEGATIVE_INFINITY;

  messages.forEach((message, index) => {
    const started = times.get(message.id) ?? previous;
    previous = started;
    while (next < sorted.length && Date.parse(sorted[next]!.at) < started) {
      placed.push({ entry: sorted[next]!, kind: "entry" });
      next += 1;
    }
    placed.push({ index, kind: "message", message });
  });

  for (; next < sorted.length; next += 1) placed.push({ entry: sorted[next]!, kind: "entry" });
  return placed;
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
  client,
  closedReason,
  entries = [],
  extra,
  onAccepted,
  onError,
  onRecover,
  onSettled,
  placeholder = "Message Thyme",
}: {
  readonly ariaLabel: string;
  // The start of the thread: the host's identity, the timezone chip and, on
  // the public page, its collapsed page chrome.
  readonly before?: ReactNode;
  readonly client: GuestDiscussionClient;
  // Why the composer is closed, when it is.
  readonly closedReason?: string;
  // The thread's cards and receipts, placed among the messages by time.
  readonly entries?: readonly ThreadEntry[];
  // Extra fields the first message carries (the guest's timezone and language).
  readonly extra?: () => Record<string, unknown>;
  // A message the service accepted; the first one answers the draft's booking
  // identifier, which the page keeps (also from a failure after the draft exists).
  readonly onAccepted?: (outcome: GuestPostOutcome) => void;
  readonly onError?: (error: unknown) => void;
  // **Recover conversation** for a generation that stopped with a terminal
  // failure; absent where the page offers no recovery.
  readonly onRecover?: (generation: number) => Promise<{ readonly status: string; readonly delivered?: boolean }>;
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
        // A draft the failed first message started is kept all the same.
        const bookingId = (cause as { bookingId?: string }).bookingId;
        if (bookingId) onAccepted?.({ bookingId });
        setPendingText(null);
        setDraft(text);
        setError(errorMessage(cause));
        onError?.(cause);
        setPhase("ready");
      }
    },
    [client, extra, follow, onAccepted, onError, status],
  );

  const { messages, times } = useMemo(() => project(events), [events]);
  const placed = useMemo(() => placeEntries(messages, times, entries), [entries, messages, times]);
  const busy = phase !== "ready";
  const openTurn = useMemo(() => hasOpenTurn(events), [events]);
  const lastMessage = messages.at(-1);
  const thinking =
    (phase === "sending" || phase === "streaming") && (pendingText !== null || openTurn) && !isWritingText(lastMessage);
  const failed = status?.state === "failed";
  const [recovering, setRecovering] = useState(false);

  const recover = useCallback(async () => {
    if (!onRecover || status?.generation == null) return;
    setRecovering(true);
    setError(null);

    try {
      const outcome = await onRecover(status.generation);
      setStatus(await client.readStatus());
      if (outcome.status === "recovered" && outcome.delivered) await follow();
      else if (outcome.status !== "recovered" && outcome.status !== "stale") setError("The conversation could not be recovered yet. Try again in a moment.");
    } catch {
      setError("The conversation could not be recovered yet. Try again in a moment.");
    } finally {
      setRecovering(false);
    }
  }, [client, follow, onRecover, status]);

  return (
    <>
      <main aria-label={ariaLabel} className="flex min-h-0 flex-1 flex-col">
        {error ? <ErrorNotice message={error} onDismiss={() => setError(null)} /> : null}
        <ChatConversation>
          <ChatConversationContent aria-busy={busy} aria-label="Messages" data-guest-thread="">
            {before}
            {placed.map((item) => {
              if (item.kind === "entry") {
                return (
                  <ChatItem key={`entry-${item.entry.id}`} messageId={`entry-${item.entry.id}`}>
                    <div className="flex min-w-0 flex-col">{item.entry.node}</div>
                  </ChatItem>
                );
              }
              const { index, message } = item;
              return authored(message) ? (
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
              );
            })}
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
              <div className="flex flex-wrap items-center gap-2 px-3 text-sm text-muted-foreground" role="status">
                <p>Thyme stopped responding in this conversation. Your messages are kept; the cards in it still work.</p>
                {onRecover ? (
                  <Button className="min-h-11" disabled={recovering} onClick={() => void recover()} type="button" variant="outline">
                    {recovering ? "Recovering..." : "Recover conversation"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {thinking ? (
              <ChatItem messageId="thinking">
                <AgentThinking withHeader={pendingText !== null || lastMessage?.role !== "assistant"} />
              </ChatItem>
            ) : null}
          </ChatConversationContent>
          <ChatScrollButton />
        </ChatConversation>
      </main>

      <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 sm:px-6">
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
