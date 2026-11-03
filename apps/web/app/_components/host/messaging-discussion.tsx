"use client";

import type { ReactNode } from "react";
import { ChatConversation, ChatConversationContent, ChatItem, ChatScrollButton } from "@/components/chat/conversation";
import { AgentMessage, AgentThinking } from "@/components/chat/message";
import type { ChannelEntry } from "@/lib/chat/channels";

// What the host and Thyme said in the host's linked iMessage or WhatsApp, on
// its own tab of the discussion it shares with /app (host-imessage-channel
// D20). It is read-only: the host replies in the app, and the composer on the
// web tab writes to the same discussion.

export function MessagingDiscussion({
  busy,
  entries,
  label,
  note,
  streamingIndex,
  thinking,
  turnFailed,
}: {
  readonly busy: boolean;
  readonly entries: readonly ChannelEntry[];
  readonly label: string;
  readonly note: ReactNode;
  readonly streamingIndex: number | null;
  readonly thinking: boolean;
  readonly turnFailed: boolean;
}) {
  return (
    <>
      <ChatConversation>
        <ChatConversationContent aria-busy={busy} aria-label={`Messages in ${label}`}>
          {entries.map((entry) => (
            <ChatItem key={entry.message.id} messageId={`channel-${entry.message.id}`} scrollAnchor={entry.message.role === "user"}>
              <AgentMessage
                canRespond={false}
                isStreaming={entry.index === streamingIndex}
                message={entry.message}
                onInputResponses={() => {}}
              />
            </ChatItem>
          ))}
          {turnFailed ? (
            <p className="px-3 text-sm text-muted-foreground" role="status">
              Thyme couldn&apos;t finish this reply. The message is saved; try again in a little while.
            </p>
          ) : null}
          {thinking ? (
            <ChatItem messageId="channel-thinking">
              <AgentThinking withHeader={entries.at(-1)?.message.role !== "assistant"} />
            </ChatItem>
          ) : null}
        </ChatConversationContent>
        <ChatScrollButton />
      </ChatConversation>
      <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6">
        <p className="mx-auto w-full max-w-2xl px-4 text-sm text-muted-foreground sm:px-6" role="note">
          {note}
        </p>
      </div>
    </>
  );
}
