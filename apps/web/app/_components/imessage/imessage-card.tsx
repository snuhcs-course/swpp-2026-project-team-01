"use client";

import {
  deepLinkFor,
  type ImessageOperation,
  type ImessageStatus,
  messagesPlatform,
  type MessagesPlatform,
  qrDeepLink,
} from "@lib/contracts/imessage";
import { AlertCircleIcon, CheckIcon, CopyIcon, MessageCircleIcon, RotateCcwIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { CardActions, cardHeadingId, HEADING_CLASS, QuietButton } from "@/app/_components/setup/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// The Connect iMessage card (host-imessage-channel design 4 to 6 and 11, D4): one
// inline conversation card whose content follows the server's status.
//   - none: Connect iMessage asks the server for a one-time code and, on a phone,
//     opens Messages at once with the line's number and the exact link message
//     in the input (iOS `&body=`, Android `?body=`); elsewhere it shows the
//     number, the code, Copy and a QR code of the same deep link. Send me a code
//     instead and Maybe later are quiet actions.
//   - pending: the message to send, with Open Messages to try again on a phone;
//     the card polls until the message arrives. Opening Messages changes nothing.
//   - received: the masked sender with Confirm and link and This isn't me.
//   - fallback: the masked number, the send's state and a protected code field.
//   - linked: the masked sender, the latest failed or uncertain message, Add to
//     contacts and Unlink behind an inline confirmation.
// A command whose answer was lost offers Try again with the same retry key.

export const IMESSAGE_CARD_ID = "imessage-card";
const POLL_MS = 3000;

type CommandFailure = { readonly category: string; readonly message: string };
type Pending = { readonly operation: ImessageOperation; readonly input: unknown; readonly retryKey: string };

const ERRORS: Readonly<Record<string, string>> = {
  invalid_input: "That didn't work. Check what you entered and try again.",
  rate_limited: "Too many tries for now. Wait a little and try again.",
  stale_revision: "That step has expired. Start again.",
  unavailable_configuration: "iMessage isn't available right now.",
};

async function readStatus(): Promise<ImessageStatus | null> {
  const response = await fetch("/api/host/imessage", { cache: "no-store" }).catch(() => null);
  return response?.ok ? ((await response.json()) as ImessageStatus) : null;
}

async function sendCommand(pending: Pending) {
  const response = await fetch("/api/host/imessage/commands", {
    body: JSON.stringify(pending),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).catch(() => null);
  if (!response) return { lost: true as const };
  const body = (await response.json().catch(() => null)) as { status?: ImessageStatus; result?: unknown; error?: CommandFailure } | null;
  if (!body || response.status >= 500) return { lost: true as const, status: body?.status };
  return { error: body.error ?? null, lost: false as const, result: body.result, status: body.status ?? null };
}

function when(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function useMessagesPlatform(): MessagesPlatform {
  const [platform, setPlatform] = useState<MessagesPlatform>("other");
  useEffect(() => {
    setPlatform(messagesPlatform(navigator.userAgent, navigator.maxTouchPoints));
  }, []);
  return platform;
}

export function ImessageCard({ onLater }: { readonly onLater?: () => void }) {
  const [status, setStatus] = useState<ImessageStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<ImessageOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState<Pending | null>(null);
  const [enteringNumber, setEnteringNumber] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const platform = useMessagesPlatform();
  const openOnArrival = useRef(false);

  const reload = useCallback(async () => {
    const next = await readStatus();
    setLoadFailed(next === null);
    if (next) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Waiting for the host's message, the fallback code's send or the contact
  // card's send: poll.
  const waiting =
    status?.state === "pending" ||
    (status?.state === "fallback" && status.send === "queued") ||
    (status?.state === "linked" && status.contactCard?.state === "queued");
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload, waiting]);

  // A received sender not confirmed in time: refresh when the window closes.
  const confirmBy = status?.state === "received" ? status.confirmBy : null;
  useEffect(() => {
    if (!confirmBy) return;
    const timer = window.setTimeout(() => void reload(), Math.max(0, Date.parse(confirmBy) - Date.now()) + 1000);
    return () => window.clearTimeout(timer);
  }, [confirmBy, reload]);

  const run = useCallback(async (pending: Pending) => {
    setBusy(pending.operation);
    setError(null);
    setLost(null);
    const outcome = await sendCommand(pending);
    setBusy(null);
    if (outcome.status) setStatus(outcome.status);
    if (outcome.lost) {
      setLost(pending);
      setError("The answer was lost. Try again; it won't be repeated.");
      return null;
    }
    if (outcome.error) {
      setError(ERRORS[outcome.error.category] ?? outcome.error.message);
      return null;
    }
    return outcome;
  }, []);

  const command = useCallback(
    (operation: ImessageOperation, input: unknown = {}) => run({ input, operation, retryKey: crypto.randomUUID() }),
    [run],
  );

  // Connect iMessage: the code first, then Messages at once on a phone.
  const connect = async () => {
    openOnArrival.current = platform !== "other";
    const outcome = await command("imessage.link.create");
    const next = outcome?.status;
    if (openOnArrival.current && next?.state === "pending") {
      const link = deepLinkFor(platform, next.lineNumber, next.message);
      if (link) window.location.assign(link);
    }
    openOnArrival.current = false;
  };

  if (!status) {
    return (
      <CardShell title="Use Find Me a Time from iMessage">
        <p className="text-sm text-muted-foreground" role="status">
          {loadFailed ? "iMessage status couldn't be loaded." : "Loading..."}
        </p>
        {loadFailed ? (
          <CardActions>
            <Button onClick={() => void reload()} type="button" variant="outline">
              <RotateCcwIcon aria-hidden />
              Try again
            </Button>
          </CardActions>
        ) : null}
      </CardShell>
    );
  }

  const notice = error ? (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm" role="alert">
      <AlertCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1">{error}</p>
      {lost ? (
        <Button className="min-h-9" disabled={busy !== null} onClick={() => void run(lost)} size="sm" type="button" variant="outline">
          <RotateCcwIcon aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  ) : null;

  switch (status.state) {
    case "unavailable":
      return (
        <CardShell title="iMessage isn't available yet">
          <p className="text-sm text-muted-foreground">Keep using Find Me a Time here on the web.</p>
        </CardShell>
      );

    case "none":
      if (enteringNumber) {
        return (
          <NumberForm
            busy={busy === "imessage.link.send_code"}
            notice={notice}
            onBack={() => setEnteringNumber(false)}
            onSubmit={async (number) => {
              if (await command("imessage.link.send_code", { number })) setEnteringNumber(false);
            }}
          />
        );
      }
      return (
        <CardShell
          description="Get request summaries and approve meetings from your own iMessage. You send one message to link it."
          title="Use Find Me a Time from iMessage"
        >
          {notice}
          <CardActions>
            <Button disabled={busy !== null} onClick={() => void connect()} type="button">
              <MessageCircleIcon aria-hidden />
              {busy === "imessage.link.create" ? "Getting your code..." : "Connect iMessage"}
            </Button>
            <QuietButton disabled={busy !== null} onClick={() => setEnteringNumber(true)}>
              Send me a code instead
            </QuietButton>
            {onLater ? <QuietButton onClick={onLater}>Maybe later</QuietButton> : null}
          </CardActions>
        </CardShell>
      );

    case "pending":
      return (
        <PendingCode
          busy={busy !== null}
          notice={notice}
          onCancel={() => void command("imessage.link.cancel")}
          platform={platform}
          status={status}
        />
      );

    case "received":
      return (
        <CardShell description="We got your message. Check that it came from you before linking." title="Is this you?">
          {notice}
          <p className="text-sm">
            Sent from <span className="font-medium tabular-nums">{status.sender}</span>
          </p>
          <CardActions>
            <Button disabled={busy !== null} onClick={() => void command("imessage.link.confirm", { linkId: status.linkId })} type="button">
              <CheckIcon aria-hidden />
              {busy === "imessage.link.confirm" ? "Linking..." : "Confirm and link"}
            </Button>
            <QuietButton disabled={busy !== null} onClick={() => void command("imessage.link.cancel")}>
              This isn&apos;t me
            </QuietButton>
          </CardActions>
          <p className="text-xs text-muted-foreground">Confirm by {when(status.confirmBy)}.</p>
        </CardShell>
      );

    case "fallback":
      return (
        <FallbackCode
          busy={busy}
          notice={notice}
          onCancel={() => void command("imessage.link.cancel")}
          onResend={() => void command("imessage.link.send_code", { resend: true })}
          onVerify={(code) => command("imessage.link.verify_code", { code })}
          status={status}
        />
      );

    case "linked":
      return (
        <CardShell title="iMessage is linked">
          {notice}
          <p className="text-sm">
            Linked to <span className="font-medium tabular-nums">{status.sender}</span>. Send <span className="font-mono">help</span> there for what you
            can do.
          </p>
          {status.delivery ? (
            <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm" role="status">
              {status.delivery.state === "failed"
                ? `A message to your iMessage couldn't be delivered at ${when(status.delivery.at)}.`
                : `A message to your iMessage at ${when(status.delivery.at)} may not have arrived.`}{" "}
              Continue here; nothing about your requests changed.
            </p>
          ) : null}
          <ContactCardLine busy={busy !== null} onShare={() => void command("imessage.contact_card.share")} onCheck={() => void reload()} state={status.contactCard?.state ?? null} />
          {confirmUnlink ? (
            <CardActions>
              <span className="text-sm">Unlink {status.sender}? You'll stop getting messages there.</span>
              <Button
                disabled={busy !== null}
                onClick={async () => {
                  await command("imessage.unlink");
                  setConfirmUnlink(false);
                }}
                type="button"
                variant="destructive"
              >
                {busy === "imessage.unlink" ? "Unlinking..." : "Unlink"}
              </Button>
              <QuietButton onClick={() => setConfirmUnlink(false)}>Keep it</QuietButton>
            </CardActions>
          ) : (
            <CardActions>
              <QuietButton onClick={() => setConfirmUnlink(true)}>Unlink iMessage</QuietButton>
            </CardActions>
          )}
        </CardShell>
      );
  }
}

function CardShell({
  children,
  description,
  title,
}: {
  readonly children?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly title: string;
}) {
  return (
    <section
      aria-labelledby={cardHeadingId(IMESSAGE_CARD_ID)}
      className="setup-card-enter relative flex min-w-0 scroll-mt-4 scroll-mb-4 flex-col overflow-hidden rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground"
      data-imessage-card
      id={IMESSAGE_CARD_ID}
    >
      <div className="flex shrink-0 flex-col gap-0.5">
        <p className="min-h-6 text-xs leading-6 font-medium text-muted-foreground">iMessage</p>
        <h3 className={HEADING_CLASS} id={cardHeadingId(IMESSAGE_CARD_ID)} tabIndex={-1}>
          {title}
        </h3>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3 pt-2.5">{children}</div>
    </section>
  );
}

function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <>
      <Button
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
        type="button"
        variant="outline"
      >
        {state === "copied" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        Copy
      </Button>
      <span aria-live="polite" className="text-sm text-muted-foreground" role="status">
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy; select the message instead." : ""}
      </span>
    </>
  );
}

function PendingCode({
  busy,
  notice,
  onCancel,
  platform,
  status,
}: {
  readonly busy: boolean;
  readonly notice: React.ReactNode;
  readonly onCancel: () => void;
  readonly platform: MessagesPlatform;
  readonly status: Extract<ImessageStatus, { state: "pending" }>;
}) {
  const link = deepLinkFor(platform, status.lineNumber, status.message);
  const qr = useMemo(() => (link ? null : renderSVG(qrDeepLink(status.lineNumber, status.message), { border: 2 })), [link, status]);

  return (
    <CardShell
      description={link ? "Messages should open with the message written. Tap send there." : "Send this message from your iPhone's Messages to link it."}
      title="Send the message from your iMessage"
    >
      {notice}
      <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">To</p>
        <p className="font-mono text-sm tabular-nums">{status.lineNumber}</p>
        <p className="pt-1 text-xs font-medium text-muted-foreground">Message</p>
        <p className="font-mono text-sm break-all" data-testid="imessage-link-message">
          {status.message}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {link ? (
            <Button asChild>
              <a href={link}>
                <MessageCircleIcon aria-hidden />
                Open Messages
              </a>
            </Button>
          ) : null}
          <CopyButton label="Copy the link message" text={status.message} />
        </div>
      </div>
      {qr ? (
        <figure className="flex flex-col items-start gap-1">
          <div
            aria-label="QR code that opens Messages with this message on your iPhone"
            className="size-40 rounded-lg bg-white p-1 [&_svg]:size-full"
            data-testid="imessage-qr"
            // The SVG is generated locally from the line number and the message.
            dangerouslySetInnerHTML={{ __html: qr }}
            role="img"
          />
          <figcaption className="text-xs text-muted-foreground">Scan with your iPhone's camera to open Messages.</figcaption>
        </figure>
      ) : null}
      <p className="text-sm text-muted-foreground" role="status">
        Waiting for your message. The code works until {when(status.expiresAt)}.
      </p>
      <CardActions>
        <QuietButton disabled={busy} onClick={onCancel}>
          Cancel
        </QuietButton>
      </CardActions>
    </CardShell>
  );
}

function NumberForm({
  busy,
  notice,
  onBack,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly notice: React.ReactNode;
  readonly onBack: () => void;
  readonly onSubmit: (number: string) => void;
}) {
  const id = useId();
  const [number, setNumber] = useState("");
  return (
    <CardShell description="We'll text a six-digit code to this number from Find Me a Time's line." title="Send me a code instead">
      {notice}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit(number);
        }}
      >
        <label className="text-sm font-medium" htmlFor={id}>
          Your iPhone number, with country code
        </label>
        <Input autoComplete="tel" id={id} inputMode="tel" onChange={(event) => setNumber(event.target.value)} placeholder="+1 555 123 4567" required type="tel" value={number} />
        <CardActions>
          <Button disabled={busy || !number.trim()} type="submit">
            {busy ? "Sending..." : "Send code"}
          </Button>
          <QuietButton onClick={onBack}>Back</QuietButton>
        </CardActions>
      </form>
    </CardShell>
  );
}

function FallbackCode({
  busy,
  notice,
  onCancel,
  onResend,
  onVerify,
  status,
}: {
  readonly busy: ImessageOperation | null;
  readonly notice: React.ReactNode;
  readonly onCancel: () => void;
  readonly onResend: () => void;
  readonly onVerify: (code: string) => Promise<{ result?: unknown } | null>;
  readonly status: Extract<ImessageStatus, { state: "fallback" }>;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const canResend = status.resendAt !== null && Date.parse(status.resendAt) <= now;

  const sendText: Readonly<Record<typeof status.send, string>> = {
    failed: "The code couldn't be sent. Check the number or use Connect iMessage instead.",
    queued: "Sending your code...",
    sent: "Code sent.",
    uncertain: "The code may still arrive. Wait a moment before asking for another.",
  };

  return (
    <CardShell description={`To ${status.number}. ${sendText[status.send]}`} title="Enter the code we texted you">
      {notice}
      <form
        className="flex flex-col gap-2"
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          const outcome = await onVerify(code);
          const result = outcome?.result as { status?: string; attemptsLeft?: number } | undefined;
          setWrong(result?.status === "wrong" ? (result.attemptsLeft ?? 0) : null);
          setCode("");
        }}
      >
        <label className="text-sm font-medium" htmlFor={id}>
          Six-digit code
        </label>
        <Input
          aria-describedby={wrong !== null ? `${id}-wrong` : undefined}
          aria-invalid={wrong !== null}
          autoComplete="one-time-code"
          id={id}
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          pattern="\d{6}"
          required
          value={code}
        />
        {wrong !== null ? (
          <p className={cn("text-sm", "text-destructive")} id={`${id}-wrong`}>
            {wrong > 0 ? `That code isn't right. ${wrong} ${wrong === 1 ? "try" : "tries"} left.` : "That code no longer works. Ask for a new one."}
          </p>
        ) : null}
        <CardActions>
          <Button disabled={busy !== null || code.length !== 6} type="submit">
            <CheckIcon aria-hidden />
            {busy === "imessage.link.verify_code" ? "Checking..." : "Confirm and link"}
          </Button>
          {status.sendsLeft > 0 ? (
            <QuietButton disabled={busy !== null || !canResend} onClick={onResend}>
              Send a new code
            </QuietButton>
          ) : null}
          <QuietButton disabled={busy !== null} onClick={onCancel}>
            Use a different way
          </QuietButton>
        </CardActions>
      </form>
    </CardShell>
  );
}

function ContactCardLine({
  busy,
  onCheck,
  onShare,
  state,
}: {
  readonly busy: boolean;
  readonly onCheck: () => void;
  readonly onShare: () => void;
  readonly state: "queued" | "sent" | "failed" | "uncertain" | null;
}) {
  if (state === "queued") return <p className="text-sm text-muted-foreground" role="status">Sending your contact card...</p>;
  if (state === "sent") {
    return <p className="text-sm text-muted-foreground">Contact card sent. Check iMessage and choose whether to save it.</p>;
  }
  if (state === "uncertain") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">The contact card may have arrived. Check your conversation.</span>
        <QuietButton disabled={busy} onClick={onCheck}>
          Check contact status
        </QuietButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {state === "failed" ? <p className="text-sm text-muted-foreground">The contact card couldn&apos;t be sent.</p> : null}
      <p className="text-xs text-muted-foreground">
        Optional: we send our contact card in your conversation; you choose whether to save it.
      </p>
      <CardActions>
        <Button disabled={busy} onClick={onShare} type="button" variant="outline">
          Add to contacts
        </Button>
      </CardActions>
    </div>
  );
}
