"use client";

import { Client } from "eve/client";
import type {
  ClientSession,
  ClientSessionState,
  ConversationState,
  EveMessageData,
  MessageStreamEvent,
} from "eve/client";
import type { EveMessage } from "eve/react";
import { conversationReducer, useEveAgent } from "eve/react";
import { AlertCircleIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatConversation,
  ChatConversationContent,
  ChatScrollButton,
} from "@/components/chat/conversation";
import { AgentMessage } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import { isChatTurnSettledEvent } from "@/lib/chat/events";
import { getChatMessageLengthError } from "@lib/contracts/chat-message";
import type { ActiveChat } from "@/lib/chat/types";

export type DraftHandlers = {
  readonly clearDraft: () => void;
  readonly restoreDraft: (value: string) => void;
};

export type AgentChatController = {
  readonly reset: () => void;
  readonly sendMessage: (text: string, draftHandlers: DraftHandlers) => Promise<void>;
  readonly stop: () => void;
};

export type AgentChatControllerStatus = {
  readonly disabledReason?: string;
  readonly isBusy: boolean;
  readonly isDisabled: boolean;
  readonly isEmpty: boolean;
};

const IDLE_CONTROLLER_STATUS: AgentChatControllerStatus = {
  isBusy: false,
  isDisabled: false,
  isEmpty: true,
};

const THINKING_EXIT_DURATION_MS = 180;

function attachClientSession(session: ClientSessionState | undefined): ClientSession | null {
  if (!session) return null;
  return new Client({ host: "" }).sessions.attach(session.sessionId, {
    streamIndex: session.streamIndex,
  });
}

function reduceEventsToMessageData(events: readonly MessageStreamEvent[]): ConversationState {
  const reducer = conversationReducer;
  let data = reducer.initial();

  for (const event of events) {
    data = reducer.reduce(data, event);
  }

  return data;
}

function hasOpenChatTurn(events: readonly MessageStreamEvent[]) {
  let open = false;

  for (const event of events) {
    if (event.type === "turn.started") {
      open = true;
    } else if (isChatTurnSettledEvent(event)) {
      open = false;
    }
  }

  return open;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function AgentChatSession({
  activeChat,
  onControllerChange,
}: {
  readonly activeChat: ActiveChat | null;
  readonly onControllerChange: (
    controller: AgentChatController | null,
    status: AgentChatControllerStatus,
  ) => void;
}) {
  const [clientError, setClientError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [resumedEvents, setResumedEvents] = useState<MessageStreamEvent[]>([]);
  const [isResuming, setIsResuming] = useState(false);
  const {
    clearMessage: clearLocalPendingUserMessage,
    message: localPendingUserMessage,
    messageRef: localPendingUserMessageRef,
    setMessage: setLocalPendingUserMessage,
  } = usePendingUserMessage();
  const resumeStartedRef = useRef(false);
  const resumedEventsRef = useRef<MessageStreamEvent[]>([]);

  const agent = useEveAgent({
    initialEvents: activeChat?.events ?? [],
    initialSession: activeChat?.session,
  });

  const hasResumeOverlay = isResuming || resumedEvents.length > 0;
  const displayEvents = useMemo(
    () =>
      hasResumeOverlay ? [...(activeChat?.events ?? []), ...resumedEvents] : [...agent.events],
    [activeChat?.events, agent.events, hasResumeOverlay, resumedEvents],
  );
  const displayData = useMemo(() => reduceEventsToMessageData(displayEvents), [displayEvents]);
  const displayMessages = displayData.messages;
  const displayChatId = activeChat?.id ?? "new";
  const hasLocalPendingUserMessage = Boolean(localPendingUserMessage);
  const hasOpenTurn = useMemo(() => hasOpenChatTurn(displayEvents), [displayEvents]);
  const isBusy =
    isResuming ||
    hasLocalPendingUserMessage ||
    hasOpenTurn ||
    agent.status === "submitted" ||
    agent.status === "streaming";
  const localPendingMessage = localPendingUserMessage
    ? createPendingUserMessage(displayChatId, localPendingUserMessage, "local-pending-user-message")
    : null;
  const visibleMessages = appendPendingUserMessages(displayMessages, [localPendingMessage]);
  const isEmpty = visibleMessages.length === 0 && !isBusy;
  const thinkingPresence = useThinkingPresence(Boolean(localPendingMessage) || isBusy);
  const displayError = clientError ?? agent.error?.message ?? null;
  const toastError = displayError && dismissedError !== displayError ? displayError : null;

  const resetSession = useCallback(() => {
    agent.reset();
    resumeStartedRef.current = false;
    resumedEventsRef.current = [];
    setResumedEvents([]);
    clearLocalPendingUserMessage();
    setIsResuming(false);
    setClientError(null);
  }, [agent, clearLocalPendingUserMessage]);

  const sendMessage = useCallback(
    async (text: string, draftHandlers: DraftHandlers) => {
      const message = text.trim();

      if (!message || isBusy || localPendingUserMessageRef.current) {
        return;
      }

      const lengthError = getChatMessageLengthError(message);

      if (lengthError) {
        setClientError(lengthError);
        return;
      }

      setClientError(null);
      resumedEventsRef.current = [];
      setResumedEvents([]);
      setIsResuming(false);
      setLocalPendingUserMessage(message);
      draftHandlers.clearDraft();

      try {
        await agent.send(message);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        clearLocalPendingUserMessage();
        draftHandlers.restoreDraft(message);
        setClientError(error instanceof Error ? error.message : "Failed to send message.");
      }
    },
    [
      agent,
      clearLocalPendingUserMessage,
      isBusy,
      localPendingUserMessageRef,
      setLocalPendingUserMessage,
    ],
  );

  const handleInputResponses = useCallback(
    async (
      responses: readonly {
        readonly optionId?: string;
        readonly requestId: string;
        readonly text?: string;
      }[],
    ) => {
      if (isBusy) {
        return;
      }

      try {
        await agent.respond(responses);
      } catch (error) {
        setClientError(error instanceof Error ? error.message : "Failed to send response.");
      }
    },
    [agent, isBusy],
  );

  useEffect(() => {
    if (
      !activeChat?.session?.sessionId ||
      resumeStartedRef.current ||
      agent.status !== "ready" ||
      !hasOpenChatTurn(activeChat.events)
    ) {
      return;
    }

    const session = attachClientSession(activeChat.session);
    if (!session) return;
    const abortController = new AbortController();
    const startIndex = activeChat.events.length;
    let cancelled = false;
    let completed = false;

    resumeStartedRef.current = true;
    resumedEventsRef.current = [];
    setResumedEvents([]);
    setIsResuming(true);
    setClientError(null);

    void (async () => {
      try {
        for await (const event of session.stream({
          signal: abortController.signal,
          startIndex,
        })) {
          if (cancelled) {
            return;
          }

          const nextEvents = [...resumedEventsRef.current, event];
          resumedEventsRef.current = nextEvents;
          setResumedEvents(nextEvents);

          if (isChatTurnSettledEvent(event)) {
            break;
          }
        }

        if (cancelled) {
          return;
        }

        if (!resumedEventsRef.current.some(isChatTurnSettledEvent)) {
          setClientError("Stream disconnected before the response completed.");
          return;
        }

        completed = true;
      } catch (error) {
        if (!cancelled && !isAbortError(error)) {
          setClientError(error instanceof Error ? error.message : "Failed to resume stream.");
        }
      } finally {
        if (!cancelled) {
          setIsResuming(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (!completed) {
        resumeStartedRef.current = false;
      }
      abortController.abort();
    };
  }, [activeChat?.events, activeChat?.session, agent.status]);

  useEffect(() => {
    setDismissedError(null);
  }, [displayError]);

  useEffect(() => {
    if (localPendingUserMessage && hasLatestUserMessage(displayMessages, localPendingUserMessage)) {
      clearLocalPendingUserMessage();
    }
  }, [clearLocalPendingUserMessage, displayMessages, localPendingUserMessage]);

  useEffect(() => {
    onControllerChange(
      {
        reset: resetSession,
        sendMessage,
        stop: () => void agent.cancel(),
      },
      {
        isBusy,
        isDisabled: false,
        isEmpty,
      },
    );
  }, [agent.cancel, isBusy, isEmpty, onControllerChange, resetSession, sendMessage]);

  useEffect(() => {
    return () => {
      onControllerChange(null, IDLE_CONTROLLER_STATUS);
    };
  }, [onControllerChange]);

  return (
    <>
      {toastError ? (
        <ErrorToast message={toastError} onDismiss={() => setDismissedError(toastError)} />
      ) : null}

      {isEmpty ? (
        <BlankChatBody />
      ) : (
        <ChatConversation>
          <ChatConversationContent>
            {visibleMessages.map((message, index) => (
              <AgentMessage
                canRespond={!isBusy}
                isStreaming={agent.status === "streaming" && index === visibleMessages.length - 1}
                key={message.id}
                message={message}
                onInputResponses={handleInputResponses}
              />
            ))}
            {thinkingPresence.shouldRender ? (
              <ThinkingMessage isVisible={thinkingPresence.isVisible} />
            ) : null}
          </ChatConversationContent>
          <ChatScrollButton />
        </ChatConversation>
      )}
    </>
  );
}

function appendPendingUserMessages(
  messages: readonly EveMessageData["messages"][number][],
  pendingMessages: readonly (EveMessage | null)[],
) {
  let nextMessages = messages;

  for (const pendingMessage of pendingMessages) {
    const pendingText = pendingMessage ? getMessageText(pendingMessage) : null;

    if (!pendingMessage || !pendingText || hasLatestUserMessage(nextMessages, pendingText)) {
      continue;
    }

    nextMessages = [...nextMessages, pendingMessage];
  }

  return nextMessages;
}

function createPendingUserMessage(
  chatId: string,
  text: string,
  idSuffix = "pending-user-message",
): EveMessage {
  return {
    id: `${chatId}:${idSuffix}`,
    metadata: {
      optimistic: true,
      status: "submitted",
    },
    parts: [
      {
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "user",
  };
}

function usePendingUserMessage() {
  const [message, setMessageState] = useState<string | null>(null);
  const messageRef = useRef<string | null>(null);

  const setMessage = useCallback((nextMessage: string | null) => {
    messageRef.current = nextMessage;
    setMessageState(nextMessage);
  }, []);

  const clearMessage = useCallback(() => {
    setMessage(null);
  }, [setMessage]);

  return { clearMessage, message, messageRef, setMessage };
}

function useThinkingPresence(active: boolean) {
  const [shouldRender, setShouldRender] = useState(active);
  const [isVisible, setIsVisible] = useState(active);

  useEffect(() => {
    if (active) {
      setShouldRender(true);

      const frame = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    setIsVisible(false);

    const timeout = window.setTimeout(() => {
      setShouldRender(false);
    }, THINKING_EXIT_DURATION_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [active]);

  return { isVisible, shouldRender };
}

function ThinkingMessage({ isVisible }: { readonly isVisible: boolean }) {
  return (
    <article
      aria-live={isVisible ? "polite" : "off"}
      className={[
        "flex w-full justify-start overflow-hidden transition-[opacity,transform,max-height] duration-200 ease-out",
        isVisible ? "max-h-8 translate-y-0 opacity-100" : "max-h-0 -translate-y-1 opacity-0",
      ].join(" ")}
      role="status"
    >
      <div className="px-3 text-[15px] font-medium leading-6 text-muted-foreground">
        <span className="shimmer-text">Thinking...</span>
      </div>
    </article>
  );
}

function BlankChatBody() {
  return <div className="min-h-0 flex-1" />;
}

export function ErrorToast({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      aria-live="assertive"
      className="fixed top-3 right-3 z-50 flex w-[calc(100vw-1.5rem)] max-w-sm items-start gap-3 rounded-md border border-destructive/30 bg-background/95 p-3 text-sm shadow-lg backdrop-blur sm:top-4 sm:right-4"
      role="alert"
    >
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Request failed</p>
        <p className="mt-0.5 text-muted-foreground">{message}</p>
      </div>
      <Button
        aria-label="Dismiss error"
        className="-mt-1 -mr-1 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function hasLatestUserMessage(
  messages: readonly EveMessageData["messages"][number][],
  text: string,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "user") {
      continue;
    }

    return getMessageText(message) === text.trim();
  }

  return false;
}

function getMessageText(message: EveMessageData["messages"][number]) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text || null;
}
