"use client";

import { type DiscussionEvent, isRedeliveredInput } from "@lib/contracts/discussion-events";
import { isCurrentTurnBoundaryEvent } from "eve/client";
import { conversationReducer } from "eve/react";
import { AlertCircleIcon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthoredMessages, useAuthoredReveal } from "@/app/_components/setup/authored-messages";
import { focusCurrentCard, SetupCards } from "@/app/_components/setup/setup-cards";
import { ReceiptAnnouncer, SetupReceipts } from "@/app/_components/setup/receipt";
import { deriveReceipts, interleave, type Receipt } from "@/app/_components/setup/receipts";
import { type SetupContextValue, SetupProvider, useSetupController } from "@/app/_components/setup/setup-context";
import { describeSetupTool } from "@/app/_components/setup/tool-labels";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { ChatComposer } from "@/components/chat/composer";
import { ChatConversation, ChatConversationContent, ChatItem, ChatScrollButton } from "@/components/chat/conversation";
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

// The host workspace at /app: one centered conversation, a reachable composer
// and a compact menu, with no sidebar. History and live output come from the
// discussion's application routes, so a reload, a reconnect or a recovered
// runtime continues from the same discussion cursor. Setup lives in the same
// column: the authored onboarding messages open the conversation, answered setup
// cards stay in the history as one-line receipts where they were answered, and
// the one open card follows the last message, above the composer.

// While a scan is pending the analysis card polls, since no turn or action
// would otherwise reveal its result.
const ANALYSIS_POLL_MS = 4000;

type Phase = "loading" | "ready" | "sending" | "streaming" | "recovering";

// The same boundary the server's follow mode ends at.
function hasOpenTurn(events: readonly DiscussionEvent[]) {
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
function lastTurnFailed(events: readonly DiscussionEvent[]) {
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
function project(events: readonly DiscussionEvent[]) {
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

function errorMessage(error: unknown) {
  if (error instanceof ChatRequestError) return error.message;
  return "Something went wrong. Try again.";
}

export function HostWorkspace() {
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
  const composerRef = useRef<HTMLDivElement>(null);
  const setup = useSetupController();
  const reloadSetup = setup.reload;
  const reveal = useAuthoredReveal(setup.state);

  const append = useCallback((event: DiscussionEvent) => {
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

  // Follows the current turn from the discussion cursor until it settles. A
  // queued message starts its turn when the one before it ends, so following
  // continues while the discussion still has input pending and the last pass
  // saw the runtime move.
  const follow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");

    try {
      for (;;) {
        let received = 0;

        for await (const event of readDiscussionEvents(eventsRef.current.length, {
          follow: true,
          signal: controller.signal,
        })) {
          append(event);
          received += 1;
          if (event.type === "message.received") {
            const text = event.data.message;
            setPendingText((pending) => (pending === text ? null : pending));
          }
        }

        const next = await readDiscussionStatus(controller.signal);
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
      // A settled turn may have drafted setup values.
      void reloadSetup();
    }
  }, [append, refreshStatus, reloadSetup]);

  useEffect(() => {
    void reloadSetup();
  }, [reloadSetup]);

  const analyzing = setup.state?.nextAction === "analyzing";

  useEffect(() => {
    if (!analyzing) return;
    const timer = window.setInterval(() => void reloadSetup(), ANALYSIS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [analyzing, reloadSetup]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        setStatus(await readDiscussionStatus(controller.signal));
        const history: DiscussionEvent[] = [];
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

        if (outcome.status === "sent" || outcome.status === "queued") {
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

      // Follow only when recovery delivered input; an idle successor has no turn coming.
      if (outcome.status === "recovered" && outcome.delivered) {
        await follow();
        return;
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }

    setPhase("ready");
  }, [follow, refreshStatus, status?.generation]);

  const { messages, times } = useMemo(() => project(events), [events]);
  const failed = status?.state === "failed";
  const turnFailed = useMemo(() => lastTurnFailed(events), [events]);
  const busy = phase !== "ready";
  const setupState = setup.state;
  const setupValue = setup.value;
  const showSetup = setupValue !== null && reveal.done;
  // Answered setup cards, as receipts placed among the messages by time.
  const receipts = useMemo(
    () => (showSetup && setupValue ? deriveReceipts(setupValue.state, setupValue.skipped) : []),
    [setupValue, showSetup],
  );
  const timeline = useMemo(() => {
    const entries = interleave(
      messages.map((message, index) => ({ at: times.get(message.id) ?? null, message: { index, message } })),
      receipts,
    );
    // Consecutive receipts share one quiet list between messages.
    const grouped: (
      | { readonly kind: "message"; readonly index: number; readonly message: (typeof messages)[number] }
      | { readonly kind: "receipts"; readonly receipts: Receipt[] }
    )[] = [];
    for (const entry of entries) {
      const last = grouped.at(-1);
      if (entry.kind === "message") grouped.push({ kind: "message", ...entry.message });
      else if (last?.kind === "receipts") last.receipts.push(entry.receipt);
      else grouped.push({ kind: "receipts", receipts: [entry.receipt] });
    }
    return grouped;
  }, [messages, receipts, times]);

  // The menu's Setup item leads to the current step's card, or the composer
  // while setup has not loaded.
  const focusSetup = useCallback(() => {
    if (setupState && reveal.done) focusCurrentCard();
    else composerRef.current?.querySelector("textarea")?.focus();
  }, [reveal.done, setupState]);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <h1 className="truncate font-display text-lg">Find Me a Time</h1>
        <WorkspaceMenu onSelectSetup={focusSetup} />
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

        {setup.loadError && !setupState ? (
          <div className="mx-auto w-full max-w-2xl px-4 pt-2 sm:px-6" role="status">
            <p className="text-sm text-muted-foreground">{setup.loadError}</p>
          </div>
        ) : null}

        <ChatConversation>
          <ConversationSetup value={setupValue}>
            <ChatConversationContent aria-busy={busy} aria-label="Messages">
              <AuthoredMessages messages={reveal.visible} />
              {timeline.map((entry) =>
                entry.kind === "receipts" ? (
                  <ChatItem key={`receipts-${entry.receipts[0]!.id}`} messageId={`receipts-${entry.receipts[0]!.id}`}>
                    <SetupReceipts receipts={entry.receipts} />
                  </ChatItem>
                ) : (
                  <ChatItem
                    key={entry.message.id}
                    messageId={entry.message.id}
                    scrollAnchor={entry.message.role === "user"}
                  >
                    <AgentMessage
                      canRespond={false}
                      describeTool={describeSetupTool}
                      isStreaming={phase === "streaming" && entry.index === messages.length - 1}
                      message={entry.message}
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
              {turnFailed && !failed && phase === "ready" ? (
                <p className="px-3 text-sm text-muted-foreground" role="status">
                  Thyme couldn&apos;t finish this reply. Your message is saved; try again in a little while.
                </p>
              ) : null}
              {phase === "sending" || phase === "streaming" ? (
                <p className="px-3 text-sm" role="status">
                  <span className="shimmer text-muted-foreground motion-reduce:shimmer-none">Thyme is thinking...</span>
                </p>
              ) : null}
              {showSetup ? (
                <ChatItem messageId="setup">
                  <div aria-label="Setup" className="flex min-w-0 flex-col" role="group">
                    <SetupCards />
                  </div>
                </ChatItem>
              ) : null}
            </ChatConversationContent>
          </ConversationSetup>
          <ChatScrollButton />
        </ChatConversation>
        <ReceiptAnnouncer receipts={receipts} />
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

// Gives the receipts in the history and the open card the same setup controller.
function ConversationSetup({ children, value }: { readonly children: ReactNode; readonly value: SetupContextValue | null }) {
  return value ? <SetupProvider value={value}>{children}</SetupProvider> : children;
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
