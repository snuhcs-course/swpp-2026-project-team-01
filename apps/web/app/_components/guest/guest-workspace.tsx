"use client";

import type { DiscussionEvent } from "@lib/contracts/discussion-events";
import type { OpenRequesterView, RequesterView, ThreadCard } from "@lib/contracts/requester-view";
import { displayTime } from "@lib/contracts/timezone";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarSelectionCard,
  ConnectCalendarCard,
  focusCardHeading,
  type RequesterCardContext,
  StatusCard,
  useRequesterCards,
} from "@/app/_components/requester/cards";
import { CandidatesCard, calendarSettled, DetailsCard, ProposalCard, ReviewCard } from "@/app/_components/requester/request-cards";
import { ResendLinkForm } from "@/app/_components/requester/resend-link-form";
import { AgentMessage } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatRequestError } from "@/lib/chat/discussion";
import { guestDiscussionClient, type GuestPostOutcome, readNdjson } from "@/lib/chat/guest";
import { GuestCard, GuestCardActions, GuestReceipt } from "./guest-card";
import { GuestConversation, projectMessages, type ThreadEntry } from "./guest-conversation";
import { browserLanguage, TimezoneLine, useGuestTimezone } from "./timezone";

// The guest workspace (design decisions 2 and 12, D13): one conversation with
// Thyme from the guest's first message on a ready host's /{handle} to
// agreement, the same component on the public page and on /booking/{bookingId}.
// The first message starts a draft request; the tab keeps its booking
// identifier in sessionStorage, never in the address bar, until the guest gives
// a name and email on the identity card. Identification then moves the address
// bar to the booking link with history.replaceState, in place: nothing reloads
// and the thread and its session stay the same. After a Google return or a
// reload, the booking page loads the same thread from its stored events.
//
// Every card (identity, review, details, status with the creation email,
// Calendar connection and selection, candidate times, proposal) is an entry of
// the thread, placed where the conversation called for it and kept in the
// history as a receipt once answered or superseded. The timezone is a chip at
// the start of the thread. Only the composer sits below it.

function draftKey(handle: string) {
  return `fmat.draft:${handle}`;
}

function nonceKey(handle: string) {
  return `fmat.draft-nonce:${handle}`;
}

function readStored(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Without storage the draft lasts for this page view only.
  }
}

const GOOGLE_NOTICES: Readonly<Record<string, string>> = {
  cancelled: "Google sign-in was cancelled. Nothing was changed; continue with or without Google.",
  connected: "Google is connected for this request.",
  identified: "Google filled in your name and email. Your request continues here.",
  limited: "Too many new requests from your network right now. Try again later.",
};

const RECEIPT_LABELS = {
  identity: "Your details",
  proposal: "Proposal",
  review: "Drafted details",
  times: "Times",
} as const;

function timeText(start: string, end: string | undefined, timeZone: string) {
  const from = displayTime(new Date(start), timeZone);
  return end ? `${from} to ${displayTime(new Date(end), timeZone).split(", ")[1]}` : from;
}

export function GuestWorkspace({
  bookingId: initialBookingId = null,
  chrome,
  host,
  initialView = null,
}: {
  // The booking page's identifier and view; the public page passes neither.
  readonly bookingId?: string | null;
  // The public page's collapsed chrome (the agent section and link resend).
  readonly chrome?: ReactNode;
  readonly host: { readonly displayName: string; readonly handle: string | null };
  readonly initialView?: OpenRequesterView | null;
}) {
  const bookingRef = useRef<string | null>(initialBookingId);
  const nonceRef = useRef("");
  const [bookingId, setBookingId] = useState<string | null>(initialBookingId);
  const [view, setView] = useState<OpenRequesterView | null>(initialView);
  const [ready, setReady] = useState(initialBookingId !== null);
  // A new key starts a fresh thread, when the tab's draft is gone.
  const [threadKey, setThreadKey] = useState(0);
  const [notice, setNotice] = useState<{ readonly at: string; readonly text: string } | null>(null);
  const [detailsAt, setDetailsAt] = useState<string | null>(null);
  const timezone = useGuestTimezone();
  const handle = host.handle;

  const forgetDraft = useCallback(() => {
    if (handle) {
      writeStored(draftKey(handle), null);
      writeStored(nonceKey(handle), null);
    }
    nonceRef.current = crypto.randomUUID();
    if (handle) writeStored(nonceKey(handle), nonceRef.current);
  }, [handle]);

  // A view from the state route; on the public page, an identified request
  // takes its booking link into the address bar in place.
  const accept = useCallback(
    (id: string, next: OpenRequesterView) => {
      setView(next);
      if (next.request.state !== "draft" && window.location.pathname !== `/booking/${id}`) {
        window.history.replaceState(null, "", `/booking/${id}`);
        if (handle) writeStored(draftKey(handle), null);
      }
    },
    [handle],
  );

  const refresh = useCallback(async () => {
    const id = bookingRef.current;
    if (!id) return;

    try {
      const response = await fetch(`/api/requests/${id}/state`, { cache: "no-store" });
      const next = (await response.json()) as RequesterView;

      if (response.ok && next.open) {
        accept(id, next);
        return;
      }

      // The booking page shows the closed or unavailable request itself; a
      // draft that is gone from the public page starts over.
      if (window.location.pathname.startsWith("/booking/")) {
        window.location.reload();
        return;
      }

      forgetDraft();
      bookingRef.current = null;
      setBookingId(null);
      setView(null);
      setThreadKey((key) => key + 1);
    } catch {
      // The cards keep their last view; the next action refreshes again.
    }
  }, [accept, forgetDraft]);

  useEffect(() => {
    const google = new URLSearchParams(window.location.search).get("google");
    if (google) {
      setNotice(GOOGLE_NOTICES[google] ? { at: new Date().toISOString(), text: GOOGLE_NOTICES[google]! } : null);
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (initialBookingId !== null || !handle) return;

    nonceRef.current = readStored(nonceKey(handle)) ?? crypto.randomUUID();
    writeStored(nonceKey(handle), nonceRef.current);
    const stored = readStored(draftKey(handle));

    if (!stored) {
      setReady(true);
      return;
    }

    void (async () => {
      try {
        const response = await fetch(`/api/requests/${stored}/state`, { cache: "no-store" });
        const next = (await response.json()) as RequesterView;
        if (response.ok && next.open) {
          bookingRef.current = stored;
          setBookingId(stored);
          accept(stored, next);
        } else {
          forgetDraft();
        }
      } catch {
        // The tab's draft is kept for the next load.
      } finally {
        setReady(true);
      }
    })();
  }, [accept, forgetDraft, handle, initialBookingId]);

  const client = useMemo(
    () => guestDiscussionClient(() => ({ bookingId: bookingRef.current, handle, nonce: nonceRef.current })),
    [handle],
  );

  // The first message answers the draft's identifier, also when it failed after
  // the draft existed.
  const onAccepted = useCallback(
    (outcome: GuestPostOutcome) => {
      if (!outcome.bookingId || bookingRef.current === outcome.bookingId) return;
      bookingRef.current = outcome.bookingId;
      setBookingId(outcome.bookingId);
      if (handle) writeStored(draftKey(handle), outcome.bookingId);
      void refresh();
    },
    [handle, refresh],
  );

  const onError = useCallback(
    (error: unknown) => {
      const code = (error as ChatRequestError).code;
      if (bookingRef.current && (code === "unavailable" || code === "closed")) void refresh();
    },
    [refresh],
  );

  const extra = useCallback(() => ({ language: browserLanguage(), timezone: timezone.zone }), [timezone.zone]);

  const details = useMemo(
    () => ({ close: () => setDetailsAt(null), open: () => setDetailsAt(new Date().toISOString()) }),
    [],
  );
  const context = useRequesterCards(bookingId, view, timezone.zone, refresh, details);

  const entries = useMemo(() => {
    const list: ThreadEntry[] = context ? threadEntries(context, view?.thread ?? []) : [];
    if (context && detailsAt) list.push({ at: detailsAt, id: "meeting-details", node: <DetailsCard context={context} /> });
    if (notice) {
      list.push({
        at: notice.at,
        id: "notice",
        node: (
          <p className="px-1 text-sm text-muted-foreground" role="status">
            {notice.text}
          </p>
        ),
      });
    }
    return list;
  }, [context, detailsAt, notice, view?.thread]);

  useFocusNewCards(entries);

  const identified = view !== null && view.request.state !== "draft";
  const before = (
    <div className="flex flex-col gap-3 pb-2">
      <section className="flex flex-col gap-1">
        <p className="font-medium text-muted-foreground text-sm">{identified ? "Meeting request with" : "Find Me a Time host"}</p>
        <h1 className="break-words font-display text-[clamp(28px,4vw,40px)] leading-tight">{host.displayName}</h1>
        {host.handle ? <p className="font-mono text-muted-foreground">@{host.handle}</p> : null}
      </section>
      <p className="text-sm">
        {identified
          ? "This conversation is private to you: anyone with its link can act on this request, so keep the link to yourself."
          : "Requests are accepted here, and you do not need an account. Tell Thyme what the meeting is about; when Thyme asks, give your name and email in this conversation, with or without Google."}
      </p>
      {chrome && !identified ? chrome : null}
      <TimezoneLine onChoose={timezone.choose} zone={timezone.zone} />
      {view?.hasIntakeTranscript && bookingId ? <IntakeTranscript bookingId={bookingId} /> : null}
    </div>
  );

  if (!ready) return <p className="sr-only" role="status">Loading...</p>;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <GuestConversation
        ariaLabel={`Meeting request with ${host.displayName}`}
        before={before}
        client={client}
        entries={entries}
        extra={extra}
        key={threadKey}
        onAccepted={onAccepted}
        onError={onError}
        onRecover={
          bookingId
            ? async (generation) => {
                const response = await fetch(`/api/requests/${bookingId}/recover`, {
                  body: JSON.stringify({ observedGeneration: generation }),
                  headers: { "content-type": "application/json" },
                  method: "POST",
                });
                return (await response.json()) as { status: string; delivered?: boolean };
              }
            : undefined
        }
        onSettled={() => void refresh()}
        placeholder="Message Thyme"
      />
    </div>
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

// The domain cards as thread entries: an open card renders its card, an
// answered one its receipt, a superseded one its receipt marked out of date
// with a way to the current card of its kind. Open entries are named
// open:{card element id}:{thread card id}.
function threadEntries(context: RequesterCardContext, thread: readonly ThreadCard[]): ThreadEntry[] {
  const { view } = context;
  const entries: ThreadEntry[] = [];
  const zone = context.timezone;
  const openKinds = new Set(thread.filter((card) => card.status === "open").map((card) => card.kind));
  const current = (domId: string, label: string) => (
    <Button className="h-8 min-h-8 px-1 text-xs" onClick={() => context.focusCard(domId)} type="button" variant="link">
      Go to the current {label}
    </Button>
  );
  const open = (domId: string, card: ThreadCard, node: ReactNode) =>
    entries.push({ at: card.at, id: `open:${domId}:${card.id}`, node });
  const receipt = (card: ThreadCard, label: string, value: ReactNode, action?: ReactNode, outOfDate = false) =>
    entries.push({
      at: card.at,
      id: card.id,
      node: <GuestReceipt action={action} id={card.id} label={label} outOfDate={outOfDate} value={value} />,
    });

  for (const card of thread) {
    switch (card.kind) {
      case "identity":
        if (card.status === "open") open("guest-identity", card, <IdentityCard context={context} />);
        else receipt(card, RECEIPT_LABELS.identity, card.receipt?.text);
        break;
      case "review":
        if (card.status === "open" && view.pendingReview && card.id === `review:${view.pendingReview.id}`) {
          open("review", card, <ReviewCard context={context} />);
        } else if (card.status === "superseded") {
          receipt(card, RECEIPT_LABELS.review, "An earlier draft", openKinds.has("review") ? current("review", "review") : undefined, true);
        } else {
          receipt(card, RECEIPT_LABELS.review, card.receipt?.text ?? "Answered");
        }
        break;
      case "status":
        open("request-status", card, <StatusCard context={context} />);
        break;
      case "calendar":
        if (!view.connection.calendar) {
          if (context.dismissed.has("calendar-connect")) {
            receipt(
              card,
              "Your calendar",
              "Not connected",
              <Button className="h-8 min-h-8 px-1 text-xs" onClick={() => context.reopen("calendar-connect")} type="button" variant="link">
                Connect Google Calendar
              </Button>,
            );
          } else {
            open("calendar-connect", card, <ConnectCalendarCard context={context} />);
          }
        } else if (context.dismissed.has("calendar-selection")) {
          receipt(
            card,
            "Your calendar",
            "Connected",
            <Button className="h-8 min-h-8 px-1 text-xs" onClick={() => context.reopen("calendar-selection")} type="button" variant="link">
              Calendar settings
            </Button>,
          );
        } else {
          open("calendar-selection", card, <CalendarSelectionCard context={context} />);
        }
        break;
      case "times":
        if (card.status === "open") {
          // Find times waits for the calendar step; an evaluation shows at once.
          if (card.id !== "times:find" || calendarSettled(context)) open("candidates", card, <CandidatesCard context={context} />);
        } else if (card.status === "answered" && card.receipt?.start) {
          receipt(card, RECEIPT_LABELS.times, `You chose ${timeText(card.receipt.start, card.receipt.end, zone)}`);
        } else {
          receipt(card, RECEIPT_LABELS.times, "Earlier times", openKinds.has("times") ? current("candidates", "times") : undefined, true);
        }
        break;
      case "proposal":
        if (card.status === "open" && view.proposal && card.id === `proposal:${view.proposal.version}`) {
          open("proposal", card, <ProposalCard context={context} />);
        } else if (card.status === "answered" && card.receipt?.start) {
          receipt(card, RECEIPT_LABELS.proposal, `You agreed to ${timeText(card.receipt.start, card.receipt.end, zone)}`);
        } else {
          receipt(card, RECEIPT_LABELS.proposal, "An earlier proposal", openKinds.has("proposal") ? current("proposal", "proposal") : undefined, true);
        }
        break;
    }
  }

  return entries;
}

// The identity card (design decision 2): **Continue with Google** (name and
// email, and optionally read-only Calendar, on one Google screen) or **Continue
// without Google** with a name and email. The Google button is always shown.
// Either moves the draft to gathering; the page then shows the booking link in
// the address bar, in place.
function IdentityCard({ context }: { readonly context: RequesterCardContext }) {
  const id = useId();
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueWithoutGoogle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email address.");
      return;
    }

    setBusy(true);
    setError(null);
    const outcome = await context.run(
      "request.identify",
      { email: email.trim(), language: browserLanguage(), name: name.trim(), timezone: context.timezone },
      null,
    );
    setBusy(false);

    if (!outcome.ok) {
      setError(
        outcome.error.category === "invalid_input"
          ? "Enter your name and a valid email address."
          : (outcome.error.message ?? "That did not go through. Try again in a moment."),
      );
    }
  }

  return (
    <GuestCard
      description="Continue with Google to fill in your name and email, and optionally let the service check your calendar privately. Or enter them yourself. Times are offered right after."
      id="guest-identity"
      label="Your details"
      title="How should the host reach you?"
    >
      <form action="/connections/google/start" method="post">
        <input name="purpose" type="hidden" value="request" />
        <input name="bookingId" type="hidden" value={context.bookingId} />
        <input name="timezone" type="hidden" value={context.timezone} />
        <input name="language" type="hidden" value={browserLanguage()} />
        <GuestCardActions>
          <Button className="min-h-11" type="submit">
            Continue with Google
          </Button>
          {!manual ? (
            <Button className="min-h-11" onClick={() => setManual(true)} type="button" variant="outline">
              Continue without Google
            </Button>
          ) : null}
        </GuestCardActions>
      </form>
      {manual ? (
        <form className="flex flex-col gap-2" noValidate onSubmit={(event) => void continueWithoutGoogle(event)}>
          <div className="flex flex-col gap-1">
            <label className="font-medium" htmlFor={`${id}-name`}>
              Your name
            </label>
            <Input
              autoComplete="name"
              autoFocus
              className="min-h-11"
              id={`${id}-name`}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium" htmlFor={`${id}-email`}>
              Email address
            </label>
            <Input
              aria-describedby={error ? `${id}-error` : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="email"
              className="min-h-11"
              id={`${id}-email`}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>
          <p className="text-muted-foreground">We email you a private booking link. Confirming the address is optional.</p>
          <GuestCardActions>
            <Button className="min-h-11" disabled={busy} type="submit">
              {busy ? "Continuing..." : "Continue without Google"}
            </Button>
          </GuestCardActions>
        </form>
      ) : null}
      <div aria-live="polite" role="status">
        {error ? (
          <p className="text-destructive" id={`${id}-error`}>
            {error}
          </p>
        ) : null}
      </div>
    </GuestCard>
  );
}

// The public page's chrome, collapsed by default above the thread: the agent
// section for AI agents and **Resend my booking link**.
export function PublicPageChrome({ agentSection }: { readonly agentSection: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <details className="rounded-xl border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer font-medium">For AI agents</summary>
        <div className="pt-3">{agentSection}</div>
      </details>
      <details className="rounded-xl border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer font-medium">Already made a request?</summary>
        <div className="pt-3">
          <ResendLinkForm heading="Lost your booking link?" />
        </div>
      </details>
    </div>
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
    <details className="rounded-xl border border-border px-4 py-3 text-sm" open>
      <summary className="cursor-pointer font-medium">Your conversation on the public page</summary>
      <div aria-label="Earlier conversation, read only" className="flex flex-col gap-2 pt-3" role="log">
        {messages.map((message) => (
          <AgentMessage canRespond={false} isStreaming={false} key={message.id} message={message} onInputResponses={() => {}} />
        ))}
      </div>
    </details>
  );
}
