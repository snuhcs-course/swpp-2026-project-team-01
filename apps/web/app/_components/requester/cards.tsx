"use client";

import { EMAIL_LINK_CREATE_OPERATION, EMAIL_LINK_UNLINK_OPERATION, type EmailLinkStatus } from "@lib/contracts/email-link";
import { MAX_CALENDAR_IMAGE_BYTES, type ScreenshotMark } from "@lib/contracts/calendar-screenshot";
import type { OpenRequesterView } from "@lib/contracts/requester-view";
import { displayTime } from "@lib/contracts/timezone";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GuestCard, GuestCardActions, guestCardHeadingId } from "@/app/_components/guest/guest-card";
import { browserLanguage } from "@/app/_components/guest/timezone";
import { Button } from "@/components/ui/button";

// The guest thread's request cards (design decision 12; DESIGN.md: conversation
// card): the Calendar connection and selection, and the status lines with the
// creation email, **Use verified Google email** and **Continue by email**.
// **Withdraw request** and
// **Edit details** are in the thread's menu beside the composer
// (guest-workspace.tsx). The
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
  // Makes the candidate times the open card again, from **Choose another time**
  // or the times receipt's **Change**, while a proposal waits for agreement.
  readonly chooseAnotherTime: () => void;
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

// The cards' context, or null until the thread has a request (before the
// guest's first message on the public page).
export function useRequesterCards(
  bookingId: string | null,
  view: OpenRequesterView | null,
  timezone: string,
  refresh: () => Promise<void>,
  details: { readonly open: () => void; readonly close: () => void },
  chooseAnotherTime: () => void,
) {
  const keys = useRef(new Map<string, string>());

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
        // Keep the retry identity when a response cannot be read. The command
        // may have committed, and the next attempt must replay that operation.
        if (body) keys.current.delete(identity);
        await refresh();
        return body ?? { error: { category: "internal", message: "Something went wrong. Try again later." }, ok: false };
      } catch {
        await refresh();
        return { error: { category: "internal", message: "We could not confirm whether that was saved. Check the request, then try again." }, ok: false };
      }
    },
    [bookingId, refresh],
  );

  if (!bookingId || !view) return null;

  const context: RequesterCardContext = {
    bookingId,
    chooseAnotherTime,
    closeDetails: details.close,
    focusCard: focusCardHeading,
    openDetails: details.open,
    refresh,
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [marks, setMarks] = useState<readonly ScreenshotMark[] | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(image: File | undefined) {
    setError(null);
    setMarks(null);
    if (!image) { setFile(null); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(image.type) || image.size > MAX_CALENDAR_IMAGE_BYTES) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setError("Choose a PNG, JPEG or WebP image under 10 MB.");
      return;
    }
    setFile(image);
  }

  async function readScreenshot() {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("image", file);
      form.set("timezone", context.timezone);
      const response = await fetch(`/api/requests/${context.bookingId}/calendar-screenshot`, { method: "POST", body: form });
      const body = await response.json() as { marks?: ScreenshotMark[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "The screenshot could not be read.");
      if (!body.marks?.length) throw new Error("No usable times were found. Enter your free times manually.");
      setMarks(body.marks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The screenshot could not be read. Enter your free times manually.");
    } finally { setReading(false); }
  }

  async function manual() {
    const outcome = await context.run("request.set_manual_availability", { manual: true });
    if (outcome.ok) context.openDetails();
    else setError(outcome.error.message);
  }

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
          <Button className="min-h-11" onClick={() => void context.run("request.set_manual_availability", { manual: true })} type="button" variant="outline">Skip for now</Button>
        </GuestCardActions>
      </form>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <label className="font-medium" htmlFor="calendar-screenshot">Upload calendar screenshot (optional)</label>
        <input accept="image/png,image/jpeg,image/webp" className="min-h-11 max-w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2" id="calendar-screenshot" onChange={(event) => choose(event.target.files?.[0])} ref={inputRef} type="file" />
        <p className="text-muted-foreground">Use a day or week view with visible date and hour labels. PNG, JPEG or WebP, up to 10 MB. The image is sent to OpenAI for reading and is not saved here. Remove private event details before uploading. Review suggested free times before saving any availability.</p>
        {preview ? <img alt="Selected calendar screenshot" className="max-h-48 max-w-full rounded-lg border border-border object-contain" src={preview} /> : null}
        {file ? <p className="break-all">Selected: {file.name}</p> : null}
        {file ? <GuestCardActions><Button disabled={reading} onClick={() => void readScreenshot()} type="button">{reading ? "Reading screenshot..." : "Read screenshot"}</Button><Button onClick={() => { setFile(null); setMarks(null); setError(null); if (inputRef.current) inputRef.current.value = ""; }} type="button" variant="outline">Remove image</Button></GuestCardActions> : null}
        {marks ? <ScreenshotReview context={context} marks={marks} onError={setError} /> : null}
        {error ? <p className="text-destructive" role="status">{error}</p> : null}
        {error ? <Button className="self-start" onClick={() => void manual()} type="button" variant="outline">Enter times manually</Button> : null}
      </div>
    </GuestCard>
  );
}

function ScreenshotReview({ context, marks, onError }: { readonly context: RequesterCardContext; readonly marks: readonly ScreenshotMark[]; readonly onError: (message: string) => void }) {
  const [rows, setRows] = useState(() => marks.map((mark) => ({ ...mark, free: mark.interpretation === "free" })));
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(marks.map((mark) => ({ ...mark, free: mark.interpretation === "free" }))), [marks]);
  function change(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }
  async function apply() {
    const windows = rows.filter((row) => row.free).map(({ date, start, end }) => ({ date, start, end }));
    if (windows.length === 0) { onError("Choose at least one time you are free, or enter times manually."); return; }
    setBusy(true);
    const saved = await context.run("request.update_details", { details: { windows }, timezone: context.timezone }, context.view.request.revision);
    if (!saved.ok) { onError(saved.error.message); setBusy(false); return; }
    const settled = await context.run("request.set_manual_availability", { manual: true });
    if (!settled.ok) onError(settled.error.message);
    setBusy(false);
  }
  return <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
    <legend className="font-medium">Review the screenshot in {context.timezone}</legend>
    <p>Suggested free times are preselected. Check every date and time, remove any that are not free, then confirm. Nothing is applied automatically.</p>
    {rows.map((row, index) => <div className="grid min-w-0 grid-cols-2 gap-2 rounded-md border border-border p-2" key={index}>
      <label className="col-span-2 flex flex-col gap-1">Interpretation
        <select className="min-h-11 rounded-md border border-input bg-background px-2" onChange={(event) => change(index, { free: event.target.value === "free" })} value={row.free ? "free" : "ignore"}>
          <option value="ignore">Ignore this mark ({row.interpretation})</option><option value="free">I am free at this time</option>
        </select>
      </label>
      <label className="col-span-2 flex flex-col gap-1">Date<input className="min-h-11 min-w-0 rounded-md border border-input bg-background px-2" onChange={(event) => change(index, { date: event.target.value })} type="date" value={row.date} /></label>
      <label className="flex min-w-0 flex-col gap-1">From<input className="min-h-11 min-w-0 rounded-md border border-input bg-background px-2" onChange={(event) => change(index, { start: event.target.value })} type="time" value={row.start} /></label>
      <label className="flex min-w-0 flex-col gap-1">Until<input className="min-h-11 min-w-0 rounded-md border border-input bg-background px-2" onChange={(event) => change(index, { end: event.target.value })} type="time" value={row.end} /></label>
    </div>)}
    <Button className="self-start" disabled={busy} onClick={() => void apply()} type="button">Confirm selected free times</Button>
  </fieldset>;
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
    if (!outcome.ok) setError(outcome.error.message);
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

const DELIVERY_TEXT: Readonly<Record<string, string>> = {
  queued: "Booking link on its way to",
  rejected: "Booking link could not be delivered to",
  sent: "Booking link sent to",
  suppressed: "Booking link not sent to",
  uncertain: "Booking link may not have reached",
};

const QUIET_ACTION = "h-8 min-h-8 px-1 text-xs";

// The request's status as one line in the thread, not a standing card (DESIGN.md:
// one thing to think about at once): from identification, where the booking
// link went, with **Send the email again** or **Use verified Google email** as
// quiet text actions, and that confirming is optional.
export function SentLine({ context }: { readonly context: RequesterCardContext }) {
  const [busy, setBusy] = useState(false);
  const [sentAgain, setSentAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirmation, connection, contact } = context.view;

  if (!contact) return null;

  async function command(operation: string, done?: () => void) {
    setBusy(true);
    setError(null);
    const outcome = await context.run(operation);
    setBusy(false);
    if (!outcome.ok) setError(outcome.error.message);
    else done?.();
  }

  const retryLater = confirmation?.retryAt ? Date.parse(confirmation.retryAt) > Date.now() : false;

  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm" data-guest-receipt="status" role="note">
      <span className="min-w-0 break-words">
        {contact.confirmed ? "Booking link sent to" : (DELIVERY_TEXT[confirmation?.delivery ?? "queued"] ?? "Booking link sent to")}{" "}
        {contact.email}
      </span>
      {contact.confirmed ? (
        <span className="text-muted-foreground">· Address confirmed</span>
      ) : (
        <>
          {connection.canUseGoogleEmail ? (
            <Button className={QUIET_ACTION} disabled={busy} onClick={() => void command("contact.use_google_email")} type="button" variant="link">
              Use verified Google email
            </Button>
          ) : (
            <Button
              className={QUIET_ACTION}
              disabled={busy || retryLater || sentAgain}
              onClick={() => void command("contact.resend_confirmation", () => setSentAgain(true))}
              type="button"
              variant="link"
            >
              {sentAgain ? "Sent again" : "Send again"}
            </Button>
          )}
          <span className="text-muted-foreground">· Confirming is optional</span>
        </>
      )}
      <ErrorLine message={error} />
    </div>
  );
}

// **Continue by email** below the status line (requester-email-channel design
// 4): with a confirmed address, a one-time code to send, as shown, from that
// address in a new email to the product inbox. **Check email link** refreshes
// the status, **Unlink email** ends a linked thread at once, and a command whose
// answer was lost offers **Retry same linking action**, which repeats it with the
// same retry key. Email is never required; nothing shows when the deployment
// has no inbox.
export function EmailLinkLine({ context }: { readonly context: RequesterCardContext }) {
  const [status, setStatus] = useState<EmailLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ operation: string; input: Record<string, unknown> } | null>(null);
  const [copied, setCopied] = useState(false);
  const { bookingId, run } = context;

  const check = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${bookingId}/email-link`, { cache: "no-store" });
      setStatus(response.ok ? ((await response.json()) as EmailLinkStatus) : null);
      setError(response.ok ? null : "The email link status is not available right now.");
    } catch {
      setError("The email link status is not available right now.");
    }
  }, [bookingId]);

  useEffect(() => {
    void check();
  }, [check]);

  async function command(operation: string, input: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const outcome = await run(operation, input);
    setBusy(false);

    if (outcome.ok) {
      setRetry(null);
    } else if (outcome.error.category === "internal") {
      // The answer was lost: the same action keeps its retry key.
      setRetry({ input, operation });
      setError("That did not go through.");
    } else {
      setRetry(null);
      setError(outcome.error.category === "rate_limited" ? "Too many codes this hour. Try again later." : outcome.error.message);
    }

    await check();
  }

  if (!status || status.state === "unavailable") return null;

  const actions = (
    <>
      {retry ? (
        <Button className={QUIET_ACTION} disabled={busy} onClick={() => void command(retry.operation, retry.input)} type="button" variant="link">
          Retry same linking action
        </Button>
      ) : null}
      <ErrorLine message={error} />
    </>
  );

  if (status.state === "needs_confirmation") {
    return (
      <p className="px-1 text-sm text-muted-foreground" data-email-link="needs_confirmation">
        To continue by email, first confirm your address from the email we sent.
      </p>
    );
  }

  if (status.state === "none") {
    return (
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 px-1 text-sm" data-email-link="none">
        <Button className={QUIET_ACTION} disabled={busy} onClick={() => void command(EMAIL_LINK_CREATE_OPERATION)} type="button" variant="link">
          Continue by email
        </Button>
        <span className="text-muted-foreground">· optional; this page keeps working</span>
        {actions}
      </div>
    );
  }

  if (status.state === "linked") {
    return (
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 px-1 text-sm" data-email-link="linked" role="note">
        <span>
          Email linked: replies from {status.address} to {status.inbox} continue this conversation
        </span>
        <Button className={QUIET_ACTION} disabled={busy} onClick={() => void command(EMAIL_LINK_UNLINK_OPERATION)} type="button" variant="link">
          Unlink email
        </Button>
        {actions}
      </div>
    );
  }

  const mailto = `mailto:${status.inbox}?subject=${encodeURIComponent(status.code)}&body=${encodeURIComponent(status.code)}`;

  return (
    <GuestCard
      description={`Send a new email from your confirmed address to ${status.inbox} with this code. It works once, until ${displayTime(new Date(status.expiresAt), context.timezone)}.`}
      id="email-link"
      title="Continue by email"
    >
      <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-base tracking-wide select-all" data-email-link-code="">
        {status.code}
      </code>
      <GuestCardActions>
        <Button asChild>
          <a href={mailto}>Open email</a>
        </Button>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(status.code).then(() => setCopied(true));
          }}
          type="button"
          variant="outline"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button disabled={busy} onClick={() => void check()} type="button" variant="outline">
          Check email link
        </Button>
        <Button disabled={busy} onClick={() => void command(EMAIL_LINK_UNLINK_OPERATION, { pendingOnly: true })} type="button" variant="ghost">
          Cancel
        </Button>
      </GuestCardActions>
      {actions}
    </GuestCard>
  );
}

// The wait for the host, as one line in the thread from the agreement.
export function AwaitingLine({ context }: { readonly context: RequesterCardContext }) {
  const agreed = context.view.agreement && context.view.proposal ? context.view.proposal : null;
  const booking = context.view.booking;

  // Approved: the booking is reserved or being confirmed with Google Calendar,
  // with no join link until it is (host-review-and-booking design 10).
  if (context.view.request.state === "booking" && booking) {
    return <BookingLine context={context} />;
  }

  return (
    <p className="px-1 text-sm" data-guest-receipt="status" role="status">
      <span className="font-medium">Waiting for {context.view.host.displayName} to approve</span>
      {agreed ? ` · you agreed to ${displayTime(new Date(agreed.start), context.timezone)}` : ""} · nothing is booked yet
    </p>
  );
}

function BookingLine({ context }: { readonly context: RequesterCardContext }) {
  const [checking, setChecking] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-sm" data-guest-receipt="status" role="status">
      <span>
        <span className="font-medium">Booking in progress</span> · {context.view.host.displayName} approved, and the meeting is being
        confirmed with Google Calendar · not booked yet
      </span>
      <Button
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          await context.run("booking.check", {}, null);
          setChecking(false);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        Check booking status
      </Button>
    </div>
  );
}
