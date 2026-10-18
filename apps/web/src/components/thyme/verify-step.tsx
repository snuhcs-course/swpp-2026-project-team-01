// AI-generated with Claude Code (claude-opus-5-5), 2026-10-18
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { NotifyChannel, PhoneLink } from "@/contracts/phone-link";
import type { Locale } from "@/contracts/profile";
import { Brand } from "./brand";
import { COPY } from "./copy";
import { LanguageSelect } from "./language-select";
import type { PhoneLinker } from "./phone-link";
import { AlertIcon } from "./icons";
import { StatusMark } from "./status-mark";

// The number check after "Text me". The ring spins while Thyme is texting, turns into a check once the text is
// out, and the screen shows the 2-digit number to send back with the time it has left. If nothing arrives the
// host asks for another text right away; the server holds it until a minute after the last one, so the screen
// shows no countdown. The newest number is shown and earlier ones still work. A wrong reply replaces the
// number, and a box below it says so. A failed or expired check turns the ring into a cross. A failed send
// sends the host back to enter the number again; too many wrong replies ask to wait a few minutes and connect
// again, or contact us. When no more texts are allowed the phone is put off and the caller decides where to go
// (`later`); if texting kept failing, a dialog also says so, offers to tell the host when it works again
// (`notifyBy`), and how to reach us. A checked number shows the caller's `verified` ending.

type Phase = "texting" | "sent" | "connected" | "failed" | "expired" | "later";

const POLL_MS = 2000;
// not confirmed yet as a mailbox someone reads
const CONTACT_EMAIL = "support@findmeatime.com";

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

export function VerifyStep({ locale, linker, initial, onBack, verified, later, notifyBy }: {
  locale: Locale;
  linker: PhoneLinker;
  initial: PhoneLink;
  onBack: () => void;
  verified: { lede: string; action: ReactNode };
  later: ReactNode;
  notifyBy: NotifyChannel[];
}) {
  const t = COPY[locale].verify;
  const [view, setView] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [notified, setNotified] = useState<NotifyChannel | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const notedRef = useRef<HTMLParagraphElement>(null);
  const phase = phaseOf(view, now);
  // put off because sending kept failing, not because the host never replied
  const down = phase === "later" && view.status === "failed";
  const waiting = phase === "texting" || phase === "sent";

  const refresh = useCallback(async () => {
    const r = await linker.read();
    if (r.ok) setView(r.view);
  }, [linker]);

  // the heading moves with the phase, so a screen reader hears each change
  useEffect(() => heading.current?.focus({ preventScroll: true }), [phase]);
  useEffect(() => { if (down) dialog.current?.showModal(); }, [down]);
  // the pressed button is replaced by the confirmation, so focus moves there instead of leaving the dialog
  useEffect(() => { if (notified) notedRef.current?.focus(); }, [notified]);
  useEffect(() => {
    if (phase === "connected" || phase === "later") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [waiting, refresh]);

  async function notify(channel: NotifyChannel) {
    setNotice("");
    if (await linker.notify(channel)) setNotified(channel);
    else setNotice(t.error);
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    const r = await linker.retry();
    setBusy(false);
    if (!r.ok) { setNotice(t.error); return; }
    setView(r.view);
    setNow(Date.now());
    // after a lockout the earlier numbers are gone, so there is nothing "still working" to mention
    setResent(phase === "sent");
  }

  const canAsk = view.retryEligibleAt !== null;
  // the text did go out when the replies kept missing, so that one waits instead of asking for the number again
  const locked = view.failure === "too_many_wrong_replies";
  const eligible = view.retryEligibleAt !== null && now >= view.retryEligibleAt;
  const failed = locked ? t.lockedTitle : t.failed;
  const heads: Record<Phase, string> = { texting: t.texting, sent: t.sent, connected: t.connected, failed, expired: t.expired, later: t.later };
  const ledes: Record<Phase, string | null> = {
    texting: t.textingLede, sent: null, connected: verified.lede, expired: t.expiredLede, later: t.laterLede,
    failed: locked ? t.lockedLede : t.reasons[view.failure ?? ""] ?? t.reasons.other,
  };

  return (
    <div className="inner" data-screen="verify">
      <header className="top">
        <Brand />
        <LanguageSelect locale={locale} />
      </header>
      <main className="handoff verify">
        <StatusMark state={phase === "texting" ? "busy" : phase === "sent" || phase === "connected" ? "done" : "failed"} />
        <h1 ref={heading} tabIndex={-1}>{heads[phase]}</h1>
        {ledes[phase] && <p className="lede">{ledes[phase]}</p>}
        {phase === "sent" && view.code && (
          <div className="code">
            <span className="code-label">{t.codeLabel}</span>
            <span className="code-digits" key={view.code}>{view.code}</span>
            <span className="code-left">{t.left(clock(view.expiresAt - now))}</span>
          </div>
        )}
        {/* keyed by the count, so each wrong reply shakes the box again; it sits below the number so the number stays put */}
        {phase === "sent" && view.wrongReplies > 0 && (
          <div className="wrong" role="alert" key={view.wrongReplies}>
            <AlertIcon />
            <p><strong>{t.wrongTitle}</strong><span>{t.wrongLede}</span></p>
          </div>
        )}
        {waiting && <p className="sent-to">{t.sentTo} <span>{view.phone}</span></p>}
        {phase === "sent" && resent && view.wrongReplies === 0 && <p className="field-help">{t.resent}</p>}

        {waiting && (
          <div className="verify-help">
            {/* the question itself asks for another text */}
            {phase === "sent" && canAsk && <button className="link-btn" type="button" disabled={busy} onClick={() => void retry()}>{t.noText}</button>}
            <span>{t.wrongNumber} <button className="link-btn" type="button" onClick={onBack}>{t.change}</button></span>
          </div>
        )}
        {phase === "failed" && !locked && <button className="primary-btn" type="button" onClick={onBack}>{t.reenter}</button>}
        {phase === "failed" && locked && (
          <div className="verify-actions">
            <button className="primary-btn" type="button" disabled={!eligible || busy} onClick={() => void retry()}>{t.reconnect}</button>
            {!eligible && view.retryEligibleAt !== null && <p className="field-help">{t.reconnectIn(Math.ceil((view.retryEligibleAt - now) / 60_000))}</p>}
            <a className="link-btn" href={`mailto:${CONTACT_EMAIL}`}>{t.contact}</a>
          </div>
        )}
        {phase === "expired" && (
          <div className="verify-actions">
            <button className="primary-btn" type="button" disabled={busy} onClick={() => void retry()}>{t.newCode}</button>
            <button className="link-btn" type="button" onClick={onBack}>{t.change}</button>
          </div>
        )}
        {phase === "connected" && verified.action}
        {phase === "later" && later}
        {down && (
          <dialog className="putoff" ref={dialog} aria-labelledby="putoff-h">
            <h2 id="putoff-h">{t.downTitle}</h2>
            <p>{t.downLede}</p>
            {notified
              ? <p className="field-help" role="status" ref={notedRef} tabIndex={-1}>{t.notified[notified]}</p>
              : <div className="notify">{notifyBy.map((c) => <button className="secondary-btn" type="button" key={c} onClick={() => void notify(c)}>{t.notify[c]}</button>)}</div>}
            {notice && <p className="field-help error" role="alert">{notice}</p>}
            <div className="putoff-go">{later}</div>
            <p className="contact">{t.helpNow} <a href={`mailto:${CONTACT_EMAIL}`}>{t.contact}</a></p>
          </dialog>
        )}
        {notice && <p className="field-help error" role="alert">{notice}</p>}

        {linker.demo && waiting && (
          <p className="demo-row">
            <span>{t.demo}</span>
            <button className="link-btn" type="button" onClick={() => { linker.demo!.reply(); void refresh(); }}>{t.demoReply}</button>
            <button className="link-btn" type="button" onClick={() => { linker.demo!.wrong(); void refresh(); }}>{t.demoWrong}</button>
            <button className="link-btn" type="button" onClick={() => { linker.demo!.fail(); void refresh(); }}>{t.demoFail}</button>
          </p>
        )}
      </main>
    </div>
  );
}
