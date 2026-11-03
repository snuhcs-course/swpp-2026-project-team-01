"use client";

import { AlertCircleIcon, XIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HostRequests } from "@/app/_components/host/host-requests";
import { MessagingDiscussion } from "@/app/_components/host/messaging-discussion";
import { IMESSAGE_CARD_ID, ImessageCard, rememberedLater, rememberLater } from "@/app/_components/imessage/imessage-card";
import { AuthoredMessages, useAuthoredReveal } from "@/app/_components/setup/authored-messages";
import { focusCurrentCard, SetupCards } from "@/app/_components/setup/setup-cards";
import { ReceiptAnnouncer, SetupReceipts } from "@/app/_components/setup/receipt";
import { deriveReceipts, interleave, type Receipt } from "@/app/_components/setup/receipts";
import { type SetupContextValue, SetupProvider, useSetupController } from "@/app/_components/setup/setup-context";
import { focusCard } from "@/app/_components/setup/card";
import { describeSetupTool } from "@/app/_components/setup/tool-labels";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { HostSettingsDialog } from "@/app/_components/host-settings-dialog";
import "@/app/_components/ink/ink.css";
import { ChatComposer } from "@/components/chat/composer";
import { ChatConversation, ChatConversationContent, ChatItem, ChatScrollButton } from "@/components/chat/conversation";
import { AgentMessage, AgentThinking } from "@/components/chat/message";
import { ChatTabs } from "@/components/chat/tabs";
import { Button } from "@/components/ui/button";
import { messagingChannels, messagingLabel, splitByChannel } from "@/lib/chat/channels";
import { useHostDiscussion } from "@/lib/chat/use-host-discussion";

// The host workspace at /app: one centered conversation, a reachable composer
// and a compact menu, with no sidebar. Setup lives in the same column: the
// authored onboarding messages open the conversation, answered setup cards stay
// in the history as one-line receipts where they were answered, and the one
// open card follows the last message, above the composer. The menu's Requests
// item, or `?request={requestId}`, opens the request inbox and a request's view
// in the same column instead (host-review-and-booking design 3).

// While a scan is pending the analysis card polls, since no turn or action
// would otherwise reveal its result.
const ANALYSIS_POLL_MS = 4000;

// The Connect iMessage card (H11) follows the share links once setup is ready,
// until the host links or chooses Maybe later, which this browser remembers; the
// menu's iMessage item opens it at any step.

// Messages from a linked iMessage or WhatsApp, which shares this discussion,
// have their own tab, shown once there are any (host-imessage-channel D20).
type View = "web" | "messaging";

export function HostWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const request = params.get("request");
  const inbox = params.get("view") === "requests" || request !== null;
  const openRequests = useCallback(() => router.push("/app?view=requests"), [router]);
  const openSetup = useCallback(() => router.push("/app"), [router]);

  if (inbox) {
    return <HostRequests onOpenSetup={openSetup} request={request} />;
  }

  return <SetupWorkspace onOpenRequests={openRequests} />;
}

function SetupWorkspace({ onOpenRequests }: { readonly onOpenRequests: () => void }) {
  const composerRef = useRef<HTMLDivElement>(null);
  const setup = useSetupController();
  const reloadSetup = setup.reload;
  const reveal = useAuthoredReveal(setup.state);
  const settled = useCallback(() => void reloadSetup(), [reloadSetup]);
  const chat = useHostDiscussion({ onSettled: settled });
  const { draft, error, failed, messages, pendingText, phase, recover, send, setDraft, setError, thinking, times, turnFailed } = chat;
  const entries = useMemo(() => splitByChannel(messages), [messages]);
  const webEntries = useMemo(() => entries.filter((entry) => entry.channel === "web"), [entries]);
  const channels = messagingChannels(entries);
  const channelLabel = messagingLabel(channels);
  const [tab, setTab] = useState<View>("web");
  const view: View = channels.length > 0 ? tab : "web";
  // The open turn answers the channel of the latest host message.
  const turnChannel = pendingText !== null ? "web" : (entries.at(-1)?.channel ?? "web");
  const streamingIndex = phase === "streaming" ? messages.length - 1 : null;

  useEffect(() => {
    void reloadSetup();
  }, [reloadSetup]);

  const analyzing = setup.state?.nextAction === "analyzing";

  useEffect(() => {
    if (!analyzing) return;
    const timer = window.setInterval(() => void reloadSetup(), ANALYSIS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [analyzing, reloadSetup]);

  const [imessageLater, setImessageLater] = useState(false);
  const [imessageOpened, setImessageOpened] = useState(false);
  // Counts openings from the menu, so each one moves focus once the card is shown.
  const [imessageFocus, setImessageFocus] = useState(0);
  // Counts the menu's Setup choices, so focus moves once the web tab is shown.
  const [setupFocus, setSetupFocus] = useState(0);
  useEffect(() => setImessageLater(rememberedLater()), []);
  useEffect(() => {
    if (imessageFocus > 0) focusCard(IMESSAGE_CARD_ID);
  }, [imessageFocus]);

  const busy = phase !== "ready";
  const setupState = setup.state;
  const setupValue = setup.value;
  const showSetup = setupValue !== null && reveal.done;
  const showImessage = imessageOpened || (showSetup && setupState?.nextAction === "ready" && !imessageLater);
  const openImessage = useCallback(() => {
    setTab("web");
    setImessageOpened(true);
    setImessageFocus((count) => count + 1);
  }, []);
  // Answered setup cards, as receipts placed among the messages by time.
  const receipts = useMemo(
    () => (showSetup && setupValue ? deriveReceipts(setupValue.state, setupValue.skipped) : []),
    [setupValue, showSetup],
  );
  const timeline = useMemo(() => {
    const entries = interleave(
      webEntries.map(({ index, message }) => ({ at: times.get(message.id) ?? null, message: { index, message } })),
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
  }, [receipts, times, webEntries]);

  // The menu's Setup item leads to the current step's card, or the composer
  // while setup has not loaded.
  // Both are on the web tab, so it is shown first.
  const focusSetup = useCallback(() => {
    setTab("web");
    setSetupFocus((count) => count + 1);
  }, []);
  // Only a new choice moves focus, not setup finishing to load.
  const setupReady = useRef(false);
  setupReady.current = Boolean(setupState && reveal.done);
  useEffect(() => {
    if (setupFocus === 0) return;
    if (setupReady.current) focusCurrentCard();
    else composerRef.current?.querySelector("textarea")?.focus();
  }, [setupFocus]);

  return (
    <div className="onboarding-ink flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <h1 className="truncate font-display text-[clamp(26px,3vw,33px)] leading-none">Find Me a Time</h1>
        <div className="flex items-center"><HostSettingsDialog /><WorkspaceMenu onSelectImessage={openImessage} onSelectRequests={onOpenRequests} onSelectSetup={focusSetup} /></div>
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

        {channels.length > 0 ? (
          <div className="mx-auto w-full max-w-2xl px-4 pt-2 sm:px-6">
            <ChatTabs
              label="Conversation"
              onSelect={setTab}
              selected={view}
              tabs={[
                { id: "web", label: "Web chat" },
                { id: "messaging", label: channelLabel },
              ]}
            />
          </div>
        ) : null}

        {view === "messaging" ? (
          <div aria-labelledby="tab-messaging" className="flex min-h-0 flex-1 flex-col" id="panel-messaging" role="tabpanel">
            <MessagingDiscussion
              busy={busy}
              entries={entries.filter((entry) => entry.channel !== "web")}
              label={channelLabel}
              note={`Reply to Thyme in ${channelLabel}, or write here on the Web chat tab. Both continue the same setup.`}
              streamingIndex={streamingIndex}
              thinking={thinking && turnChannel !== "web"}
              turnFailed={turnFailed && !failed && phase === "ready" && turnChannel !== "web"}
            />
          </div>
        ) : null}

        <div
          {...(channels.length > 0 ? { "aria-labelledby": "tab-web", id: "panel-web", role: "tabpanel" } : {})}
          className="flex min-h-0 flex-1 flex-col"
          hidden={view !== "web"}
        >
          <ChatConversation>
            <ConversationSetup value={setupValue}>
              <ChatConversationContent aria-busy={busy} aria-label="Messages">
                <AuthoredMessages
                  messages={reveal.visible}
                  onTyped={reveal.onTyped}
                  thinking={reveal.thinking}
                  typingId={reveal.typingId}
                />
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
                        isStreaming={entry.index === streamingIndex}
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
                {turnFailed && !failed && phase === "ready" && turnChannel === "web" ? (
                  <p className="px-3 text-sm text-muted-foreground" role="status">
                    Thyme couldn&apos;t finish this reply. Your message is saved; try again in a little while.
                  </p>
                ) : null}
                {thinking && turnChannel !== "web" ? (
                <p className="px-3 text-sm text-muted-foreground" role="status">
                  Thyme is replying in {channelLabel}.
                </p>
              ) : null}
              {thinking && turnChannel === "web" ? (
                  <ChatItem messageId="thinking">
                    <AgentThinking withHeader={pendingText !== null || webEntries.at(-1)?.message.role !== "assistant"} />
                  </ChatItem>
                ) : null}
                {showSetup ? (
                  <ChatItem messageId="setup">
                    <div aria-label="Setup" className="flex min-w-0 flex-col" role="group">
                      <SetupCards />
                    </div>
                  </ChatItem>
                ) : null}
                {showImessage ? (
                  <ChatItem messageId="imessage">
                    <ImessageCard
                      onLater={() => {
                        rememberLater();
                        setImessageLater(true);
                        setImessageOpened(false);
                      }}
                    />
                  </ChatItem>
                ) : null}
              </ChatConversationContent>
            </ConversationSetup>
            <ChatScrollButton />
          </ChatConversation>
        </div>
        <ReceiptAnnouncer receipts={receipts} />
      </main>

      <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6" hidden={view !== "web"} ref={composerRef}>
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
// The provider is always there, so the conversation does not remount (and the
// iMessage card keeps its state) when setup finishes loading.
function ConversationSetup({ children, value }: { readonly children: ReactNode; readonly value: SetupContextValue | null }) {
  return <SetupProvider value={value}>{children}</SetupProvider>;
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
