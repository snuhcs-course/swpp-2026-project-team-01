"use client";

import type { ComponentProps } from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";

// The workspace thread, on the shadcn/ui Chat pattern: a Message Scroller that
// opens at the latest turn, anchors each of the host's messages near the top
// and follows a streaming reply while the reader stays at the live edge. The
// content is the transcript's log, named by the caller.

export function ChatConversation({ children, className, ...props }: ComponentProps<typeof MessageScroller>) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className={cn("min-h-0 flex-1", className)} {...props}>
        {children}
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function ChatConversationContent({
  children,
  className,
  viewportLabel = "Conversation",
  ...props
}: ComponentProps<typeof MessageScrollerContent> & { readonly viewportLabel?: string }) {
  return (
    <MessageScrollerViewport aria-label={viewportLabel}>
      <MessageScrollerContent
        className={cn("mx-auto w-full max-w-2xl gap-4 px-4 py-6 sm:px-6", className)}
        {...props}
      >
        {children}
      </MessageScrollerContent>
    </MessageScrollerViewport>
  );
}

// One turn or block of the thread. The host's own messages anchor the view.
export function ChatItem(props: ComponentProps<typeof MessageScrollerItem>) {
  return <MessageScrollerItem {...props} />;
}

export function ChatScrollButton({ className, ...props }: ComponentProps<typeof MessageScrollerButton>) {
  return (
    <MessageScrollerButton aria-label="Scroll to latest message" className={cn("rounded-full", className)} variant="outline" {...props} />
  );
}
