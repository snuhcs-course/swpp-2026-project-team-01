"use client";

import type { HostRequestOperation, HostRequestView } from "@lib/contracts/host-request";
import type { RequestState } from "@lib/contracts/request";
import type { WorkspaceRequestItem } from "@lib/contracts/workspace-request";
import { displayTime } from "@lib/contracts/timezone";
import { AlertCircleIcon, ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GuestCard, GuestCardActions } from "@/app/_components/guest/guest-card";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { HostSettingsDialog } from "@/app/_components/host-settings-dialog";
import { ChatComposer } from "@/components/chat/composer";
import { ChatConversation, ChatConversationContent, ChatItem, ChatScrollButton } from "@/components/chat/conversation";
import { AgentMessage, AgentThinking } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import { postHostCommand, readHostRequest, readWorkspaceRequests } from "@/lib/chat/host-requests";
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
  cancelled: "Cancelled",
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

export function HostRequests({ onOpenDashboard, request }: { readonly onOpenDashboard?: () => void; readonly request: string | null }) {
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
        <div className="flex items-center"><HostSettingsDialog /><WorkspaceMenu onSelectDashboard={onOpenDashboard} onSelectRequests={openInbox} /></div>
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
  const [items, setItems] = useState<WorkspaceRequestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "received" | "sent">("all");

  useEffect(() => {
    const controller = new AbortController();
    readWorkspaceRequests(controller.signal)
      .then(setItems)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, []);

  const received = items?.filter((item) => item.direction === "received").length ?? 0;
  const sent = items?.filter((item) => item.direction === "sent").length ?? 0;
  const shown = items?.filter((item) => filter === "all" || item.direction === filter) ?? [];

  return (
    <main aria-labelledby="inbox-heading" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-8 sm:px-6">
        <h2 className="pt-4 font-display text-[clamp(36px,5vw,52px)] leading-[1.05]" id="inbox-heading">
          Requests
        </h2>
        <p className="mt-3 mb-7 text-sm text-muted-foreground">Every meeting request you sent or received, in one place.</p>
        <div aria-label="Filter requests" className="mb-5 flex w-fit max-w-full gap-1 rounded-full bg-secondary p-1" role="group">
          {([[
            "all", "All", items?.length ?? 0,
          ], ["received", "Received", received], ["sent", "Sent", sent]] as const).map(([value, label, count]) => (
            <button
              aria-pressed={filter === value}
              className={`min-h-10 rounded-full px-4 text-xs font-semibold transition-colors ${filter === value ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"}`}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label} <span className="ml-1 opacity-70">{count}</span>
            </button>
          ))}
        </div>
        {error ? <p role="alert">{error}</p> : null}
        {items === null && !error ? (
          <p className="text-muted-foreground" role="status">
            Loading requests...
          </p>
        ) : null}
        {items?.length === 0 ? (
          <p className="text-muted-foreground">No requests yet. Requests you receive or send with your Google account will appear here.</p>
        ) : null}
        {items && items.length > 0 ? <p aria-live="polite" className="mb-2 text-xs font-semibold text-muted-foreground">{shown.length} {shown.length === 1 ? "request" : "requests"}</p> : null}
        {items && items.length > 0 && shown.length === 0 ? <p className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">No requests in this view yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <li key={item.requestId}>
              <RequestListCard item={item} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

function RequestListCard({ item, onSelect }: { readonly item: WorkspaceRequestItem; readonly onSelect: (requestId: string) => void }) {
  const received = item.direction === "received";
  const status = item.needsDecision ? "Needs your decision" : !received && item.state === "awaiting_host_approval" ? "Awaiting approval" : STATE_LABELS[item.state];
  const content = (
    <>
      <span className="mb-3 flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${received ? "border-primary bg-primary text-primary-foreground" : "border-primary bg-card text-primary"}`}>
          {received ? <ArrowLeftIcon aria-hidden className="size-3.5" /> : <ArrowRightIcon aria-hidden className="size-3.5" />}
          {received ? "Received request" : "Sent request"}
        </span>
        <span className={`text-xs font-semibold ${item.needsDecision ? "text-[#c62828]" : item.state === "booked" ? "text-success" : "text-muted-foreground"}`}>{status}</span>
      </span>
      <span className="text-base font-semibold">{item.counterpartyName}</span>
      {item.purpose ? <span className="truncate text-sm text-body">{item.purpose}</span> : null}
      <span className="mt-4 flex w-full items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{item.proposalStart ? displayTime(new Date(item.proposalStart), Intl.DateTimeFormat().resolvedOptions().timeZone) : "Time not set yet"}</span>
        {received || item.bookingPath ? <ChevronRightIcon aria-hidden className="size-4 shrink-0" /> : null}
      </span>
      {!received && !item.bookingPath ? <span className="mt-1 text-xs text-muted-foreground">Private request link expired</span> : null}
    </>
  );
  const className = "flex w-full min-w-0 flex-col rounded-2xl bg-card px-5 py-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  if (received) return <button className={className} onClick={() => onSelect(item.requestId)} type="button">{content}</button>;
  if (item.bookingPath) return <a className={className} href={item.bookingPath}>{content}</a>;
  return <div className="flex w-full min-w-0 flex-col rounded-2xl bg-card px-5 py-4 text-left">{content}</div>;
}

// ---------------------------------------------------------------------------
// One request

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
      </div>
      <PrivateDiscussion
        context={view ? { run, view } : null}
        editing={editing}
        onReload={reload}
        requestId={requestId}
        setEditing={setEditing}
      />
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
  const closed = ["booked", "declined", "withdrawn", "expired", "cancelled"].includes(context.view.state);
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
  context,
  editing,
  onReload,
  requestId,
  setEditing,
}: {
  readonly context: HostCardContext | null;
  readonly editing: boolean;
  readonly onReload: () => Promise<void>;
  readonly requestId: string;
  readonly setEditing: (value: boolean) => void;
}) {
  const settled = useCallback(() => void onReload(), [onReload]);
  const chat = useHostDiscussion({ onSettled: settled, request: requestId });
  const busy = chat.phase !== "ready";

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
          {chat.messages.length === 0 && chat.phase === "ready" ? (
            <p className="px-3 text-sm text-muted-foreground">
              Ask Thyme about this request: why a time works, or what to suggest instead. The requester never sees this conversation.
            </p>
          ) : null}
          {chat.messages.map((message, index) => (
            <ChatItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
              <AgentMessage
                canRespond={false}
                isStreaming={chat.phase === "streaming" && index === chat.messages.length - 1}
                message={message}
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
          {chat.turnFailed && !chat.failed && chat.phase === "ready" ? (
            <p className="px-3 text-sm text-muted-foreground" role="status">
              Thyme couldn&apos;t finish this reply. Your message is saved; try again in a little while.
            </p>
          ) : null}
          {chat.thinking ? (
            <ChatItem messageId="thinking">
              <AgentThinking withHeader={chat.pendingText !== null || chat.lastMessage?.role !== "assistant"} />
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
