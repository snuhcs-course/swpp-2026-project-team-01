"use client";

import { type DiscussionEvent, isRedeliveredInput } from "@lib/contracts/discussion-events";
import { isCurrentTurnBoundaryEvent } from "eve/client";
import { conversationReducer, type EveMessage } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatRequestError,
  type DiscussionStatus,
  postMessage,
  postRecovery,
  readDiscussionEvents,
  readDiscussionStatus,
} from "./discussion";

// One host discussion in the browser: setup (request null) or the host's private
// review of one request. History and live output come from the discussion's
// application routes, so a reload, a reconnect or a recovered runtime continues
// from the same discussion cursor. Shared by the setup workspace and the
// request view in /app (host-review-and-booking design 2).

export type Phase = "loading" | "ready" | "sending" | "streaming" | "recovering";

// The same boundary the server's follow mode ends at.
export function hasOpenTurn(events: readonly DiscussionEvent[]) {
  let open = false;

  for (const event of events) {
    if (isRedeliveredInput(event)) continue;
    if (event.type === "turn.started") open = true;
    else if (isCurrentTurnBoundaryEvent(event)) open = false;
  }

  return open;
}

// Whether the latest turn failed while the session lived on, as when the model
// allowance is spent: its reply is missing and nothing else in the conversation
// says why. A terminal failure has its own restart notice.
export function lastTurnFailed(events: readonly DiscussionEvent[]) {
  let failed = false;

  for (const event of events) {
    if (event.type === "turn.started") failed = false;
    else if (event.type === "turn.failed") failed = event.data.terminal !== true;
  }

  return failed;
}

// A re-sent input's marker counts toward the cursor but is not shown: the host's
// message already appears once. Each message's time is the meta.at of the event
// that first produced it, which places setup receipts among the messages.
export function project(events: readonly DiscussionEvent[]) {
  let state = conversationReducer.initial();
  const times = new Map<string, string>();

  for (const event of events) {
    if (isRedeliveredInput(event)) continue;
    state = conversationReducer.reduce(state, event);
    const at = event.meta?.at;
    if (!at) continue;
    // New messages are appended, so only the tail can be unseen.
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const id = state.messages[index]!.id;
      if (times.has(id)) break;
      times.set(id, at);
    }
  }

  return { messages: state.messages, times };
}

// Whether Thyme's latest reply is writing text right now; otherwise a running
// turn is between steps, calling a tool or not yet answering.
export function isWritingText(message: EveMessage | undefined) {
  const part = message?.role === "assistant" ? message.parts.at(-1) : undefined;
  return (part?.type === "text" || part?.type === "reasoning") && part.state === "streaming";
}

export function errorMessage(error: unknown) {
  if (error instanceof ChatRequestError) return error.message;
  return "Something went wrong. Try again.";
}

export function useHostDiscussion({ onSettled, request = null }: { readonly onSettled?: () => void; readonly request?: string | null }) {
  const [events, setEvents] = useState<DiscussionEvent[]>([]);
  const eventsRef = useRef<DiscussionEvent[]>([]);
  const [status, setStatus] = useState<DiscussionStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  // An unsent draft keeps its retry identity, so resending it is an exact retry.
  const retryRef = useRef<{ id: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const append = useCallback((event: DiscussionEvent) => {
    eventsRef.current = [...eventsRef.current, event];
    setEvents(eventsRef.current);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await readDiscussionStatus(undefined, request));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [request]);

  // Follows the current turn from the discussion cursor until it settles, and
  // resolves to the number of events it received. A queued message starts its
  // turn when the one before it ends, so following continues while the
  // discussion still has input pending and the last pass saw the runtime move.
  const follow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");
    let total = 0;

    try {
      for (;;) {
        let received = 0;

        for await (const event of readDiscussionEvents(eventsRef.current.length, {
          follow: true,
          request,
          signal: controller.signal,
        })) {
          append(event);
          received += 1;
          total += 1;
          if (event.type === "message.received") {
            const text = event.data.message;
            setPendingText((pending) => (pending === text ? null : pending));
          }
        }

        const next = await readDiscussionStatus(controller.signal, request);
        setStatus(next);
        if (received === 0 || next.state !== "active" || next.pendingInputs === 0) break;
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorMessage(cause));
        await refreshStatus();
      }
    } finally {
      if (abortRef.current === controller) {
        setPendingText(null);
        setPhase("ready");
      }
      // A settled turn may have drafted values or suggestions.
      settledRef.current?.();
    }

    return total;
  }, [append, refreshStatus, request]);

  useEffect(() => {
    const controller = new AbortController();
    eventsRef.current = [];
    setEvents([]);
    setPhase("loading");

    void (async () => {
      try {
        setStatus(await readDiscussionStatus(controller.signal, request));
        const history: DiscussionEvent[] = [];
        for await (const event of readDiscussionEvents(0, { follow: false, request, signal: controller.signal })) {
          history.push(event);
        }
        eventsRef.current = history;
        setEvents(history);
        setPhase("ready");
        if (hasOpenTurn(history)) await follow();
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
  }, [follow, request]);

  const send = useCallback(
    async (text: string) => {
      const retry = retryRef.current?.text === text ? retryRef.current : { id: crypto.randomUUID(), text };
      retryRef.current = retry;
      setError(null);
      setPhase("sending");
      setPendingText(text);
      setDraft("");
      // A live discussion is followed while the message is posted, so the reply
      // streams in as the runtime records it rather than arriving at once after
      // the message route's round trip to the runtime. Without a live session
      // there is nothing to follow until the post creates one.
      const following = status?.state === "active" && status.generation !== null ? follow() : null;

      try {
        const outcome = await postMessage(retry.id, text, request);
        retryRef.current = null;

        if (outcome.status === "sent" || outcome.status === "queued") {
          // An early follow that ended before the turn began is opened again.
          if (!following || (await following) === 0) await follow();
          return;
        }

        // Recorded, and continued after recovery.
        abortRef.current?.abort();
        setPendingText(null);
        setPhase("ready");
        await refreshStatus();
      } catch (cause) {
        abortRef.current?.abort();
        setPendingText(null);
        setDraft(text);
        setError(errorMessage(cause));
        setPhase("ready");
      }
    },
    [follow, refreshStatus, request, status],
  );

  const recover = useCallback(async () => {
    if (!status?.generation) return;

    setError(null);
    setPhase("recovering");

    try {
      const outcome = await postRecovery(status.generation, request);

      if (outcome.status === "unavailable") {
        setError("Thyme can't be restarted right now. Your messages are kept; try again shortly.");
      }

      await refreshStatus();

      // Follow only when recovery delivered input; an idle successor has no turn coming.
      if (outcome.status === "recovered" && outcome.delivered) {
        await follow();
        return;
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }

    setPhase("ready");
  }, [follow, refreshStatus, request, status?.generation]);

  const projected = useMemo(() => project(events), [events]);
  const turnFailed = useMemo(() => lastTurnFailed(events), [events]);
  const openTurn = useMemo(() => hasOpenTurn(events), [events]);
  const lastMessage = projected.messages.at(-1);
  // From a send until the first token, and while a running turn writes no text.
  // A streaming reasoning part has its own "Thinking" line.
  const thinking =
    (phase === "sending" || phase === "streaming") && (pendingText !== null || openTurn) && !isWritingText(lastMessage);

  return {
    draft,
    error,
    failed: status?.state === "failed",
    lastMessage,
    messages: projected.messages,
    pendingText,
    phase,
    recover,
    send,
    setDraft,
    setError,
    thinking,
    times: projected.times,
    turnFailed,
  };
}
