"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatItem } from "@/components/chat/conversation";
import { AgentThinking } from "@/components/chat/message";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { storageKey } from "./format";
import type { SetupState } from "@/lib/setup/client";

// The authored onboarding messages (H3): fixed strings in Thyme's voice, chosen
// from verified setup state. On a first visit each one follows a short thinking
// pause and types in a word at a time, at the pace of Thyme's streamed replies,
// before the next begins; once a message has been shown, revisits and reduced
// motion show it at once. Browser storage keeps only which messages finished,
// per host, never their text.

// The thinking pause before each new message, and the typing pace (one word per tick).
export const REVEAL_INTERVAL_MS = 500;
export const TYPING_TICK_MS = 35;

export type AuthoredMessage = { readonly id: string; readonly text: string };

export const AUTHORED_TEXT = {
  calendarConnected: "Your Google Calendar is connected.",
  calendarPrompt: "Your Google Calendar isn't connected yet. Connect it so I can see your calendars.",
  chooseCalendars: "Next, choose which calendars I check for conflicts and where I add bookings.",
  greeting: "Hi, I'm Thyme. I'll help you set up how people book one-to-one meetings with you.",
} as const;

export function authoredMessages(state: Pick<SetupState, "calendar" | "nextAction">): AuthoredMessage[] {
  const messages: AuthoredMessage[] = [{ id: "greeting", text: AUTHORED_TEXT.greeting }];

  if (!state.calendar.connected) {
    messages.push({ id: "calendar-prompt", text: AUTHORED_TEXT.calendarPrompt });
  } else {
    messages.push({ id: "calendar-connected", text: AUTHORED_TEXT.calendarConnected });
  }

  if (state.nextAction !== "connect_calendar") {
    messages.push({ id: "choose-calendars", text: AUTHORED_TEXT.chooseCalendars });
  }

  return messages;
}

function readSeen(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(key: string, seen: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...seen]));
  } catch {
    // Storage may be unavailable (private mode); messages simply reveal again.
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Which messages are visible, which one is typing, and whether all are shown, so
// the step's card can follow the message before it. Nothing shows until setup
// state has loaded.
export function useAuthoredReveal(state: SetupState | null) {
  const messages = useMemo(() => (state ? authoredMessages(state) : []), [state]);
  const key = state ? `fmat.onboarding.${storageKey(state.account.googleEmail ?? "host")}` : null;
  const [shown, setShown] = useState<{ readonly key: string; readonly ids: ReadonlySet<string> } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);

  // Starts from what this browser already showed this host, or everything under
  // reduced motion.
  if (key && shown?.key !== key) {
    setShown({ ids: prefersReducedMotion() ? new Set(messages.map((message) => message.id)) : readSeen(key), key });
  }

  const ids = shown?.key === key ? shown.ids : null;
  const nextId = ids ? messages.find((message) => !ids.has(message.id))?.id : undefined;

  // After the thinking pause, the next message starts typing; reduced motion
  // shows it at once.
  useEffect(() => {
    if (!key || !nextId || typing) return;
    const finish = () =>
      setShown((current) => {
        if (!current || current.key !== key) return current;
        const updated = new Set(current.ids).add(nextId);
        writeSeen(key, updated);
        return { ids: updated, key };
      });
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    const timer = window.setTimeout(() => setTyping(nextId), REVEAL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [key, nextId, typing]);

  // A typed message counts as shown once its last word appears.
  const typed = (id: string) => {
    setTyping((current) => (current === id ? null : current));
    setShown((current) => {
      if (!current || !key || current.key !== key || current.ids.has(id)) return current;
      const updated = new Set(current.ids).add(id);
      writeSeen(key, updated);
      return { ids: updated, key };
    });
  };

  return {
    done: ids !== null && nextId === undefined,
    onTyped: typed,
    thinking: ids !== null && nextId !== undefined && typing === null,
    typingId: typing,
    visible: ids ? messages.filter((message) => ids.has(message.id) || message.id === typing) : [],
  };
}

// Types a fixed text a word at a time, then reports that it finished.
function TypedText({ onDone, text }: { readonly onDone: () => void; readonly text: string }) {
  const [length, setLength] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (length >= text.length) {
      done.current();
      return;
    }
    const timer = window.setTimeout(() => {
      let end = length;
      while (end < text.length && /\s/.test(text[end]!)) end += 1;
      while (end < text.length && !/\s/.test(text[end]!)) end += 1;
      setLength(end);
    }, TYPING_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [length, text]);

  return (
    <>
      <span aria-hidden>{text.slice(0, length)}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}

// Each authored message is a Thyme turn on the same Message pattern as the
// conversation's replies; while the next one is pending, Thyme's thinking
// indicator holds its place.
export function AuthoredMessages({
  messages,
  onTyped,
  thinking = false,
  typingId = null,
}: {
  readonly messages: readonly AuthoredMessage[];
  readonly onTyped?: (id: string) => void;
  readonly thinking?: boolean;
  readonly typingId?: string | null;
}) {
  return (
    <>
      {messages.map((message) => (
        <ChatItem key={message.id} messageId={`authored-${message.id}`}>
          <article className="w-full min-w-0" data-authored-message={message.id}>
            <Message>
              <MessageContent className="gap-1.5 text-base leading-[1.65] text-foreground">
                <MessageHeader>Thyme</MessageHeader>
                <p className="px-3 break-words">
                  {message.id === typingId ? (
                    <TypedText onDone={() => onTyped?.(message.id)} text={message.text} />
                  ) : (
                    message.text
                  )}
                </p>
              </MessageContent>
            </Message>
          </article>
        </ChatItem>
      ))}
      {thinking ? (
        <ChatItem messageId="authored-thinking">
          <AgentThinking withHeader />
        </ChatItem>
      ) : null}
    </>
  );
}
