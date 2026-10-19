"use client";

import type { MessageStreamEvent } from "eve/client";
import { conversationReducer } from "eve/react";
import { AlertCircleIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { ChatComposer } from "@/components/chat/composer";
import { ChatConversation, ChatConversationContent, ChatScrollButton } from "@/components/chat/conversation";
import { AgentMessage } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import {
  ChatRequestError,
  type DiscussionStatus,
  postMessage,
  postRecovery,
  readDiscussionEvents,
  readDiscussionStatus,
} from "@/lib/chat/discussion";
import { isChatTurnSettledEvent } from "@/lib/chat/events";

// The host workspace at /app: one centered conversation, a reachable composer
// and a compact menu, with no sidebar. History and live output come from the
// discussion's application routes, so a reload, a reconnect or a recovered
// runtime continues from the same discussion cursor.

type Phase = "loading" | "ready" | "sending" | "streaming" | "recovering";

function hasOpenTurn(events: readonly MessageStreamEvent[]) {
  let open = false;

  for (const event of events) {
    if (event.type === "turn.started") open = true;
    else if (isChatTurnSettledEvent(event)) open = false;
  }

  return open;
}

function project(events: readonly MessageStreamEvent[]) {
  let state = conversationReducer.initial();
  for (const event of events) state = conversationReducer.reduce(state, event);
  return state.messages;
}

function errorMessage(error: unknown) {
  if (error instanceof ChatRequestError) return error.message;
  return "Something went wrong. Try again.";
}

export function HostWorkspace() {
  const [events, setEvents] = useState<MessageStreamEvent[]>([]);
  const eventsRef = useRef<MessageStreamEvent[]>([]);
  const [status, setStatus] = useState<DiscussionStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  // An unsent draft keeps its retry identity, so resending it is an exact retry.
  const retryRef = useRef<{ id: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const append = useCallback((event: MessageStreamEvent) => {
    eventsRef.current = [...eventsRef.current, event];
    setEvents(eventsRef.current);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await readDiscussionStatus());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  // Follows the current turn from the discussion cursor until it settles.
  const follow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");

    try {
      for await (const event of readDiscussionEvents(eventsRef.current.length, {
        follow: true,
        signal: controller.signal,
      })) {
        append(event);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (abortRef.current === controller) {
        setPendingText(null);
        setPhase("ready");
        await refreshStatus();
      }
    }
  }, [append, refreshStatus]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        setStatus(await readDiscussionStatus(controller.signal));
        const history: MessageStreamEvent[] = [];
        for await (const event of readDiscussionEvents(0, { follow: false, signal: controller.signal })) {
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
  }, [follow]);

  const send = useCallback(
    async (text: string) => {
      const retry = retryRef.current?.text === text ? retryRef.current : { id: crypto.randomUUID(), text };
      retryRef.current = retry;
      setError(null);
      setPhase("sending");
      setPendingText(text);
      setDraft("");

      try {
        const outcome = await postMessage(retry.id, text);
        retryRef.current = null;

        if (outcome.status === "sent") {
          await follow();
          return;
        }

        // Recorded, and continued after recovery.
        setPendingText(null);
        setPhase("ready");
        await refreshStatus();
      } catch (cause) {
        setPendingText(null);
        setDraft(text);
        setError(errorMessage(cause));
        setPhase("ready");
      }
    },
    [follow, refreshStatus],
  );

  const recover = useCallback(async () => {
    if (!status?.generation) return;

    setError(null);
    setPhase("recovering");

    try {
      const outcome = await postRecovery(status.generation);

      if (outcome.status === "unavailable") {
        setError("Thyme can't be restarted right now. Your messages are kept; try again shortly.");
      }

      await refreshStatus();

      if (outcome.status === "recovered") {
        await follow();
        return;
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }

    setPhase("ready");
  }, [follow, refreshStatus, status?.generation]);

  const messages = useMemo(() => project(events), [events]);
  const failed = status?.state === "failed";
  const busy = phase !== "ready";
  const isEmpty = messages.length === 0 && !pendingText;

  const focusComposer = useCallback(() => {
    composerRef.current?.querySelector("textarea")?.focus();
  }, []);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <h1 className="truncate font-display text-lg">Find Me a Time</h1>
        <WorkspaceMenu onSelectSetup={focusComposer} />
      </header>

      <main aria-label="Setup conversation with Thyme" className="flex min-h-0 flex-1 flex-col">
        {error ? <ErrorNotice message={error} onDismiss={() => setError(null)} /> : null}

        {failed ? (
          <div className="mx-auto w-full max-w-2xl px-4 sm:px-6" role="status">
            <div className="flex flex-col gap-3 rounded-xl border border-input bg-card p-4 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm">
                Thyme stopped responding in this conversation. Your messages and history are kept.
              </p>
              <Button disabled={phase === "recovering"} onClick={() => void recover()} type="button">
                {phase === "recovering" ? "Restarting..." : "Restart Thyme"}
              </Button>
            </div>
          </div>
        ) : null}

        {isEmpty && phase !== "loading" ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 sm:px-6">
            <h2 className="font-display text-2xl">Let&apos;s find a time</h2>
            <p className="mt-2 text-muted-foreground">
              Tell Thyme how your weeks usually go, and it will help you set up how people book time with you.
            </p>
          </div>
        ) : (
          <ChatConversation aria-busy={busy} aria-label="Messages">
            <ChatConversationContent>
              {messages.map((message, index) => (
                <AgentMessage
                  canRespond={false}
                  isStreaming={phase === "streaming" && index === messages.length - 1}
                  key={message.id}
                  message={message}
                  onInputResponses={() => {}}
                />
              ))}
              {pendingText ? (
                <AgentMessage
                  canRespond={false}
                  isStreaming={false}
                  message={{ id: "pending", parts: [{ state: "done", text: pendingText, type: "text" }], role: "user" }}
                  onInputResponses={() => {}}
                />
              ) : null}
              {phase === "sending" || phase === "streaming" ? (
                <p className="px-3 text-sm text-muted-foreground" role="status">
                  Thyme is thinking...
                </p>
              ) : null}
            </ChatConversationContent>
            <ChatScrollButton />
          </ChatConversation>
        )}
      </main>

      <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6" ref={composerRef}>
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          <ChatComposer
            disabled={phase === "loading" || phase === "recovering"}
            disabledReason={failed ? "Restart Thyme to continue this conversation." : undefined}
            isBusy={phase === "sending" || phase === "streaming"}
            onChange={setDraft}
            onStop={() => {}}
            onSubmit={send}
            placeholder={failed ? "Write a message; it is kept until Thyme restarts" : "Message Thyme"}
            value={draft}
          />
        </div>
      </div>
    </div>
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
