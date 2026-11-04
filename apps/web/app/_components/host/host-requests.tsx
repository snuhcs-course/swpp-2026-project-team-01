"use client";

import type { HostRequestItem, HostRequestOperation, HostRequestView } from "@lib/contracts/host-request";
import type { RequestState } from "@lib/contracts/request";
import { displayTime } from "@lib/contracts/timezone";
import { AlertCircleIcon, ArrowLeftIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GuestCard, GuestCardActions } from "@/app/_components/guest/guest-card";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { HostSettingsDialog } from "@/app/_components/host-settings-dialog";
import { ChatComposer } from "@/components/chat/composer";
import { ChatConversation, ChatConversationContent, ChatItem, ChatScrollButton } from "@/components/chat/conversation";
import { AgentMessage, AgentThinking } from "@/components/chat/message";
import { ChatTabs } from "@/components/chat/tabs";
import { Button } from "@/components/ui/button";
import { postHostCommand, readHostRequest, readHostRequests } from "@/lib/chat/host-requests";
import { type ChannelEntry, type MessageChannel, messagingChannels, messagingLabel, splitByChannel } from "@/lib/chat/channels";
import { errorMessage, useHostDiscussion } from "@/lib/chat/use-host-discussion";
import {
  BookingCard,
  type HostCardContext,
  nextHostStep,
  ProposalReviewCard,
  RuleTravelCard,
  SuggestionCard,
  SuggestionEditor,
} from "./host-request-cards";
import { MessagingDiscussion } from "./messaging-discussion";

// The host's requests in /app (host-review-and-booking design 2 and 3;
// chat-workspaces: host request inbox). With no request selected, the inbox
// lists the host's requests as selectable cards. A selected request
// (`/app?request={requestId}`) opens the host-private discussion with Thyme,
// followed by the one open decision card above the composer. The requester's
// own conversation is theirs alone and never shown here (D6), and nothing from
// the private side is ever sent to the requester.

const STATE_LABELS: Readonly<Record<RequestState, string>> = {
  awaiting_host_approval: "Waiting for your approval",
  booked: "Booked",
  booking: "Booking in progress",
  declined: "Declined",
  draft: "Draft",
  expired: "Expired",
  gathering: "Gathering details",
  negotiating: "Choosing a time",
  withdrawn: "Withdrawn",
};

// Polls while something is settling that no turn would reveal: a booking, a
// shared suggestion being checked, or an evaluation still running.
const SETTLING_POLL_MS = 3000;

function settling(view: HostRequestView | null) {
  return Boolean(
    view &&
      (view.booking?.state === "reserved" ||
        view.booking?.state === "dispatching" ||
        view.suggestion?.state === "checking" ||
        view.evaluation?.state === "pending"),
  );
}

function ErrorNotice({ message, onDismiss }: { readonly message: string; readonly onDismiss: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-2 sm:px-6" role="alert">
      <div className="flex items-start gap-3 rounded-2xl bg-[color-mix(in_srgb,var(--destructive)_8%,var(--surface))] p-4 text-sm">
        <AlertCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1">{message}</p>
        <Button aria-label="Dismiss" onClick={onDismiss} size="icon-sm" type="button" variant="ghost">
          <XIcon aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function HostRequests({ onOpenSetup, request }: { readonly onOpenSetup: () => void; readonly request: string | null }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const openInbox = useCallback(() => router.push("/app?view=requests"), [router]);
  const select = useCallback((requestId: string) => router.push(`/app?request=${encodeURIComponent(requestId)}`), [router]);
  const unavailable = useCallback(() => {
    setNotice("That request is not available.");
    router.replace("/app?view=requests");
  }, [router]);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <h1 className="wordmark-lockup min-w-0">Find Me a Time</h1>
        <div className="flex items-center"><HostSettingsDialog /><WorkspaceMenu onSelectRequests={openInbox} onSelectSetup={onOpenSetup} /></div>
      </header>
      {notice ? <ErrorNotice message={notice} onDismiss={() => setNotice(null)} /> : null}
      {request ? (
        <RequestView key={request} onBack={openInbox} onUnavailable={unavailable} requestId={request} />
      ) : (
        <Inbox onSelect={select} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The inbox

function Inbox({ onSelect }: { readonly onSelect: (requestId: string) => void }) {
  const [items, setItems] = useState<HostRequestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    readHostRequests(controller.signal)
      .then(setItems)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, []);

  return (
    <main aria-labelledby="inbox-heading" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-8 sm:px-6">
        <h2 className="pt-4 font-display text-[clamp(36px,5vw,52px)] leading-[1.05]" id="inbox-heading">
          Requests
        </h2>
        {error ? <p role="alert">{error}</p> : null}
        {items === null && !error ? (
          <p className="text-muted-foreground" role="status">
            Loading requests...
          </p>
        ) : null}
        {items?.length === 0 ? (
          <p className="text-muted-foreground">No requests yet. They appear here once a guest gives their name and email on your booking page.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {items?.map((item) => (
            <li key={item.requestId}>
              <button
                className="flex w-full min-w-0 flex-col gap-0.5 rounded-2xl bg-card px-5 py-4 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={() => onSelect(item.requestId)}
                type="button"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{item.requesterName}</span>
                  {item.needsDecision ? (
                    <span className="shrink-0 rounded-full border border-foreground px-2 py-0.5 text-xs">Needs your decision</span>
                  ) : null}
                </span>
                {item.purpose ? <span className="truncate text-muted-foreground">{item.purpose}</span> : null}
                <span className="text-muted-foreground">
                  {STATE_LABELS[item.state]}
                  {item.proposalStart ? ` · ${displayTime(new Date(item.proposalStart), Intl.DateTimeFormat().resolvedOptions().timeZone)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// One request

// A linked iMessage or WhatsApp shares the private discussion; its messages
// have their own tab (host-imessage-channel D25), shown once there are any.
type View = "private" | "messaging";

type HostDiscussion = ReturnType<typeof useHostDiscussion>;

function RequestView({ onBack, onUnavailable, requestId }: { readonly onBack: () => void; readonly onUnavailable: () => void; readonly requestId: string }) {
  const [view, setView] = useState<HostRequestView | null>(null);
  const [editing, setEditing] = useState(false);
  const retryKeys = useRef(new Map<string, string>());

  const reload = useCallback(async () => {
    try {
      const next = await readHostRequest(requestId);
      if (!next) onUnavailable();
      else setView(next);
    } catch {
      // A failed refresh keeps the last view; the next action or poll tries again.
    }
  }, [onUnavailable, requestId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const busy = settling(view);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void reload(), SETTLING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [busy, reload]);

  // Each card action keeps its retry key until the service answers, so a
  // repeated press after a lost answer is an exact retry.
  const run = useCallback(
    async (operation: HostRequestOperation, input: unknown, expectedRevision: number | null = view?.revision ?? null) => {
      const identity = `${operation}:${JSON.stringify(input)}:${expectedRevision}`;
      const retryKey = retryKeys.current.get(identity) ?? crypto.randomUUID();
      retryKeys.current.set(identity, retryKey);
      const outcome = await postHostCommand(requestId, operation, input, expectedRevision, retryKey);
      retryKeys.current.delete(identity);
      if (outcome.request) setView(outcome.request);
      return outcome.ok ? { ok: true as const } : { error: outcome.error, ok: false as const };
    },
    [requestId, view?.revision],
  );

  // The discussion stays loaded while the host switches tabs.
  const settled = useCallback(() => void reload(), [reload]);
  const chat = useHostDiscussion({ onSettled: settled, request: requestId });
  const entries = useMemo(() => splitByChannel(chat.messages), [chat.messages]);
  const channels = messagingChannels(entries);
  const channelLabel = messagingLabel(channels);
  const [tab, setTab] = useState<View>("private");
  const shown: View = channels.length > 0 ? tab : "private";
  // The open turn answers the channel of the latest host message.
  const turnChannel = chat.pendingText !== null ? "web" : (entries.at(-1)?.channel ?? "web");
  const streamingIndex = chat.phase === "streaming" ? chat.messages.length - 1 : null;

  return (
    <main aria-labelledby="request-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Button onClick={onBack} size="sm" type="button" variant="ghost">
            <ArrowLeftIcon aria-hidden className="size-4" />
            All requests
          </Button>
        </div>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate font-display text-[32px] leading-[1.1]" id="request-heading">
            {view ? view.requester.name : "Loading request..."}
          </h2>
          {view ? (
            <p className="text-sm text-muted-foreground" role="status">
              {STATE_LABELS[view.state]}
              {view.details.purpose ? ` · ${view.details.purpose}` : ""}
              {view.revisedFrom
                ? view.revisedFrom.outcome === "declined"
                  ? ` · Follows your decline of request ${view.revisedFrom.ref}`
                  : ` · Follows request ${view.revisedFrom.ref}, which expired`
                : ""}
            </p>
          ) : null}
        </div>
        {channels.length > 0 ? (
          <ChatTabs
            label="Discussion"
            onSelect={setTab}
            selected={shown}
            tabs={[
              { id: "private", label: "Private with Thyme" },
              { id: "messaging", label: `In ${channelLabel}` },
            ]}
          />
        ) : null}
      </div>
      {shown === "messaging" ? (
        <div aria-labelledby="tab-messaging" className="flex min-h-0 flex-1 flex-col" id="panel-messaging" role="tabpanel">
          <MessagingDiscussion
            busy={chat.phase !== "ready"}
            entries={entries.filter((entry) => entry.channel !== "web")}
            label={channelLabel}
            note={`Reply about this request in ${channelLabel}, or write to Thyme here on the Private with Thyme tab.`}
            streamingIndex={streamingIndex}
            thinking={chat.thinking && turnChannel !== "web"}
            turnFailed={chat.turnFailed && !chat.failed && chat.phase === "ready" && turnChannel !== "web"}
          />
        </div>
      ) : (
        <div
          {...(channels.length > 0 ? { "aria-labelledby": "tab-private", id: "panel-private", role: "tabpanel" } : {})}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PrivateDiscussion
            channelLabel={channelLabel}
            chat={chat}
            context={view ? { run, view } : null}
            editing={editing}
            entries={entries}
            setEditing={setEditing}
            streamingIndex={streamingIndex}
            thinking={chat.thinking && turnChannel === "web"}
            turnChannel={turnChannel}
          />
        </div>
      )}
    </main>
  );
}

function OpenCard({ context, editing, setEditing }: { readonly context: HostCardContext; readonly editing: boolean; readonly setEditing: (value: boolean) => void }) {
  const step = nextHostStep(context.view, editing);
  const requestChanges = () => setEditing(true);

  switch (step) {
    case "editor":
      return <SuggestionEditor context={context} onClose={() => setEditing(false)} />;
    case "suggestion":
      return <SuggestionCard context={context} onRequestChanges={requestChanges} />;
    case "booking":
      return <BookingCard context={context} />;
    case "rules":
      return <RuleTravelCard context={context} />;
    case "proposal":
      return <ProposalReviewCard context={context} onRequestChanges={requestChanges} />;
    case "find":
      return <FindCard context={context} onRequestChanges={requestChanges} />;
  }
}

// No proposal yet: the requester is still gathering details or choosing.
function FindCard({ context, onRequestChanges }: { readonly context: HostCardContext; readonly onRequestChanges: () => void }) {
  const closed = ["booked", "declined", "withdrawn", "expired"].includes(context.view.state);
  const [error, setError] = useState<string | null>(null);

  return (
    <GuestCard
      description={closed ? "This request is closed." : `${context.view.requester.name} has not chosen a time yet. You can look at times privately or suggest one.`}
      id="find"
      label="Request"
      title={closed ? STATE_LABELS[context.view.state] : "No proposal yet"}
    >
      {closed ? null : (
        <GuestCardActions>
          <Button
            onClick={async () => {
              const outcome = await context.run("request.host_evaluate", {}, null);
              setError(outcome.ok ? null : outcome.error.message);
            }}
            type="button"
            variant="outline"
          >
            Find times
          </Button>
          <Button onClick={onRequestChanges} type="button" variant="ghost">
            Request changes
          </Button>
        </GuestCardActions>
      )}
      <div aria-live="polite" role="status">
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
    </GuestCard>
  );
}

function PrivateDiscussion({
  channelLabel,
  chat,
  context,
  editing,
  entries,
  setEditing,
  streamingIndex,
  thinking,
  turnChannel,
}: {
  readonly channelLabel: string;
  readonly chat: HostDiscussion;
  readonly context: HostCardContext | null;
  readonly editing: boolean;
  readonly entries: readonly ChannelEntry[];
  readonly setEditing: (value: boolean) => void;
  readonly streamingIndex: number | null;
  readonly thinking: boolean;
  readonly turnChannel: MessageChannel;
}) {
  const busy = chat.phase !== "ready";
  const web = entries.filter((entry) => entry.channel === "web");

  return (
    <>
      {chat.error ? <ErrorNotice message={chat.error} onDismiss={() => chat.setError(null)} /> : null}
      {chat.failed ? (
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6" role="status">
          <div className="flex flex-col gap-3 rounded-3xl bg-card p-5 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm">Thyme stopped responding in this conversation. Your messages and history are kept.</p>
            <Button disabled={chat.phase === "recovering"} onClick={() => void chat.recover()} type="button">
              {chat.phase === "recovering" ? "Restarting..." : "Restart Thyme"}
            </Button>
          </div>
        </div>
      ) : null}
      <ChatConversation>
        <ChatConversationContent aria-busy={busy} aria-label="Private messages">
          {web.length === 0 && chat.phase === "ready" ? (
            <p className="px-3 text-sm text-muted-foreground">
              Ask Thyme about this request: why a time works, or what to suggest instead. The requester never sees this conversation.
            </p>
          ) : null}
          {web.map((entry) => (
            <ChatItem key={entry.message.id} messageId={entry.message.id} scrollAnchor={entry.message.role === "user"}>
              <AgentMessage
                canRespond={false}
                isStreaming={entry.index === streamingIndex}
                message={entry.message}
                onInputResponses={() => {}}
              />
            </ChatItem>
          ))}
          {chat.pendingText ? (
            <ChatItem messageId="pending" scrollAnchor>
              <AgentMessage
                canRespond={false}
                isStreaming={false}
                message={{ id: "pending", parts: [{ state: "done", text: chat.pendingText, type: "text" }], role: "user" }}
                onInputResponses={() => {}}
              />
            </ChatItem>
          ) : null}
          {chat.turnFailed && !chat.failed && chat.phase === "ready" && turnChannel === "web" ? (
            <p className="px-3 text-sm text-muted-foreground" role="status">
              Thyme couldn&apos;t finish this reply. Your message is saved; try again in a little while.
            </p>
          ) : null}
          {chat.thinking && turnChannel !== "web" ? (
            <p className="px-3 text-sm text-muted-foreground" role="status">
              Thyme is replying in {channelLabel}.
            </p>
          ) : null}
          {thinking ? (
            <ChatItem messageId="thinking">
              <AgentThinking withHeader={chat.pendingText !== null || web.at(-1)?.message.role !== "assistant"} />
            </ChatItem>
          ) : null}
          {context ? (
            <ChatItem messageId="host-card">
              <div aria-label="Decision" className="flex min-w-0 flex-col" role="group">
                <OpenCard context={context} editing={editing} setEditing={setEditing} />
              </div>
            </ChatItem>
          ) : null}
        </ChatConversationContent>
        <ChatScrollButton />
      </ChatConversation>
      <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6">
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          <ChatComposer
            disabled={chat.phase === "loading" || chat.phase === "recovering"}
            disabledReason={chat.failed ? "Restart Thyme to continue this conversation." : undefined}
            isBusy={chat.phase === "sending" || chat.phase === "streaming"}
            onChange={chat.setDraft}
            onStop={() => {}}
            onSubmit={chat.send}
            placeholder="Message Thyme privately about this request"
            value={chat.draft}
          />
        </div>
      </div>
    </>
  );
}
