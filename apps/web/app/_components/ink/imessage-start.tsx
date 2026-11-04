"use client";

import { type ImessageStartStatus, messagesPlatform } from "@lib/contracts/imessage";
import type { MessagingChannel } from "@lib/contracts/messaging-channel";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appLinkFor } from "@/app/_components/imessage/imessage-card";
import { Brand, LanguageSelect } from "./chrome";
import { channelCopy, COPY, type Locale } from "./copy";
import { AppGlyph, ExternalIcon, StatusMark } from "./icons";
import { GoogleStart } from "./landing-parts";
import { NumberForm } from "./number-form";
import { clock, isPhone, SendPanel, shownNumber, useNow, usePlatform } from "./send";

// The landing that starts from iMessage (/?flow=imessage, host-imessage-channel D15). Onboard with iMessage
// gets a one-time link code for this browser (POST /api/imessage/start). On a phone it opens Messages with the
// message written and the page becomes the waiting screen; on a computer the send panel opens as a popup over
// the landing, since the code expires. Once the message arrives the page asks for Google sign-in, whose
// callback carries the attempt to /app, where Confirm and link binds it. Nothing is linked on this page.
// Like the landing redesign's ImessageStart, this wraps the server-rendered landing and takes the page over
// once the start has begun.
// /?flow=whatsapp starts the same way from WhatsApp (host-whatsapp-channel D7): the start asks for a WhatsApp
// code ({"channel":"whatsapp"}), a phone opens wa.me, and the popup shows the WhatsApp number, its QR code
// and Open WhatsApp. An attempt this browser already has keeps its own channel.
// /?flow=telegram starts from Telegram (host-telegram-channel D7): a Telegram code, the bot's t.me start link on a
// phone, and on a computer the popup with the link's QR code, Open Telegram and Copy. The received screen shows
// the sender's Telegram name.
// An iMessage start asks for the number first (imessage-number-registration D1, D3): the server registers it
// with Photon and addresses the code to the number Photon assigned. The number is kept for this visit.

const POLL_MS = 2000;

type Start = { readonly begin: () => void; readonly busy: boolean; readonly channel: MessagingChannel; readonly error: string };
const StartContext = createContext<Start | null>(null);

type Answer = { readonly status: ImessageStartStatus | null; readonly error: string; readonly category?: string };

async function readStart(): Promise<ImessageStartStatus | null> {
  const response = await fetch("/api/imessage/start", { cache: "no-store" }).catch(() => null);
  return response?.ok ? ((await response.json()) as ImessageStartStatus) : null;
}

async function postStart(locale: Locale, channel: MessagingChannel, number: string | null): Promise<Answer> {
  const t = channelCopy(COPY[locale], channel).send;
  const body = JSON.stringify(channel === "imessage" ? { number } : { channel });
  const response = await fetch("/api/imessage/start", { body, headers: { "content-type": "application/json" }, method: "POST" }).catch(() => null);
  const answer = (await response?.json().catch(() => null)) as ImessageStartStatus | { error?: { category: string } } | null;
  if (response?.ok && answer && "state" in answer) return { error: "", status: answer };
  const category = answer && "error" in answer ? answer.error?.category : undefined;
  return { category, error: category === "rate_limited" ? t.limited : category === "unavailable_configuration" ? t.unavailable : t.error, status: null };
}

export function ImessageStart({
  channel: flow = "imessage",
  children,
  locale,
}: {
  // The channel the page's link names; an attempt this browser already has names its own.
  readonly channel?: MessagingChannel;
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  const platform = usePlatform();
  const phone = isPhone(platform);
  const [status, setStatus] = useState<ImessageStartStatus | null>(null);
  const [phase, setPhase] = useState<"idle" | "number" | "popup" | "waiting">("idle");
  // The number entered for iMessage on this visit.
  const [number, setNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = status?.state === "pending" ? status : null;
  const channel = status?.state === "pending" || status?.state === "received" ? status.channel : flow;
  const t = channelCopy(COPY[locale], channel);
  const now = useNow(phase !== "idle" || status?.state === "received");

  // A reload finds this browser's attempt where it was.
  useEffect(() => {
    void readStart().then((first) => {
      if (!first) return;
      setStatus(first);
      if (first.state === "pending") setPhase(isPhone(messagesPlatform(navigator.userAgent, navigator.maxTouchPoints)) ? "waiting" : "popup");
    });
  }, []);

  const polling = pending !== null && phase !== "idle";
  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => {
      void readStart().then((next) => {
        if (next && next.state !== "none") setStatus(next);
      });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [polling]);

  const open = useCallback(
    (code: { channel: MessagingChannel; lineNumber: string; message: string }) => {
      if (!phone) {
        setPhase("popup");
        return;
      }
      setPhase("waiting");
      const link = appLinkFor(code.channel, platform, code.lineNumber, code.message);
      if (link) window.location.assign(link);
    },
    [phone, platform],
  );

  const fresh = useCallback(async () => {
    if (flow === "imessage" && !number) {
      setPhase("number");
      return null;
    }
    setBusy(true);
    setError("");
    const answer = await postStart(locale, flow, number);
    setBusy(false);
    if (!answer.status) {
      setError(answer.error);
      return null;
    }
    setStatus(answer.status);
    return answer.status.state === "pending" ? answer.status : null;
  }, [flow, locale, number]);

  // The number form's submit: a refused number shows under the field, a limit as the screen's notice.
  const submitNumber = useCallback(
    async (e164: string) => {
      setBusy(true);
      setError("");
      const answer = await postStart(locale, "imessage", e164);
      setBusy(false);
      if (answer.status) {
        setNumber(e164);
        setStatus(answer.status);
        setPhase("idle");
        if (answer.status.state === "pending") open(answer.status);
        return null;
      }
      if (answer.category === "invalid_input") return "invalid" as const;
      if (answer.category === "rate_limited") {
        setError(answer.error);
        return null;
      }
      return "other" as const;
    },
    [locale, open],
  );

  const begin = useCallback(async () => {
    if (busy) return;
    // A code that still works is shown again rather than replaced.
    const code = pending && Date.parse(pending.expiresAt) > Date.now() ? pending : await fresh();
    if (code) open(code);
  }, [busy, fresh, open, pending]);

  const received = status?.state === "received" ? status : null;
  const takeover = received ? "received" : phase === "number" ? "number" : phase === "waiting" && pending ? "waiting" : null;

  // The heading moves with the screen, so a screen reader hears each change.
  useEffect(() => heading.current?.focus({ preventScroll: true }), [takeover, phase]);

  // Escape closes the popup; the code keeps working until it expires.
  useEffect(() => {
    if (phase !== "popup") return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setPhase("idle");
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase]);

  if (takeover === "number") {
    const n = COPY[locale].number;
    return (
      <div className="inner" data-screen="imessage-number">
        <header className="top">
          <Brand />
          <LanguageSelect locale={locale} />
        </header>
        <main className="handoff">
          <h1 ref={heading} tabIndex={-1}>
            {n.heading}
          </h1>
          <p className="lede small">{n.lede}</p>
          <NumberForm id="start-number" look="ink" onSubmit={submitNumber} t={n} />
          {error ? (
            <p className="field-help error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="fine">{n.fine}</p>
          <p className="alt">
            {t.landing.noImessage}{" "}
            <a className="link-btn" href="/auth/sign-in">
              {t.landing.google}
            </a>
          </p>
        </main>
      </div>
    );
  }

  if (takeover) {
    const expired = pending ? Date.parse(pending.expiresAt) <= now : false;
    return (
      <div className="inner" data-screen={takeover === "received" ? "imessage-received" : "imessage-waiting"}>
        <header className="top">
          <Brand />
          <LanguageSelect locale={locale} />
        </header>
        <main className="handoff verify">
          {received ? (
            <>
              <StatusMark state="done" />
              <h1 ref={heading} tabIndex={-1}>
                {t.send.received}
              </h1>
              <p className="lede">{t.send.receivedLede}</p>
              <p className="sent-to">
                {t.send.from} <b>{received.sender}</b>
              </p>
              <div className="start" style={{ alignItems: "stretch", width: "100%" }}>
                <GoogleStart locale={locale} />
              </div>
              <span className="code-left">{t.send.finishBy(clock(Date.parse(received.confirmBy) - now))}</span>
            </>
          ) : expired ? (
            <>
              <StatusMark state="failed" />
              <h1 ref={heading} tabIndex={-1}>
                {t.link.expired}
              </h1>
              <p className="lede">{t.link.expiredLede}</p>
              <div className="verify-actions">
                <button aria-disabled={busy} className="primary-btn" onClick={() => void fresh().then((code) => code && open(code))} type="button">
                  {t.link.again}
                </button>
                <a className="link-btn" href="/auth/sign-in">
                  {t.landing.google}
                </a>
              </div>
            </>
          ) : (
            <>
              <StatusMark state="busy" />
              <h1 ref={heading} tabIndex={-1}>
                {t.send.waiting}
              </h1>
              <p className="lede">{t.send.waitingStartLede}</p>
              <p className="sent-to">
                {t.send.to} <b>Thyme · {shownNumber(pending!)}</b>
              </p>
              <span className="code-left">{t.send.left(clock(Date.parse(pending!.expiresAt) - now))}</span>
              <div className="verify-help">
                <a className="link-btn" href={appLinkFor(pending!.channel, platform, pending!.lineNumber, pending!.message) ?? "#"}>
                  {t.send.reopen}
                </a>
                <span>
                  {t.landing.noImessage}{" "}
                  <a className="link-btn" href="/auth/sign-in">
                    {t.landing.google}
                  </a>
                </span>
              </div>
            </>
          )}
          {error ? (
            <p className="field-help error" role="alert">
              {error}
            </p>
          ) : null}
        </main>
      </div>
    );
  }

  // The page's stage is a size container, which would hold a fixed layer inside it, so the popup is placed on
  // the body in its own ink layer.
  const popup =
    phase === "popup" && pending ? (
      <div className="ink ink-layer" lang={locale}>
        <div className="scrim">
          <div aria-labelledby="send-h" aria-modal="true" className="modal" role="dialog">
            <SendPanel
              busy={busy}
              code={pending}
              foot={
                <>
                  <span>
                    {t.landing.noImessage}{" "}
                    <a className="link-btn" href="/auth/sign-in">
                      {t.landing.google}
                    </a>
                  </span>
                  <span className="fine" style={{ maxWidth: "64ch" }}>
                    {t.send.fine}
                  </span>
                  {error ? (
                    <span className="field-help error" role="alert">
                      {error}
                    </span>
                  ) : null}
                </>
              }
              headingRef={heading}
              labels={t.copy}
              lede={t.send.popupLede}
              locale={locale}
              now={now}
              onClose={() => setPhase("idle")}
              onNewCode={() => void fresh()}
              platform={platform}
              t={t.send}
              title={t.send.popupTitle}
              titleId="send-h"
            />
          </div>
        </div>
      </div>
    ) : null;

  return (
    <StartContext.Provider value={{ begin: () => void begin(), busy, channel, error }}>
      {children}
      {popup ? createPortal(popup, document.body) : null}
    </StartContext.Provider>
  );
}

// The landing's start block on /?flow=imessage (or /?flow=whatsapp): Onboard with iMessage (or WhatsApp) and
// what it opens, with Google for people without it. It sits where the Google start sits on /.
export function ImessageStartBlock({ locale }: { readonly locale: Locale }) {
  const start = useContext(StartContext);
  const platform = usePlatform();
  if (!start) throw new Error("ImessageStartBlock belongs inside ImessageStart");
  const t = channelCopy(COPY[locale], start.channel);
  return (
    <>
      <button aria-disabled={start.busy} className={isPhone(platform) ? "primary-btn wide" : "primary-btn"} onClick={start.begin} type="button">
        <AppGlyph channel={start.channel} />
        {t.send.start}
      </button>
      <p className="opens">
        <ExternalIcon />
        <span>{isPhone(platform) ? t.send.startOpensPhone : t.send.startOpensDesktop}</span>
      </p>
      {start.error ? (
        <p className="field-help error" role="alert">
          {start.error}
        </p>
      ) : null}
      <p className="fine">{t.send.fine}</p>
      <p className="alt">
        {t.landing.noImessage}{" "}
        <a className="link-btn" href="/auth/sign-in">
          {t.landing.google}
        </a>
      </p>
    </>
  );
}
