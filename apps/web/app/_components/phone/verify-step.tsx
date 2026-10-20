"use client";

import type { NotifyChannel, PhoneLink } from "@lib/contracts/phone-link";
import { AlertCircleIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { PhoneLinker } from "./phone-client";

// The number check after "Text me". A spinner shows while Thyme is texting, a
// check once the text is out, and the screen shows the 2-digit number to send
// back with the time it has left. If nothing arrives the host asks for another
// text right away; the server holds it until a minute after the last one, so the
// screen shows no countdown. The newest number is shown and earlier ones still
// work. A wrong reply replaces the number, and a box below it says so. A failed
// or expired check shows a cross. A failed send sends the host back to enter the
// number again; too many wrong replies ask to wait a few minutes and connect
// again, or contact us. When no more texts are allowed the phone is put off and
// the caller decides where to go (`later`); if texting kept failing, a dialog also
// says so, offers to tell the host when it works again, and how to reach us.

type Phase = "texting" | "sent" | "connected" | "failed" | "expired" | "later";

const POLL_MS = 2000;
// Not confirmed yet as a mailbox someone reads (shared with the team).
const CONTACT_EMAIL = "support@findmeatime.com";

const COPY = {
  change: "Back to phone number",
  codeLabel: "Reply to the text with",
  connected: "Your number is connected.",
  contact: "Contact us",
  downLede: "Thyme can't send texts right now. We'll let you know when it's working again.",
  downTitle: "Something's wrong on our side.",
  error: "Couldn't reach Thyme. Try again in a moment.",
  expired: "Time's up.",
  expiredLede: "The number ran out before your reply came in.",
  failed: "Couldn't send the text.",
  helpNow: "Need help now?",
  later: "Let's connect your phone later.",
  laterLede: "Thyme can't text you right now.",
  left: (time: string) => `${time} left`,
  lockedLede:
    "The replies didn't match the number on screen 3 times. Wait a few minutes and connect again, or contact us.",
  lockedTitle: "Something wrong?",
  newCode: "Get a new number",
  noText: "Didn't get the text, or replied and nothing happened?",
  notified: { email: "We'll email you when Thyme is back.", sms: "We'll text you when Thyme is back." },
  notify: { email: "Email me when it's back", sms: "Text me when it's back" },
  reasons: {
    non_imessage_recipient: "This number doesn't use iMessage. Check it, or set up on the web.",
    other: "Something went wrong on our side. Enter the number again and Thyme will text you as soon as it can.",
  } as Record<string, string>,
  reconnect: "Connect again",
  reconnectIn: (minutes: number) => `You can connect again in about ${minutes} min.`,
  reenter: "Enter the number again",
  resent: "Use the new number. The earlier one still works.",
  sent: "Thyme texted you.",
  sentTo: "Sent to",
  texting: "Thyme is texting you…",
  textingLede: "This can take up to a minute.",
  wrongLede: "Here's a new one. Reply with the number above.",
  wrongNumber: "Wrong number?",
  wrongTitle: "That number didn't match.",
} as const;

function phaseOf(view: PhoneLink, now: number): Phase {
  if (view.status === "connected") return "connected";
  const expired = view.status === "expired" || now >= view.expiresAt;
  if ((view.status === "failed" || expired) && view.retryEligibleAt === null) return "later";
  if (view.status === "failed") return "failed";
  if (expired) return "expired";
  return view.status === "pending" ? "texting" : "sent";
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Mark({ phase }: { readonly phase: Phase }) {
  if (phase === "texting") return <Spinner className="size-10 text-primary" aria-hidden="true" role={undefined} />;
  if (phase === "sent" || phase === "connected") return <CheckCircle2Icon aria-hidden="true" className="size-10 text-primary" />;
  return <XCircleIcon aria-hidden="true" className="size-10 text-destructive" />;
}

export function VerifyStep({
  initial,
  later,
  linker,
  notifyBy,
  onBack,
  verified,
}: {
  readonly initial: PhoneLink;
  readonly later: ReactNode;
  readonly linker: PhoneLinker;
  readonly notifyBy: readonly NotifyChannel[];
  readonly onBack: () => void;
  readonly verified: { readonly lede: string; readonly action: ReactNode };
}) {
  const [view, setView] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [notified, setNotified] = useState<NotifyChannel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const phase = phaseOf(view, now);
  // Put off because sending kept failing, not because the host never replied.
  const down = phase === "later" && view.status === "failed";
  const waiting = phase === "texting" || phase === "sent";

  const refresh = useCallback(async () => {
    const r = await linker.read();
    if (r.ok) setView(r.view);
  }, [linker]);

  // The heading moves with the phase, so a screen reader hears each change.
  useEffect(() => heading.current?.focus({ preventScroll: true }), [phase]);
  useEffect(() => {
    if (phase === "connected" || phase === "later") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, refresh]);

  async function notify(channel: NotifyChannel) {
    setNotice("");
    if (await linker.notify(channel)) setNotified(channel);
    else setNotice(COPY.error);
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    const r = await linker.retry();
    setBusy(false);
    if (!r.ok) {
      setNotice(COPY.error);
      return;
    }
    setView(r.view);
    setNow(Date.now());
    // After a lockout the earlier numbers are gone, so there is nothing "still working" to mention.
    setResent(phase === "sent");
  }

  const canAsk = view.retryEligibleAt !== null;
  // The text did go out when the replies kept missing, so that one waits instead of asking for the number again.
  const locked = view.failure === "too_many_wrong_replies";
  const eligible = view.retryEligibleAt !== null && now >= view.retryEligibleAt;
  const heads: Record<Phase, string> = {
    connected: COPY.connected,
    expired: COPY.expired,
    failed: locked ? COPY.lockedTitle : COPY.failed,
    later: COPY.later,
    sent: COPY.sent,
    texting: COPY.texting,
  };
  const ledes: Record<Phase, string | null> = {
    connected: verified.lede,
    expired: COPY.expiredLede,
    failed: locked ? COPY.lockedLede : (COPY.reasons[view.failure ?? ""] ?? COPY.reasons.other!),
    later: COPY.laterLede,
    sent: null,
    texting: COPY.textingLede,
  };

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-start justify-center gap-4 px-4"
      data-screen="verify"
    >
      <Mark phase={phase} />
      <h1 className="font-display text-3xl outline-none" ref={heading} tabIndex={-1}>
        {heads[phase]}
      </h1>
      {ledes[phase] ? <p className="text-muted-foreground">{ledes[phase]}</p> : null}
      {phase === "sent" && view.code ? (
        <div className="flex w-full flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">{COPY.codeLabel}</span>
          <span className="font-mono text-5xl tabular-nums" data-testid="phone-code" key={view.code}>
            {view.code}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">{COPY.left(clock(view.expiresAt - now))}</span>
        </div>
      ) : null}
      {phase === "sent" && view.wrongReplies > 0 ? (
        <div className="flex w-full gap-2 rounded-xl border border-destructive/40 px-4 py-3" key={view.wrongReplies} role="alert">
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="flex flex-col text-sm">
            <strong>{COPY.wrongTitle}</strong>
            <span>{COPY.wrongLede}</span>
          </p>
        </div>
      ) : null}
      {waiting ? (
        <p className="text-sm text-muted-foreground">
          {COPY.sentTo} <span className="text-foreground">{view.phone}</span>
        </p>
      ) : null}
      {phase === "sent" && resent && view.wrongReplies === 0 ? <p className="text-sm">{COPY.resent}</p> : null}

      {waiting ? (
        <div className="flex flex-col items-start gap-1 text-sm">
          {phase === "sent" && canAsk ? (
            <Button className="h-auto p-0" disabled={busy} onClick={() => void retry()} type="button" variant="link">
              {COPY.noText}
            </Button>
          ) : null}
          <span>
            {COPY.wrongNumber}{" "}
            <Button className="h-auto p-0" onClick={onBack} type="button" variant="link">
              {COPY.change}
            </Button>
          </span>
        </div>
      ) : null}
      {phase === "failed" && !locked ? (
        <Button onClick={onBack} type="button">
          {COPY.reenter}
        </Button>
      ) : null}
      {phase === "failed" && locked ? (
        <div className="flex flex-col items-start gap-2">
          <Button disabled={!eligible || busy} onClick={() => void retry()} type="button">
            {COPY.reconnect}
          </Button>
          {!eligible && view.retryEligibleAt !== null ? (
            <p className="text-sm text-muted-foreground">
              {COPY.reconnectIn(Math.ceil((view.retryEligibleAt - now) / 60_000))}
            </p>
          ) : null}
          <a className="text-sm text-primary underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>
            {COPY.contact}
          </a>
        </div>
      ) : null}
      {phase === "expired" ? (
        <div className="flex flex-col items-start gap-2">
          <Button disabled={busy} onClick={() => void retry()} type="button">
            {COPY.newCode}
          </Button>
          <Button className="h-auto p-0" onClick={onBack} type="button" variant="link">
            {COPY.change}
          </Button>
        </div>
      ) : null}
      {phase === "connected" ? verified.action : null}
      {phase === "later" ? later : null}
      {down ? (
        <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{COPY.downTitle}</DialogTitle>
              <DialogDescription>{COPY.downLede}</DialogDescription>
            </DialogHeader>
            {notified ? (
              <p className="text-sm" role="status">
                {COPY.notified[notified]}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {notifyBy.map((channel) => (
                  <Button key={channel} onClick={() => void notify(channel)} type="button" variant="outline">
                    {COPY.notify[channel]}
                  </Button>
                ))}
              </div>
            )}
            {notice ? (
              <p className="text-sm text-destructive" role="alert">
                {notice}
              </p>
            ) : null}
            <DialogFooter className="flex-col items-start gap-2 sm:flex-col">
              {later}
              <p className="text-sm">
                {COPY.helpNow}{" "}
                <a className="text-primary underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>
                  {COPY.contact}
                </a>
              </p>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {notice && !down ? (
        <p className="text-sm text-destructive" role="alert">
          {notice}
        </p>
      ) : null}
    </main>
  );
}
