"use client";

import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import type { RequestState } from "@lib/contracts/request";
import type { OpenRequesterView, RequesterView, ThreadCard } from "@lib/contracts/requester-view";
import { displayTime } from "@lib/contracts/timezone";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectedAgentsDialog, requestGrantSource } from "@/app/_components/connected-agents";
import {
  AwaitingCard,
  CalendarSelectionCard,
  ConnectCalendarCard,
  GroupDoneCard,
  GroupReviewCard,
  HostProfileCard,
  ImessageUpdates,
  EmailLinkLine,
  focusCardHeading,
  type AgreementFailure,
  type RequesterCardContext,
  SentLine,
  useRequesterCards,
} from "@/app/_components/requester/cards";
import { AppliedDetailsCard, CandidatesCard, DetailsCard, MeetingDetailsList, ModeChoiceCard, ProposalCard, ReviewCard, searchedFor } from "@/app/_components/requester/request-cards";
import { AgentMessage } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import type { ChatRequestError } from "@/lib/chat/discussion";
import { guestDiscussionClient, readNdjson } from "@/lib/chat/guest";
import { GuestReceipt } from "./guest-card";
import { GuestConversation, projectMessages, type ThreadEntry } from "./guest-conversation";
import { MeetingActions, type MeetingActionMode } from "./meeting-actions";
import { AuthoredMessages } from "@/app/_components/setup/authored-messages";
import { CALENDAR_REOPENED, guestComposerState } from "./composer-state";
import { GuestFrame, openingMessages, RequestPanel } from "./guest-frame";
import { useGuestTimezone } from "./timezone";

// The guest workspace on the booking page (design decisions 2 and 12;
// guest-flow-completion U13): one conversation with Thyme for an identified
// request. The fixed steps come first and need no model: identity, then the
// Calendar step. A fixed message then asks what the meeting is for, with what
// the host offers, and from there the composer is open and the assistant
// gathers the rest in conversation; its review card records it, and applying
// it finds times.
//
// Every card (review, details, Calendar, candidate times, proposal) is an
// entry of the thread, placed where the conversation called for it. At most
// one is open, the current next step's (DESIGN.md: one thing to think about at
// once); an answered one stays as the guest's reply, with **Change** where
// changing is allowed. Sent requests show their actions above the composer;
// before that, the guest adjusts the request by writing to Thyme.

// What Google's return says, under the card it concerns: the name and email
// receipt, or the Calendar card.
const GOOGLE_NOTICES: Readonly<Record<string, { readonly card: string; readonly text: string }>> = {
  connected: { card: "calendar", text: "Google is connected for this request." },
  identified: { card: "identity", text: "Google filled in your name and email." },
};

// The fixed question that hands over to the assistant, with what the host
// offers every guest.
function meetingQuestion(view: OpenRequesterView) {
  const { durationMinutes, meetingMode, venue } = view.meeting;
  const form =
    meetingMode === "either" ? "online or in person" : meetingMode === "online" ? "online" : venue ? `in person at ${venue}` : "in person";
  return `What would you like to meet ${view.host.displayName} about? ${view.host.displayName} offers ${durationMinutes}-minute meetings, ${form}. If you already know when suits you, tell me that too.`;
}

// The Calendar receipt when the guest continued without connecting one.
export const CALENDAR_NOT_CONNECTED = "Not connected · You’ll tell Thyme your times";

const RECEIPT_LABELS = {
  identity: "Your details",
  meeting: "Meeting",
  proposal: "Proposal",
  review: "Drafted details",
  times: "Times",
} as const;

export function meetingActionMode(state: RequestState, standingBooking: boolean, reopenedBy?: "host" | "requester" | null): MeetingActionMode | null {
  if (state === "awaiting_host_approval") return "pending";
  if (state === "booking") return "booking";
  if (standingBooking || reopenedBy) return "changing";
  return null;
}

function timeText(start: string, end: string | undefined, timeZone: string) {
  const from = displayTime(new Date(start), timeZone);
  return end ? `${from} to ${displayTime(new Date(end), timeZone).split(", ")[1]}` : from;
}

export function GuestWorkspace({
  bookingId,
  host,
  initialView,
  workspaceLink = false,
}: {
  readonly bookingId: string;
  readonly host: { readonly displayName: string; readonly handle: string | null };
  readonly initialView: OpenRequesterView;
  // The signed-in account this request is linked to (host-as-guest-session).
  readonly workspaceLink?: boolean;
}) {
  const [view, setView] = useState<OpenRequesterView>(initialView);
  const currentView = useRef<OpenRequesterView>(initialView);
  const [notice, setNotice] = useState<{ readonly card: string; readonly text: string } | null>(null);
  const [detailsAt, setDetailsAt] = useState<string | null>(null);
  // The proposal version whose candidate times the guest reopened to choose again.
  const [choosingAgain, setChoosingAgain] = useState<number | null>(null);
  // **Change** on the host-profile receipt reopens its card until the guest decides again.
  const [profileAgain, setProfileAgain] = useState(false);
  const [agreementDialog, setAgreementDialog] = useState<
    { readonly kind: "success"; readonly version: number } | ({ readonly kind: "failure" } & AgreementFailure) | null
  >(null);
  const agreementFocusCard = useRef<"awaiting" | AgreementFailure["focusCard"]>("awaiting");
  const timezone = useGuestTimezone();
  // The thread's send, for the online or in person buttons.
  const sendRef = useRef<((text: string) => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${bookingId}/state`, { cache: "no-store" });
      const next = (await response.json()) as RequesterView;

      if (response.ok && next.open) {
        currentView.current = next;
        setView(next);
        return;
      }

      // The booking page shows the closed or unavailable request itself.
      window.location.reload();
    } catch {
      // The cards keep their last view; the next action refreshes again.
    }
  }, [bookingId]);

  useEffect(() => {
    const google = new URLSearchParams(window.location.search).get("google");
    if (!google) return;
    setNotice(GOOGLE_NOTICES[google] ?? null);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const client = useMemo(() => guestDiscussionClient(bookingId), [bookingId]);

  const onError = useCallback(
    (error: unknown) => {
      const code = (error as ChatRequestError).code;
      if (code === "unavailable" || code === "closed") void refresh();
    },
    [refresh],
  );

  const details = useMemo(
    () => ({ close: () => setDetailsAt(null), open: () => setDetailsAt(new Date().toISOString()) }),
    [],
  );
  const chooseAnotherTime = useCallback(() => setChoosingAgain(view.proposal?.version ?? null), [view.proposal?.version]);
  const onAgreed = useCallback((version: number) => {
    agreementFocusCard.current = "awaiting";
    setAgreementDialog({ kind: "success", version });
  }, []);
  const onAgreementFailure = useCallback((failure: AgreementFailure) => {
    // A lost response may follow a committed agreement. The refreshed request
    // state is authoritative; never tell the guest it failed if it now waits.
    if (["awaiting_host_approval", "booking", "booked"].includes(currentView.current.request.state)) return;
    agreementFocusCard.current = failure.focusCard;
    setAgreementDialog({ kind: "failure", ...failure });
  }, []);
  const context = useRequesterCards(bookingId, view, timezone.zone, refresh, details, chooseAnotherTime, onAgreed, onAgreementFailure);

  // The fixed steps hand over to the assistant once the Calendar step is first
  // done; a Calendar step that reopens later leaves the composer usable and
  // moves its card to where the thread is now, under Thyme's line about it
  // (#373).
  const composer = guestComposerState(view);
  const handedOver = view.handedOver;
  // Set after render, so the server and the first client render agree.
  const [reopenedAt, setReopenedAt] = useState<string | null>(null);
  useEffect(() => setReopenedAt(composer.calendarReopened ? new Date().toISOString() : null), [composer.calendarReopened]);

  const { entries, panel } = useMemo(() => {
    const placed = context
      ? threadEntries(context, view.thread, {
          choosingAgain: choosingAgain !== null && choosingAgain === view.proposal?.version,
          editing: detailsAt !== null,
          handedOver,
          reopenedAt,
          profile: { again: profileAgain, close: () => setProfileAgain(false), reopen: () => setProfileAgain(true) },
          send: async (text) => sendRef.current?.(text),
        })
      : { entries: [], panel: [] };
    const list: ThreadEntry[] = placed.entries.map((entry) =>
      notice && (entry.id === notice.card || entry.id.endsWith(`:${notice.card}`))
        ? {
            ...entry,
            node: (
              <>
                {entry.node}
                <p className="mt-2 px-1 text-sm text-muted-foreground" role="status">
                  {notice.text}
                </p>
              </>
            ),
          }
        : entry,
    );
    if (context && detailsAt) list.push({ at: detailsAt, id: "meeting-details", node: <DetailsCard context={context} /> });
    return { entries: list, panel: placed.panel };
  }, [choosingAgain, context, detailsAt, handedOver, notice, profileAgain, reopenedAt, view.proposal?.version, view.thread]);

  useFocusNewCards(entries);

  // **Request details** (U12): whose request it is, the timezone, a summary of
  // every answered step, the creation email's line and how private the page is.
  const meetingDetails = view.request.details;
  const hasMeetingDetails = Boolean(meetingDetails.purpose || meetingDetails.mode || meetingDetails.location || meetingDetails.windows?.length || meetingDetails.preferredWindows?.length || meetingDetails.lessPreferredWindows?.length || meetingDetails.preferredWeeklyWindows?.length);
  const meetingPatch = {
    ...(meetingDetails.purpose ? { purpose: meetingDetails.purpose } : {}),
    ...(meetingDetails.durationMinutes ? { durationMinutes: meetingDetails.durationMinutes } : {}),
    ...(meetingDetails.mode ? { mode: meetingDetails.mode } : {}),
    ...(meetingDetails.location ? { location: meetingDetails.location } : {}),
    ...(meetingDetails.linkPlan ? { linkPlan: meetingDetails.linkPlan } : {}),
    ...(meetingDetails.travelMode ? { travelMode: meetingDetails.travelMode } : {}),
    ...(meetingDetails.windows?.length ? { windows: meetingDetails.windows } : {}),
    ...(meetingDetails.preferredWindows?.length ? { preferredWindows: meetingDetails.preferredWindows } : {}),
    ...(meetingDetails.lessPreferredWindows?.length ? { lessPreferredWindows: meetingDetails.lessPreferredWindows } : {}),
    ...(meetingDetails.preferredWeeklyWindows?.length ? { preferredWeeklyWindows: meetingDetails.preferredWeeklyWindows } : {}),
  };
  const aside = (
    <RequestPanel host={host}>
      <RequestGrantAction bookingId={bookingId} />
      {hasMeetingDetails ? <section className="flex flex-col gap-2 py-2"><h3 className="font-semibold">Meeting details</h3><MeetingDetailsList patch={meetingPatch} timeZone={timezone.zone} preferenceTimezone={meetingDetails.timezone} contact={view.contact} /></section> : null}
      {context && view.request.state !== "awaiting_host_approval" ? <ImessageUpdates context={context} onlyLinked /> : null}
      {panel.length
        ? [...panel].filter((entry) => !hasMeetingDetails || entry.id !== "identity").sort((a, b) => a.at.localeCompare(b.at)).map((entry) => <div key={entry.id}>{entry.node}</div>)
        : null}
    </RequestPanel>
  );

  // The web start's opening messages stay at the top of the thread.
  const before = (
    <>
      <AuthoredMessages messages={openingMessages(host.displayName)} />
      {view.hasIntakeTranscript ? <IntakeTranscript bookingId={bookingId} /> : null}
    </>
  );

  const showAgreementDialog = agreementDialog?.kind === "failure" || (
    agreementDialog?.kind === "success"
    && view.request.state === "awaiting_host_approval"
    && view.proposal?.version === agreementDialog.version
  );

  const actionMode = meetingActionMode(view.request.state, view.booking?.state === "confirmed", view.reopenedBy);

  return (
    <>
      <GuestFrame aside={aside} asideLabel={`Request with ${host.displayName}`} workspaceLink={workspaceLink}>
        <GuestConversation
          ariaLabel={`Meeting request with ${host.displayName}`}
          before={before}
          client={client}
          composerFlags={actionMode ? (
            <MeetingActions bookingId={bookingId} mode={actionMode} revision={view.request.revision} standingBooking={view.booking?.state === "confirmed"} />
          ) : null}
          entries={entries}
          onError={onError}
          onRecover={async (generation) => {
            const response = await fetch(`/api/requests/${bookingId}/recover`, {
              body: JSON.stringify({ observedGeneration: generation }),
              headers: { "content-type": "application/json" },
              method: "POST",
            });
            return (await response.json()) as { status: string; delivered?: boolean };
          }}
          onSettled={() => void refresh()}
          placeholder="Write to Thyme"
          closedReason={composer.closedReason}
          lockedReason={composer.lockedReason}
          sendRef={sendRef}
        />
      </GuestFrame>
      <Dialog onOpenChange={(open) => { if (!open) setAgreementDialog(null); }} open={showAgreementDialog}>
        <DialogContent
          className="rounded-3xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusCardHeading(agreementFocusCard.current);
          }}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="text-center text-base leading-snug">
              {agreementDialog?.kind === "failure" ? agreementDialog.title : "Request sent successfully"}
            </DialogTitle>
            <DialogDescription className={agreementDialog?.kind === "failure" ? "text-center" : "sr-only"}>
              {agreementDialog?.kind === "failure" ? agreementDialog.message : "View the request card for its current status."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="items-center sm:justify-center">
            <DialogClose asChild>
              <Button className="min-h-11" type="button">
                {agreementDialog?.kind === "failure" ? agreementDialog.action : "View request"}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// One answered step in **Request details**: what it was and what was chosen.
function SummaryRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col py-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="break-words text-base">{value}</span>
    </div>
  );
}

// A fixed message in Thyme's voice, written by the page rather than the model,
// on the same Message pattern as the onboarding's authored messages.
function FixedMessage({ text }: { readonly text: string }) {
  return (
    <article className="w-full min-w-0" data-authored-message="">
      <Message>
        <MessageContent className="gap-1.5 text-base leading-[1.65] text-foreground">
          <MessageHeader>Thyme</MessageHeader>
          <p className="px-3 break-words">{text}</p>
        </MessageContent>
      </Message>
    </article>
  );
}

// The open cards' entries, in thread order; when an action or a turn opens a
// new one, focus moves to its heading so keyboard and screen reader users
// continue from there.
function useFocusNewCards(entries: readonly ThreadEntry[]) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const open = entries.filter((entry) => entry.id.startsWith("open:")).map((entry) => entry.id);
    const previous = seen.current;
    seen.current = new Set(open);
    if (!previous) return;
    const added = open.filter((id) => !previous.has(id));
    const last = added.at(-1);
    if (last) focusCardHeading(last.split(":")[1]!);
  }, [entries]);
}

// The domain cards as thread entries. The server marks at most one card open,
// the current next step's; the page keeps it that way: while the meeting
// details editor is open it is the open card, and **Choose another time**
// reopens the candidate times in place of the proposal. Every other card is a
// receipt: answered with what was chosen and **Change** where allowed, waiting
// until its step comes, or out of date with a way to the current card. Open
// entries are named open:{card element id}:{thread card id}.
export function threadEntries(
  context: RequesterCardContext,
  thread: readonly ThreadCard[],
  options: {
    readonly editing: boolean;
    readonly choosingAgain: boolean;
    readonly handedOver: boolean;
    // When a Calendar step reopened after the handover was first seen here.
    readonly reopenedAt: string | null;
    readonly profile: { readonly again: boolean; readonly close: () => void; readonly reopen: () => void };
    readonly send: (text: string) => Promise<void>;
  },
): { readonly entries: ThreadEntry[]; readonly panel: ThreadEntry[] } {
  const { view } = context;
  const entries: ThreadEntry[] = [];
  // What was answered stays in the thread as the guest's reply, and is listed
  // again in **Request details** (U12); a waiting or out-of-date step is left
  // out.
  const panel: ThreadEntry[] = [];
  const zone = context.timezone;
  const change = (label: string, onClick: () => void) => (
    <Button aria-label={label} className="h-8 min-h-8 px-1 text-xs" onClick={onClick} type="button" variant="link">
      Change
    </Button>
  );
  const status = (card: ThreadCard): ThreadCard["status"] => {
    if (card.kind === "times" && options.choosingAgain && card.id === `times:${view.evaluation?.id}`) return "open";
    if (card.kind === "host_profile" && options.profile.again) return "open";
    if (card.status !== "open") return card.status;
    if (options.editing || (card.kind === "proposal" && options.choosingAgain)) return "waiting";
    return "open";
  };
  const open = (domId: string, card: ThreadCard, node: ReactNode) => entries.push({ at: card.at, id: `open:${domId}:${card.id}`, node });
  const receipt = (card: ThreadCard, label: string, value: ReactNode, action?: ReactNode) => {
    entries.push({ at: card.at, id: card.id, node: <GuestReceipt action={action} id={card.id} label={label} value={value} /> });
    panel.push({ at: card.at, id: card.id, node: <SummaryRow label={label} value={value} /> });
  };
  const choosing = view.request.state === "gathering" || view.request.state === "negotiating";

  for (const card of thread) {
    const state = status(card);

    switch (card.kind) {
      case "identity":
        if (card.receipt?.text === "Continued with Google") {
          entries.push({ at: card.at, id: card.id, node: <GuestReceipt id={card.id} label="" value="Continued with Google" /> });
          panel.push({ at: card.at, id: card.id, node: <SummaryRow label={RECEIPT_LABELS.identity} value={view.contact ? `${view.contact.name} · ${view.contact.email}` : "Your name and email"} /> });
        } else {
          receipt(card, RECEIPT_LABELS.identity, card.receipt?.text ?? "Your name and email");
        }
        break;
      case "meeting":
        // Thyme's question, once the Calendar step is done; the guest answers
        // it in the composer. The purpose is in the details summary.
        if (options.handedOver) {
          entries.push({ at: card.at, id: "meeting-question", node: <FixedMessage text={meetingQuestion(view)} /> });
        }
        break;
      case "review":
        if (state === "open" && view.pendingReview && card.id === `review:${view.pendingReview.id}`) {
          // A question with nothing to apply is Thyme's message alone, except
          // online or in person, which gets its two buttons (U22).
          if (view.pendingReview.patch) open("review", card, <ReviewCard context={context} />);
          else if (view.pendingReview.clarifications.includes("missing_mode")) {
            open("mode-choice", card, <ModeChoiceCard context={context} onAnswer={options.send} />);
          }
        } else if (state === "answered" && card.receipt?.patch) {
          entries.push({
            at: card.at,
            id: card.id,
            node: <AppliedDetailsCard contact={view.contact} patch={card.receipt.patch} timeZone={zone} preferenceTimezone={view.request.details.timezone} action={choosing ? change("Change the meeting details", context.openDetails) : undefined} />,
          });
        }
        break;
      case "status":
        // Waiting for the host is where the request stands now, so it stays in
        // the thread; the creation email's line goes to the panel.
        (card.id === "status:awaiting" ? entries : panel).push({
          at: card.at,
          id: card.id,
          node:
            card.id === "status:awaiting" ? (
              <AwaitingCard context={context} />
            ) : (
              <>
                <SentLine context={context} />
                <EmailLinkLine context={context} />
              </>
            ),
        });
        break;
      case "host_profile":
        if (state === "open") {
          open("host-profile", card, <HostProfileCard context={context} onDone={options.profile.close} />);
        } else if (state === "answered") {
          receipt(card, "Host settings", card.receipt?.text ?? "Not now", choosing ? change("Change your host settings", options.profile.reopen) : undefined);
        }
        break;
      case "calendar":
        if (state === "open") {
          // Reopened after the handover: placed where the thread is now, with
          // Thyme saying why it is back.
          const placed = options.reopenedAt ? { ...card, at: options.reopenedAt } : card;
          const line = options.reopenedAt ? <FixedMessage text={CALENDAR_REOPENED} /> : null;
          if (view.connection.calendar) open("calendar-selection", placed, <>{line}<CalendarSelectionCard context={context} /></>);
          else open("calendar-connect", placed, <>{line}<ConnectCalendarCard context={context} /></>);
        } else if (state === "answered") {
          const action = choosing && !view.group
            ? change("Change your calendar", () => void context.run("request.set_manual_availability", { manual: false }))
            : undefined;
          if (card.receipt?.text === "Connected") {
            const name = view.contact?.name ?? "your";
            const value = name === "your" ? "Connected your calendar" : `Connected ${name}’s Calendar`;
            entries.push({ at: card.at, id: card.id, node: <GuestReceipt action={action} id={card.id} label="" value={value} /> });
            panel.push({ at: card.at, id: card.id, node: <SummaryRow label="Calendar" value="Connected" /> });
          } else {
            // Not connecting is a choice, not a missed step: say what happens
            // instead (#424).
            entries.push({ at: card.at, id: card.id, node: <GuestReceipt action={action} id={card.id} label="Calendar" value={CALENDAR_NOT_CONNECTED} /> });
            panel.push({ at: card.at, id: card.id, node: <SummaryRow label="Calendar" value="Not connected" /> });
          }
        }
        break;
      case "times":
        if (state === "open") {
          const ready = view.evaluation?.state === "completed";
          const found = view.evaluation?.candidates.some((candidate) => !candidate.unresolvedRequesterLeg) ?? false;
          const text = searchedFor(context, found);
          open("candidates", card, <>{ready ? <FixedMessage text={text} /> : null}<CandidatesCard context={context} /></>);
        }
        else if (state === "answered" && card.receipt?.start) {
          const text = card.id === `times:${view.evaluation?.id}`
            ? searchedFor(context, true)
            : view.request.details.language === "ko" ? "가능한 시간을 찾았어요. 편한 시간을 골라 주세요." : "I found some available times. Please choose one that works for you.";
          entries.push({ at: card.at, id: `${card.id}:intro`, node: <FixedMessage text={text} /> });
          // No reply bubble: the guest named the time in a message or pressed
          // it on the card, and the proposal that follows shows it (U22). The
          // choice stays in **Request details**.
          panel.push({
            at: card.at,
            id: card.id,
            node: <SummaryRow label={RECEIPT_LABELS.times} value={timeText(card.receipt.start, card.receipt.end, zone)} />,
          });
        }
        break;
      case "group_question":
        // Thyme's one question (group-scheduling design 3), once Calendar is
        // connected; the guest answers it in the composer.
        if (state !== "waiting") entries.push({ at: card.at, id: "group-question", node: <FixedMessage text={groupQuestion(view)} /> });
        break;
      case "group_review":
        if (state === "open") open("group-review", card, <GroupReviewCard context={context} />);
        else if (state === "answered") receipt(card, "Times you can't meet", "Confirmed");
        break;
      case "group_done":
        open("group-done", card, <GroupDoneCard context={context} />);
        break;
      case "proposal":
        if (state === "open" && view.proposal && card.id === `proposal:${view.proposal.version}`) {
          const text = view.request.details.language === "ko" ? "선택하신 시간을 확인해 주세요. 동의하시면 호스트의 승인을 기다립니다." : "Please review the time you chose. If you agree, the host can review it.";
          open("proposal", card, <><FixedMessage text={text} /><ProposalCard context={context} /></>);
        } else if (state === "answered" && card.receipt?.start) {
          const text = view.request.details.language === "ko" ? "선택하신 시간을 확인해 주세요. 동의하시면 호스트의 승인을 기다립니다." : "Please review the time you chose. If you agree, the host can review it.";
          entries.push({ at: card.at, id: `${card.id}:intro`, node: <FixedMessage text={text} /> });
          // Until the host approves, the agreed time can be changed (D10).
          receipt(
            card,
            RECEIPT_LABELS.proposal,
            // A host's pick from several times, or the several times agreed
            // to (multiple-candidate-times), say so.
            card.receipt.text === "The host chose" || card.receipt.text.startsWith("You agreed to ")
              ? `${card.receipt.text}${card.receipt.text === "The host chose" ? "" : ", the first"} ${timeText(card.receipt.start, card.receipt.end, zone)}`
              : `You agreed to ${timeText(card.receipt.start, card.receipt.end, zone)}`,
            view.request.state === "awaiting_host_approval" && card.id === `proposal:${view.proposal?.version}`
              ? change("Change the agreed time", () => void context.run("request.change_agreement", {}, view.request.revision))
              : undefined,
          );
        }
        break;
    }
  }

  // The conversation keeps its history; the details panel shows only the
  // latest selected or agreed time, without repeating earlier versions.
  const isTime = (entry: ThreadEntry) => entry.id.startsWith("times:") || entry.id.startsWith("proposal:");
  const latestTime = panel.filter(isTime).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return { entries, panel: panel.filter((entry) => !isTime(entry) || entry === latestTime) };
}

function RequestGrantAction({ bookingId }: { readonly bookingId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const source = useMemo(() => requestGrantSource(bookingId), [bookingId]);

  return (
    <>
      <Button className="min-h-11 self-start px-0" onClick={() => setOpen(true)} ref={triggerRef} type="button" variant="link">Connected agents</Button>
      <ConnectedAgentsDialog onOpenChange={setOpen} open={open} returnFocus={triggerRef} source={source} />
    </>
  );
}

// The transcript of a public-page intake from before D13, read only, at the
// start of a request that came from one.
function IntakeTranscript({ bookingId }: { readonly bookingId: string }) {
  const [events, setEvents] = useState<DiscussionEvent[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/requests/${bookingId}/intake?cursor=0`, { cache: "no-store", signal: controller.signal });
        const collected: DiscussionEvent[] = [];
        for await (const event of readNdjson(response)) collected.push(event);
        setEvents(collected);
      } catch {
        if (!controller.signal.aborted) setEvents([]);
      }
    })();
    return () => controller.abort();
  }, [bookingId]);

  const messages = useMemo(() => (events ? projectMessages(events) : []), [events]);

  if (!events || messages.length === 0) return null;

  return (
    <details className="rounded-3xl bg-card px-5 py-4 text-sm" open>
      <summary className="cursor-pointer font-medium">Your conversation on the public page</summary>
      <div aria-label="Earlier conversation, read only" className="flex flex-col gap-2 pt-3" role="log">
        {messages.map((message) => (
          <AgentMessage canRespond={false} isStreaming={false} key={message.id} message={message} onInputResponses={() => {}} />
        ))}
      </div>
    </details>
  );
}

// The one question a group's participant answers before their review.
function groupQuestion(view: OpenRequesterView) {
  return view.request.details.language === "ko"
    ? "몇 가지만 알려 주세요: 선호하는 시간대, 평소 계신 곳(동네 정도면 돼요), 주로 이동하는 방법(자동차, 대중교통, 도보), 그리고 이 기간에 캘린더에 없는 일정이 있다면 언제인지요."
    : "A few quick things: which hours suit you best, where you usually are (a neighborhood is enough), how you usually travel (car, public transit or walking), and any times in this period you can't meet that aren't on your calendar.";
}
