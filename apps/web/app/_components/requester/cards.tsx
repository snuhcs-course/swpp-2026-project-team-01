"use client";

import type { OpenRequesterView } from "@lib/contracts/requester-view";
import { displayTime } from "@lib/contracts/timezone";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GuestCard, GuestCardActions, guestCardHeadingId } from "@/app/_components/guest/guest-card";
import { browserLanguage } from "@/app/_components/guest/timezone";
import { Button } from "@/components/ui/button";
import { DetailsButton } from "./request-cards";

// The guest thread's request cards (design decision 12; DESIGN.md: conversation
// card): the Calendar connection and selection, and the status card with the
// creation email, **Use verified Google email** and **Withdraw request**. The
// review, meeting details, proposal and candidate times cards are in
// request-cards.tsx and the identity card in guest-workspace.tsx. Every card is
// placed in the thread by guest-workspace.tsx; none sits outside it.

export type CommandOutcome =
  | { readonly ok: true; readonly result: unknown; readonly replayed: boolean }
  | { readonly ok: false; readonly error: { readonly category: string; readonly message: string }; readonly status?: string };

export type RequesterCardContext = {
  readonly bookingId: string;
  readonly view: OpenRequesterView;
  // The display timezone (the guest's explicit choice, else the browser's).
  readonly timezone: string;
  // Posts one command with its retry key: the same operation and input keep
  // their key until the service answers, so a resend after a lost response is
  // an exact retry. The view is refreshed afterwards.
  readonly run: (operation: string, input?: unknown, expectedRevision?: number | null) => Promise<CommandOutcome>;
  readonly refresh: () => Promise<void>;
  // Cards the requester set aside in this tab, such as Skip for now.
  readonly dismissed: ReadonlySet<string>;
  readonly dismiss: (cardId: string) => void;
  readonly reopen: (cardId: string) => void;
  // The meeting details editor, opened in the thread by **Edit details**.
  readonly openDetails: () => void;
  readonly closeDetails: () => void;
  // Moves focus to an open card's heading, as "the current one" from a receipt.
  readonly focusCard: (domId: string) => void;
};

export function focusCardHeading(domId: string) {
  const heading = document.getElementById(guestCardHeadingId(domId));
  heading?.scrollIntoView({ block: "center" });
  heading?.focus();
}

const DISMISSED_KEY = "fmat.cards.dismissed";

function readDismissed() {
  try {
    return new Set<string>(JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}

// The cards' context, or null until the thread has a request (before the
// guest's first message on the public page).
export function useRequesterCards(
  bookingId: string | null,
  view: OpenRequesterView | null,
  timezone: string,
  refresh: () => Promise<void>,
  details: { readonly open: () => void; readonly close: () => void },
) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const keys = useRef(new Map<string, string>());

  useEffect(() => setDismissed(readDismissed()), []);

  const store = useCallback((next: Set<string>) => {
    setDismissed(next);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // The choice still applies to this page view.
    }
  }, []);

  const run = useCallback(
    async (operation: string, input: unknown = {}, expectedRevision: number | null = null): Promise<CommandOutcome> => {
      if (!bookingId) return { error: { category: "internal", message: "Send a message first." }, ok: false };

      const identity = JSON.stringify([operation, input, expectedRevision]);
      const retryKey = keys.current.get(identity) ?? crypto.randomUUID();
      keys.current.set(identity, retryKey);

      try {
        const response = await fetch(`/api/requests/${bookingId}/commands`, {
          body: JSON.stringify({ expectedRevision, input, operation, retryKey }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = (await response.json().catch(() => null)) as CommandOutcome | null;
        keys.current.delete(identity);
        await refresh();
        return body ?? { error: { category: "internal", message: "Something went wrong. Try again later." }, ok: false };
      } catch {
        return { error: { category: "internal", message: "That did not go through. Try again." }, ok: false };
      }
    },
    [bookingId, refresh],
  );

  if (!bookingId || !view) return null;

  const context: RequesterCardContext = {
    bookingId,
    closeDetails: details.close,
    dismiss: (id) => store(new Set([...dismissed, id])),
    dismissed,
    focusCard: focusCardHeading,
    openDetails: details.open,
    refresh,
    reopen: (id) => store(new Set([...dismissed].filter((entry) => entry !== id))),
    run,
    timezone,
    view,
  };

  return context;
}

function ErrorLine({ message }: { readonly message: string | null }) {
  return (
    <div aria-live="polite" role="status">
      {message ? <p className="text-destructive">{message}</p> : null}
    </div>
  );
}

// **Connect Google Calendar** and **Skip for now**: the request-bound consent
// round trip, which returns to this page.
export function ConnectCalendarCard({ context }: { readonly context: RequesterCardContext }) {
  return (
    <GuestCard
      description="Your busy times then count automatically. Access is read-only, used only for this request, and event details are never shown to the host or the assistant."
      id="calendar-connect"
      label="Your calendar"
      title="Check your Google Calendar for times?"
    >
      <form action="/connections/google/start" method="post">
        <input name="purpose" type="hidden" value="request" />
        <input name="bookingId" type="hidden" value={context.bookingId} />
        <input name="timezone" type="hidden" value={context.timezone} />
        <input name="language" type="hidden" value={browserLanguage()} />
        <GuestCardActions>
          <Button className="min-h-11" type="submit">
            Connect Google Calendar
          </Button>
          <Button className="min-h-11" onClick={() => context.dismiss("calendar-connect")} type="button" variant="outline">
            Skip for now
          </Button>
        </GuestCardActions>
      </form>
    </GuestCard>
  );
}

type CalendarOption = { readonly id: string; readonly summary: string; readonly primary: boolean; readonly selected: boolean };

// The requester's calendar selection, primary preselected, with **Disconnect**.
export function CalendarSelectionCard({ context }: { readonly context: RequesterCardContext }) {
  const id = useId();
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/requests/${context.bookingId}/calendars`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json()) as { calendars?: CalendarOption[]; error?: string };
        if (!response.ok || !body.calendars) throw new Error(body.error);
        setCalendars(body.calendars);
        setChosen(new Set(body.calendars.filter((calendar) => calendar.selected).map((calendar) => calendar.id)));
      } catch {
        if (!controller.signal.aborted) setError("Your calendar list could not be read right now. You can disconnect or try again later.");
      }
    })();
    return () => controller.abort();
  }, [context.bookingId]);

  async function save() {
    setBusy(true);
    const outcome = await context.run("calendar.select", { calendarIds: [...chosen] });
    setBusy(false);
    if (outcome.ok) context.dismiss("calendar-selection");
    else setError(outcome.error.message);
  }

  async function disconnect() {
    setBusy(true);
    const outcome = await context.run("calendar.disconnect");
    setBusy(false);
    if (!outcome.ok) setError(outcome.error.message);
  }

  return (
    <GuestCard
      description="Busy times on the calendars you choose count for this request only."
      id="calendar-selection"
      label="Your calendar"
      title="Which calendars should count?"
    >
      {calendars ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Calendars</legend>
          {calendars.map((calendar) => (
            <label className="flex min-h-11 items-center gap-2" key={calendar.id}>
              <input
                checked={chosen.has(calendar.id)}
                className="size-4"
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(calendar.id);
                  else next.delete(calendar.id);
                  setChosen(next);
                }}
                type="checkbox"
              />
              <span className="min-w-0 break-words">
                {calendar.summary}
                {calendar.primary ? <span className="text-muted-foreground"> (primary)</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : error ? null : (
        <p id={`${id}-loading`} role="status">
          Reading your calendars...
        </p>
      )}
      <GuestCardActions>
        {calendars ? (
          <Button className="min-h-11" disabled={busy || chosen.size === 0} onClick={() => void save()} type="button">
            Save calendars
          </Button>
        ) : null}
        <Button className="min-h-11" disabled={busy} onClick={() => void disconnect()} type="button" variant="outline">
          Disconnect
        </Button>
      </GuestCardActions>
      <ErrorLine message={error} />
    </GuestCard>
  );
}

const STATUS_TITLES: Readonly<Record<string, string>> = {
  awaiting_host_approval: "Waiting for the host to approve",
  gathering: "Your request is open",
  negotiating: "Choosing a time",
};

const DELIVERY_TEXT: Readonly<Record<string, string>> = {
  queued: "is on its way",
  rejected: "could not be delivered",
  sent: "was sent",
  suppressed: "was not sent",
  uncertain: "may not have arrived",
};

// The status card, placed where the guest was identified (and at the agreement
// once agreed): the creation email with **Send the email again** and, when
// Google verified the same address, **Use verified Google email**; when the
// request expires; and **Withdraw request** with a confirming step.
export function StatusCard({ context }: { readonly context: RequesterCardContext }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAgain, setSentAgain] = useState(false);
  const { confirmation, connection, contact, request } = context.view;

  async function withdraw() {
    setBusy(true);
    const outcome = await context.run("request.withdraw", {}, request.revision);
    setBusy(false);

    if (outcome.ok || outcome.error.category === "request_closed") {
      window.location.reload();
      return;
    }

    setError(outcome.error.category === "stale_revision" ? "This request changed. Check it and try again." : outcome.error.message);
    setConfirming(false);
  }

  async function command(operation: string, done?: () => void) {
    setBusy(true);
    setError(null);
    const outcome = await context.run(operation);
    setBusy(false);
    if (!outcome.ok) setError(outcome.error.message);
    else done?.();
  }

  const agreed = context.view.agreement && context.view.proposal ? context.view.proposal : null;
  const retryLater = confirmation?.retryAt ? Date.parse(confirmation.retryAt) > Date.now() : false;

  return (
    <GuestCard
      description={
        agreed
          ? `You agreed to ${displayTime(new Date(agreed.start), context.timezone)} (proposal version ${agreed.version}). The host approves or declines next; nothing is booked yet.`
          : `It stays open until ${displayTime(new Date(request.expiresAt), context.timezone)} unless a time is agreed and booked.`
      }
      id="request-status"
      label="Status"
      title={STATUS_TITLES[request.state] ?? "Your request"}
    >
      {contact ? (
        contact.confirmed ? (
          <p>Your private booking link was emailed to {contact.email}, and the address is confirmed.</p>
        ) : (
          <p>
            Your private booking link {DELIVERY_TEXT[confirmation?.delivery ?? "queued"] ?? "is on its way"} to {contact.email}.
            Confirming the address from that email is optional.
          </p>
        )
      ) : null}
      {confirming ? (
        <>
          <p>Withdraw this request? It closes for good and cannot be reopened.</p>
          <GuestCardActions>
            <Button className="min-h-11" disabled={busy} onClick={() => void withdraw()} type="button" variant="destructive">
              {busy ? "Withdrawing..." : "Withdraw request"}
            </Button>
            <Button className="min-h-11" onClick={() => setConfirming(false)} type="button" variant="outline">
              Keep the request
            </Button>
          </GuestCardActions>
        </>
      ) : (
        <GuestCardActions>
          {contact && !contact.confirmed && connection.canUseGoogleEmail ? (
            <Button className="min-h-11" disabled={busy} onClick={() => void command("contact.use_google_email")} type="button">
              Use verified Google email
            </Button>
          ) : null}
          {contact && !contact.confirmed && !connection.canUseGoogleEmail ? (
            <Button
              className="min-h-11"
              disabled={busy || retryLater || sentAgain}
              onClick={() => void command("contact.resend_confirmation", () => setSentAgain(true))}
              type="button"
              variant="outline"
            >
              {sentAgain ? "Email sent again" : "Send the email again"}
            </Button>
          ) : null}
          {request.state !== "awaiting_host_approval" ? <DetailsButton context={context} /> : null}
          <Button className="min-h-11" onClick={() => setConfirming(true)} type="button" variant="outline">
            Withdraw request
          </Button>
        </GuestCardActions>
      )}
      <ErrorLine message={error} />
    </GuestCard>
  );
}
