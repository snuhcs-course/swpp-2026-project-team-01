"use client";

import type { OpenRequesterView } from "@lib/contracts/requester-view";
import { displayTime } from "@lib/contracts/timezone";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { GuestCard, GuestCardActions } from "@/app/_components/guest/guest-card";
import { browserLanguage } from "@/app/_components/guest/timezone";
import { Button } from "@/components/ui/button";

// The booking page's cards (design decision 12; DESIGN.md: one card at a time).
// REQUESTER_CARDS is the typed slot: the first definition whose isOpen holds is
// the one open card after the last message. Lane D inserts its review, meeting
// details, candidate times and proposal cards before the calendar card; this
// lane provides the calendar connection and selection, Use verified Google
// email, and the status card with **Withdraw request**, which is always last.

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
};

export type RequesterCardDefinition = {
  readonly id: string;
  readonly isOpen: (context: RequesterCardContext) => boolean;
  readonly render: (context: RequesterCardContext) => ReactNode;
};

const DISMISSED_KEY = "fmat.cards.dismissed";

function readDismissed() {
  try {
    return new Set<string>(JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}

export function useRequesterCards(bookingId: string, view: OpenRequesterView, timezone: string, refresh: () => Promise<void>) {
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

  const context: RequesterCardContext = {
    bookingId,
    dismiss: (id) => store(new Set([...dismissed, id])),
    dismissed,
    refresh,
    reopen: (id) => store(new Set([...dismissed].filter((entry) => entry !== id))),
    run,
    timezone,
    view,
  };

  return context;
}

export function RequesterCards({ context }: { readonly context: RequesterCardContext }) {
  const card = REQUESTER_CARDS.find((definition) => definition.isOpen(context));
  return card ? <div key={card.id}>{card.render(context)}</div> : null;
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
function ConnectCalendarCard({ context }: { readonly context: RequesterCardContext }) {
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
function CalendarSelectionCard({ context }: { readonly context: RequesterCardContext }) {
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

// **Use verified Google email**: offered only when the verified Google address
// equals the current, unconfirmed contact.
function GoogleEmailCard({ context }: { readonly context: RequesterCardContext }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <GuestCard
      description={`Google verified ${context.view.contact.email}, so it can count as confirmed without the email link.`}
      id="google-email"
      label="Your contact"
      title="Use your verified Google email?"
    >
      <GuestCardActions>
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const outcome = await context.run("contact.use_google_email");
            setBusy(false);
            if (!outcome.ok) setError(outcome.error.message);
          }}
          type="button"
        >
          Use verified Google email
        </Button>
        <Button className="min-h-11" onClick={() => context.dismiss("google-email")} type="button" variant="outline">
          Not now
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

// The status card, always the last card: the current status, when the request
// expires, and **Withdraw request** with a confirming step.
function StatusCard({ context }: { readonly context: RequesterCardContext }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { request } = context.view;

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

  return (
    <GuestCard
      description={`It stays open until ${displayTime(new Date(request.expiresAt), context.timezone)} unless a time is agreed and booked.`}
      id="request-status"
      label="Status"
      title={STATUS_TITLES[request.state] ?? "Your request"}
    >
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
          <Button className="min-h-11" onClick={() => setConfirming(true)} type="button" variant="outline">
            Withdraw request
          </Button>
          {context.view.connection.calendar && context.dismissed.has("calendar-selection") ? (
            <Button className="min-h-11" onClick={() => context.reopen("calendar-selection")} type="button" variant="ghost">
              Calendar settings
            </Button>
          ) : !context.view.connection.calendar && context.dismissed.has("calendar-connect") ? (
            <Button className="min-h-11" onClick={() => context.reopen("calendar-connect")} type="button" variant="ghost">
              Connect Google Calendar
            </Button>
          ) : null}
        </GuestCardActions>
      )}
      <ErrorLine message={error} />
    </GuestCard>
  );
}

// The card slot, in order. Lane D inserts its cards at the marked place.
export const REQUESTER_CARDS: readonly RequesterCardDefinition[] = [
  // Lane D: review, meeting details, candidate times and proposal cards go here.
  {
    id: "calendar-connect",
    isOpen: ({ dismissed, view }) => !view.connection.calendar && !dismissed.has("calendar-connect"),
    render: (context) => <ConnectCalendarCard context={context} />,
  },
  {
    id: "calendar-selection",
    isOpen: ({ dismissed, view }) => view.connection.calendar && !dismissed.has("calendar-selection"),
    render: (context) => <CalendarSelectionCard context={context} />,
  },
  {
    id: "google-email",
    isOpen: ({ dismissed, view }) => view.connection.canUseGoogleEmail && !dismissed.has("google-email"),
    render: (context) => <GoogleEmailCard context={context} />,
  },
  { id: "request-status", isOpen: () => true, render: (context) => <StatusCard context={context} /> },
];
