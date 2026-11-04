"use client";

import { MAX_CALENDAR_IMAGE_BYTES, type ScreenshotMark } from "@lib/contracts/calendar-screenshot";
import { EMAIL_LINK_CREATE_OPERATION, EMAIL_LINK_UNLINK_OPERATION, type EmailLinkStatus } from "@lib/contracts/email-link";
import { deepLinkFor, qrDeepLink } from "@lib/contracts/imessage";
import { channelName, displayWhatsAppNumber, whatsAppLinkFor } from "@lib/contracts/messaging-channel";
import { type GuestChannel, REQUESTER_IMESSAGE_OPERATIONS, type RequesterImessageStatus } from "@lib/contracts/requester-imessage";
import type { HostProfileItem, OpenRequesterView } from "@lib/contracts/requester-view";
import { displayTime } from "@lib/contracts/timezone";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { GuestCard, GuestCardActions, guestCardHeadingId } from "@/app/_components/guest/guest-card";
import { browserLanguage } from "@/app/_components/guest/timezone";
import { ContactCardLine, CopyButton, useMessagesPlatform } from "@/app/_components/imessage/imessage-card";
import { channelCopy, COPY } from "@/app/_components/ink/copy";
import { NumberForm } from "@/app/_components/ink/number-form";
import { Button } from "@/components/ui/button";

// The guest thread's request cards (design decision 12; DESIGN.md: conversation
// card): the Calendar connection and selection, the status lines with the
// creation email, **Use verified Google email** and **Continue by email**, and
// the waiting card with **Get updates in iMessage** and **Get updates in WhatsApp**.
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
        {preview ? <img alt="Selected calendar screenshot" className="max-h-48 max-w-full rounded-xl bg-secondary object-contain" src={preview} /> : null}
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
  return <fieldset className="flex flex-col gap-2 rounded-xl bg-secondary p-3">
    <legend className="font-medium">Review the screenshot in {context.timezone}</legend>
    <p>Suggested free times are preselected. Check every date and time, remove any that are not free, then confirm. Nothing is applied automatically.</p>
    {rows.map((row, index) => <div className="grid min-w-0 grid-cols-2 gap-2 rounded-xl bg-card p-2" key={index}>
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

// Use your host settings for this request (guest-flow-completion design 6): a
// guest whose Google account is another host's chooses which of their host
// settings this request uses; nothing is used before **Use these settings**,
// and **Not now** keeps the card from returning.
const HOST_PROFILE_LINES: Readonly<Record<HostProfileItem, { readonly label: string; readonly line: string }>> = {
  calendars: { label: "Calendars", line: "Check your busy time on the calendars you use as a host." },
  details: { label: "Basic details", line: "Fill in your time zone and travel mode." },
};

export function HostProfileCard({ context, onDone }: { readonly context: RequesterCardContext; readonly onDone: () => void }) {
  const profile = context.view.hostProfile;
  const [chosen, setChosen] = useState<Set<HostProfileItem>>(
    () => new Set(profile?.decided ? profile.items : (profile?.offered ?? [])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  async function decide(items: readonly HostProfileItem[]) {
    setBusy(true);
    const outcome = await context.run("request.host_profile.decide", { items });
    setBusy(false);
    if (outcome.ok) onDone();
    else setError(outcome.error.message);
  }

  return (
    <GuestCard
      description="Your Google account is also a host's on Find Me a Time. Choose what this request may use; the other host never sees it."
      id="host-profile"
      label="Your host settings"
      title="Use your host settings for this request"
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Host settings to use</legend>
        {profile.offered.map((item) => (
          <label className="flex min-h-11 items-start gap-2" key={item}>
            <input
              checked={chosen.has(item)}
              className="mt-1 size-4"
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(item);
                else next.delete(item);
                setChosen(next);
              }}
              type="checkbox"
            />
            <span className="min-w-0 break-words">
              {HOST_PROFILE_LINES[item].label}
              <span className="block text-sm text-muted-foreground">{HOST_PROFILE_LINES[item].line}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <GuestCardActions>
        <Button className="min-h-11" disabled={busy || chosen.size === 0} onClick={() => void decide([...chosen])} type="button">
          Use these settings
        </Button>
        <Button className="min-h-11" disabled={busy} onClick={() => void decide([])} type="button" variant="outline">
          Not now
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

// **Get updates in iMessage**, a button in the waiting card (guest-flow-completion
// design 1, U22): a one-time code the guest sends, as shown, from their
// iMessage to the line; on a phone Messages opens at once with it written,
// elsewhere a QR code opens it on an iPhone, and a Mac also gets **Open
// Messages on this Mac** (D17). The card polls until the message
// arrives, then shows the masked sender with **Confirm and link**; only that
// click binds. Linked, a line names the masked sender with **Unlink iMessage**.
// Like email, it is never required; nothing shows when the deployment has no
// line. The button first asks for the guest's number (imessage-number-registration
// D1, D3): the server registers it with Photon, whose shared lines read only
// registered numbers, and the code is addressed to the number Photon assigned.
// **Get updates in WhatsApp** sits beside it wherever WhatsApp is configured
// (guest-whatsapp-link design 2): the same number first, then wa.me with the
// same message, opened at once on a phone, and elsewhere a QR code of it with
// **Open WhatsApp** (WhatsApp Web or the app). One link at a time: a code or
// binding on one channel replaces the other's. WhatsApp has no contact card.
export function ImessageUpdates({ context, onlyLinked = false }: { readonly context: Pick<RequesterCardContext, "bookingId" | "timezone" | "run">; readonly onlyLinked?: boolean }) {
  const [status, setStatus] = useState<RequesterImessageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The channel whose number the card is asking for.
  const [askNumber, setAskNumber] = useState<GuestChannel | null>(null);
  const platform = useMessagesPlatform();
  const { bookingId, run } = context;

  const check = useCallback(async () => {
    try {
      const response = await fetch(`/api/requests/${bookingId}/imessage`, { cache: "no-store" });
      const next = response.ok ? ((await response.json()) as RequesterImessageStatus) : null;
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [bookingId]);

  useEffect(() => {
    void check();
  }, [check]);

  // While the code waits for its message, the card checks again.
  useEffect(() => {
    if (status?.state !== "pending" && !(status?.state === "linked" && status.contactCard?.state === "queued")) return;
    const timer = window.setInterval(() => void check(), 3000);
    return () => window.clearInterval(timer);
  }, [check, status?.state, status?.state === "linked" ? status.contactCard?.state : null]);

  async function command(operation: string, input: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const outcome = await run(operation, input);
    setBusy(false);
    if (!outcome.ok) setError(outcome.error.category === "rate_limited" ? "Too many codes this hour. Try again later." : outcome.error.message);
    return check();
  }

  const phone = platform === "ios" || platform === "android";
  const pending = status?.state === "pending" ? status : null;
  const whatsapp = pending?.channel === "whatsapp";
  // wa.me opens WhatsApp on a phone and WhatsApp Web or the app on a computer.
  const waLink = pending && whatsapp ? whatsAppLinkFor(pending.lineNumber, pending.message) : null;
  const link = pending && phone ? (whatsapp ? waLink : deepLinkFor(platform, pending.lineNumber, pending.message)) : null;
  // A Mac has Messages too, offered beside the QR code and Copy as on the host's link screens (D17).
  const macLink = pending && !whatsapp && platform === "mac" ? deepLinkFor("mac", pending.lineNumber, pending.message) : null;
  const qr = useMemo(
    () => (pending && !phone ? renderSVG(whatsapp ? (waLink ?? "") : qrDeepLink(pending.lineNumber, pending.message), { border: 2 }) : null),
    [pending, phone, whatsapp, waLink],
  );

  if (!status || status.state === "unavailable") return null;
  if (onlyLinked && status.state !== "linked") return null;

  if (status.state === "none" && askNumber) {
    const channel = askNumber;
    return (
      <InnerStep
        description={`Find Me a Time reads messages only from numbers it knows. Enter the number your ${channelName(channel)} uses, then send one message from it.`}
        title={`Get updates in ${channelName(channel)}`}
      >
        <NumberForm
          id="guest-number"
          key={channel}
          look="card"
          onSubmit={async (number) => {
            setBusy(true);
            setError(null);
            const outcome = await run(REQUESTER_IMESSAGE_OPERATIONS.create, { channel, number });
            setBusy(false);
            if (!outcome.ok) {
              if (outcome.error.category === "invalid_input") return "invalid";
              if (outcome.error.category !== "rate_limited") return "other";
              setError("Too many codes this hour. Try again later.");
              return null;
            }
            setAskNumber(null);
            const next = await check();
            const opened =
              next?.state === "pending" && phone
                ? next.channel === "whatsapp"
                  ? whatsAppLinkFor(next.lineNumber, next.message)
                  : deepLinkFor(platform, next.lineNumber, next.message)
                : null;
            if (opened) window.location.assign(opened);
            return null;
          }}
          t={{ ...channelCopy(COPY.en, channel).number, submit: "Next" }}
        />
        <GuestCardActions>
          <Button disabled={busy} onClick={() => setAskNumber(null)} type="button" variant="ghost">
            Cancel
          </Button>
        </GuestCardActions>
        <ErrorLine message={error} />
      </InnerStep>
    );
  }

  if (status.state === "none") {
    return (
      <div className="flex flex-col gap-1" data-imessage-link="none">
        <GuestCardActions>
          {status.lineNumber ? (
            <Button className="min-h-11" disabled={busy} onClick={() => setAskNumber("imessage")} type="button" variant="outline">
              Get updates in iMessage
            </Button>
          ) : null}
          {status.whatsappNumber ? (
            <Button className="min-h-11" disabled={busy} onClick={() => setAskNumber("whatsapp")} type="button" variant="outline">
              Get updates in WhatsApp
            </Button>
          ) : null}
        </GuestCardActions>
        <p className="text-muted-foreground">Optional: your email still gets every update.</p>
        <ErrorLine message={error} />
      </div>
    );
  }

  if (status.state === "linked") {
    return (
      <div className="flex min-h-8 flex-col gap-2 text-sm" data-channel={status.channel} data-imessage-link="linked" role="note">
        <span>
          {channelName(status.channel)} linked: updates go to {status.sender}, and you can reply there
          {status.channel === "whatsapp" ? ". If you haven't written for a day, they come by email only until you write again." : ""}
        </span>
        {status.channel === "imessage" ? (
          <ContactCardLine busy={busy} onShare={() => void command(REQUESTER_IMESSAGE_OPERATIONS.shareContactCard)} onCheck={() => void check()} state={status.contactCard?.state ?? null} />
        ) : null}
        <Button className={QUIET_ACTION} disabled={busy} onClick={() => void command(REQUESTER_IMESSAGE_OPERATIONS.unlink)} type="button" variant="link">
          Unlink {channelName(status.channel)}
        </Button>
        <ErrorLine message={error} />
      </div>
    );
  }

  if (status.state === "received") {
    return (
      <InnerStep description={`Your message arrived from ${status.sender}. Link it only if that is you.`} title={`Is this your ${channelName(status.channel)}?`}>
        <GuestCardActions>
          <Button
            disabled={busy}
            onClick={() => void command(REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: status.linkId })}
            type="button"
          >
            Confirm and link
          </Button>
          <Button disabled={busy} onClick={() => void command(REQUESTER_IMESSAGE_OPERATIONS.unlink, { pendingOnly: true })} type="button" variant="ghost">
            This isn't me
          </Button>
        </GuestCardActions>
        <ErrorLine message={error} />
      </InnerStep>
    );
  }

  return (
    <InnerStep
      description={
        whatsapp
          ? link
            ? "WhatsApp should open with the message written. Tap send there."
            : "Open WhatsApp here, or scan the code with your phone, and send this message."
          : link
            ? "Messages should open with the message written. Tap send there."
            : macLink
              ? "Open Messages on this Mac, or send this message from your iPhone's Messages."
              : "Send this message from your iPhone's Messages."
      }
      title={`Get updates in ${channelName(status.channel)}`}
    >
      <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-secondary px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">To</p>
        <p className="font-mono text-sm tabular-nums">{whatsapp ? displayWhatsAppNumber(status.lineNumber) : status.lineNumber}</p>
        <p className="pt-1 text-xs font-medium text-muted-foreground">Message</p>
        <p className="font-mono text-sm break-all select-all" data-imessage-link-message="">
          {status.message}
        </p>
        <CopyButton label="Copy the link message" text={status.message} />
      </div>
      {qr ? (
        <div
          aria-label={whatsapp ? "QR code that opens WhatsApp with this message on your phone" : "QR code that opens Messages with this message on your iPhone"}
          className="size-40 rounded-lg bg-white p-1 [&_svg]:size-full"
          // The SVG is generated locally from the line number and the message.
          dangerouslySetInnerHTML={{ __html: qr }}
          role="img"
        />
      ) : null}
      <p className="text-sm text-muted-foreground" role="status">
        Waiting for your message. The code works until {displayTime(new Date(status.expiresAt), context.timezone)}.
      </p>
      <GuestCardActions>
        {link ?? waLink ? (
          <Button asChild>
            <a href={link ?? waLink ?? undefined} rel={whatsapp && !phone ? "noreferrer" : undefined} target={whatsapp && !phone ? "_blank" : undefined}>
              {whatsapp ? "Open WhatsApp" : "Open Messages"}
            </a>
          </Button>
        ) : null}
        {macLink ? (
          <Button asChild>
            <a href={macLink}>Open Messages on this Mac</a>
          </Button>
        ) : null}
        <Button disabled={busy} onClick={() => void command(REQUESTER_IMESSAGE_OPERATIONS.unlink, { pendingOnly: true })} type="button" variant="ghost">
          Cancel
        </Button>
      </GuestCardActions>
      <ErrorLine message={error} />
    </InnerStep>
  );
}

export function ClosedImessageUpdates({ bookingId, timezone }: { readonly bookingId: string; readonly timezone: string }) {
  const run = useCallback(async (operation: string, input: unknown = {}): Promise<CommandOutcome> => {
    try {
      const response = await fetch(`/api/requests/${bookingId}/commands`, {
        body: JSON.stringify({ input, operation, retryKey: crypto.randomUUID() }),
        headers: { "content-type": "application/json" }, method: "POST",
      });
      return await response.json() as CommandOutcome;
    } catch {
      return { ok: false, error: { category: "internal", message: "That did not go through. Try again." } };
    }
  }, [bookingId]);
  return <ImessageUpdates context={{ bookingId, timezone, run }} onlyLinked />;
}

// One step of linking iMessage inside the waiting card: a heading and a short
// reason, then its controls, under a rule rather than a second card.
function InnerStep({ children, description, title }: { readonly children: ReactNode; readonly description: string; readonly title: string }) {
  const heading = useId();
  return (
    <div aria-labelledby={heading} className="flex min-w-0 flex-col gap-3 border-t border-border pt-3" data-guest-card="imessage-link" role="group">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-base leading-snug font-semibold text-foreground" id={heading}>
          {title}
        </h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

// The wait for the host, as a card in the thread from the agreement (U22), with
// **Get updates in iMessage** as its button.
export function AwaitingCard({ context }: { readonly context: RequesterCardContext }) {
  const agreed = context.view.agreement && context.view.proposal ? context.view.proposal : null;
  const booking = context.view.booking;

  // Approved: the booking is reserved or being confirmed with Google Calendar,
  // with no join link until it is (host-review-and-booking design 10).
  if (context.view.request.state === "booking" && booking) {
    return <BookingLine context={context} />;
  }

  // Changed with Change before the host approved (D10): the wait is over.
  if (context.view.request.state === "gathering" || context.view.request.state === "negotiating") {
    return (
      <p className="px-1 text-sm text-muted-foreground" data-guest-receipt="status" role="status">
        You reopened the agreed time to change it · nothing is booked yet
      </p>
    );
  }

  return (
    <GuestCard
      description={`${agreed ? `You agreed to ${displayTime(new Date(agreed.start), context.timezone)}` : "You agreed"} · nothing is booked yet`}
      id="awaiting"
      label="Request"
      title={`Waiting for ${context.view.host.displayName} to approve`}
    >
      <ImessageUpdates context={context} />
    </GuestCard>
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
