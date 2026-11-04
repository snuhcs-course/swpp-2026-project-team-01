"use client";

import type { ImessageOperation, ImessageStatus } from "@lib/contracts/imessage";
import {
  askChannels,
  channelName,
  deviceKind,
  type DeviceKind,
  type MessagingChannel,
  shownChannel,
  switchChannels,
} from "@lib/contracts/messaging-channel";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { appLinkFor, readStatus, rememberedLater, rememberLater, sendCommand } from "@/app/_components/imessage/imessage-card";
import { Brand, InkStage, LanguageSelect } from "./chrome";
import { channelCopy, COPY, type Locale, replacesText } from "./copy";
import { AppGlyph, ExternalIcon, StatusMark } from "./icons";
import { NumberForm } from "./number-form";
import { clock, isPhone, MessagePreview, type SendCode, SendPanel, shownNumber, useNow, usePlatform } from "./send";

// The /app link step (H11, D15, D16): right after Google sign-in, in place of the phone number the landing
// redesign asked for, a host who has not linked iMessage sends Thyme one message. The step opens with a link
// code already made. On a phone, Open Messages is a plain link the tap follows, and the screen then waits; on a
// computer the send panel shows the QR code, this Mac's Messages and Copy. The message arriving shows the
// masked sender for Confirm and link; an attempt carried over from the iMessage start on the landing shows here
// the same way. A code that ran out shows Time's up with a new one a tap away. The step shows when a message
// has arrived for the host to confirm, or, unless this browser chose Set up here in web chat (Maybe later,
// remembered as the Connect iMessage card does), when a code is waiting or the host is not ready and has none.
// Its words follow the `lang` cookie.
// WhatsApp (host-whatsapp-channel D6, D7, D12) uses the same step. The channel follows the device: Android
// makes a WhatsApp code, an iPhone, iPad or Mac an iMessage code with Use WhatsApp instead, and any other
// computer first asks which app the host uses on their phone. A code or a sender already there keeps its own
// channel. Confirming a WhatsApp sender first says what Thyme will send there, and confirming either says
// which earlier link it replaces.
// Telegram (host-telegram-channel D6, D7, D13) uses it too: Android gets Telegram where WhatsApp is not configured
// and Use Telegram instead where it is, Apple devices get Use Telegram instead beside iMessage, the app question
// lists every configured channel, a Telegram code opens the bot's start link, and confirming a Telegram sender
// shows their Telegram name and says where Telegram keeps the chat.
// An iMessage code needs the host's number first (imessage-number-registration D1, D3): Photon's shared lines
// read only registered numbers, so the step asks for it, the server registers it, and the code it makes is
// addressed to the number Photon assigned. The number is kept for this visit, so a new code needs no new entry.

const POLL_MS = 2000;

export function LinkStep({ children, locale, ready }: { readonly children: ReactNode; readonly locale: Locale; readonly ready: boolean }) {
  const base = COPY[locale];
  const platform = usePlatform();
  const phone = isPhone(platform);
  const [shown, setShown] = useState<"loading" | "step" | "chat">("loading");
  const [status, setStatus] = useState<ImessageStatus | null>(null);
  // The latest code, kept after the server stops showing it so the screen can say it ran out.
  const [code, setCode] = useState<SendCode | null>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState<ImessageOperation | null>(null);
  const [error, setError] = useState("");
  // What this device is offered, the app question while it is open, and the channel last asked for.
  const [device, setDevice] = useState<DeviceKind>("other");
  const [asking, setAsking] = useState(false);
  const [wanted, setWanted] = useState<MessagingChannel | null>(null);
  // The number entered for iMessage on this visit, and whether the step is asking for it.
  const [number, setNumber] = useState<string | null>(null);
  const [askingNumber, setAskingNumber] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const now = useNow(shown === "step");

  const take = useCallback((next: ImessageStatus | null | undefined) => {
    if (!next) return;
    setStatus(next);
    if (next.state === "pending") setCode({ channel: next.channel, expiresAt: next.expiresAt, lineNumber: next.lineNumber, message: next.message });
  }, []);

  const command = useCallback(
    async (operation: ImessageOperation, input: unknown = {}) => {
      setBusy(operation);
      setError("");
      const outcome = await sendCommand({ input, operation, retryKey: crypto.randomUUID() });
      setBusy(null);
      take(outcome.status);
      if (outcome.lost) setError(base.send.lost);
      else if (outcome.error) setError(outcome.error.category === "rate_limited" ? base.send.limited : base.send.error);
      return !outcome.lost && !outcome.error;
    },
    [base, take],
  );

  // A code for the channel; the app question closes once it is made. iMessage asks for the number first.
  const newCode = useCallback(
    async (channel: MessagingChannel, entered: string | null = number) => {
      setOpened(false);
      setWanted(channel);
      if (channel === "imessage" && !entered) {
        setAsking(false);
        setAskingNumber(true);
        return;
      }
      if (await command("imessage.link.create", channel === "imessage" ? { channel, number: entered } : { channel })) {
        setAsking(false);
        setAskingNumber(false);
      }
    },
    [command, number],
  );

  // The number form's submit: a refused number shows under the field, anything else as the step's notice.
  const submitNumber = useCallback(
    async (e164: string) => {
      setBusy("imessage.link.create");
      setError("");
      const outcome = await sendCommand({ input: { channel: "imessage", number: e164 }, operation: "imessage.link.create", retryKey: crypto.randomUUID() });
      setBusy(null);
      take(outcome.status);
      if (!outcome.lost && !outcome.error) {
        setNumber(e164);
        setAskingNumber(false);
        setAsking(false);
        setOpened(false);
        return null;
      }
      if (!outcome.lost && outcome.error?.category === "invalid_input") return "invalid" as const;
      if (!outcome.lost && outcome.error?.category === "rate_limited") {
        setError(base.send.limited);
        return null;
      }
      return "other" as const;
    },
    [base, take],
  );

  // The first read decides whether the step shows, and makes the code when it does. It runs once, so a
  // language change (which re-renders with new words) does not make another code.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const first = await readStatus();
      const kind = deviceKind(navigator.userAgent);
      setDevice(kind);
      const later = rememberedLater();
      const show =
        first?.state === "received" || (!later && (first?.state === "pending" || (first?.state === "none" && !ready)));
      if (!first || !show) {
        setShown("chat");
        return;
      }
      take(first);
      setShown("step");
      if (first.state !== "none") return;
      const channel = shownChannel(kind, first.channels);
      if (channel) await newCode(channel);
      else setAsking(true);
    })();
  }, [newCode, ready, take]);

  const state = status?.state;
  useEffect(() => {
    if (shown !== "step" || state !== "pending") return;
    const id = window.setInterval(() => void readStatus().then(take), POLL_MS);
    return () => window.clearInterval(id);
  }, [shown, state, take]);

  const expired = state !== "received" && state !== "linked" && code !== null && Date.parse(code.expiresAt) <= now;
  const screen =
    state === "received"
      ? "confirm"
      : state === "linked"
        ? "connected"
        : asking
          ? "ask"
          : askingNumber
            ? "number"
            : !code
            ? "nocode"
            : expired && phone
              ? "expired"
              : phone
                ? opened
                  ? "waiting"
                  : "send"
                : "panel";

  // The heading moves with the screen, so a screen reader hears each change.
  useEffect(() => heading.current?.focus({ preventScroll: true }), [screen, expired]);

  if (shown === "chat") return <>{children}</>;
  if (shown === "loading" || !status) {
    return (
      <p className="sr-only" role="status">
        Loading your workspace...
      </p>
    );
  }
  if (status.state === "unavailable" || status.state === "fallback") return <>{children}</>;

  // The channel on screen: the sender's or binding's, else the code's, else the one asked for.
  const channel: MessagingChannel = status.state === "received" || status.state === "linked" ? status.channel : (code?.channel ?? wanted ?? "imessage");
  const c = channelCopy(base, channel);
  const others =
    screen === "number"
      ? switchChannels(device, status.channels, "imessage")
      : code && (screen === "panel" || screen === "send" || screen === "waiting")
        ? switchChannels(device, status.channels, code.channel)
        : [];

  const toChat = (later: boolean) => {
    if (later) rememberLater();
    setShown("chat");
    window.scrollTo({ top: 0 });
  };

  const skip = (alt: string) => (
    <span>
      {alt}{" "}
      <button className="link-btn" onClick={() => toChat(true)} type="button">
        {c.link.skip}
      </button>
    </span>
  );
  // Use Telegram instead (or another channel): a code on that channel, which ends this one.
  const switcher =
    others.length > 0
      ? others.map((other) => (
          <button className="link-btn" disabled={busy !== null} key={other} onClick={() => void newCode(other)} type="button">
            {c.link.switchTo(channelName(other))}
          </button>
        ))
      : null;
  const notice = error ? (
    <p className="field-help error" role="alert">
      {error}
    </p>
  ) : null;

  let body: ReactNode;
  switch (screen) {
    case "panel":
      return (
        <InkStage locale={locale}>
          <div className="inner" data-screen="imessage-link">
            <header className="top">
              <Brand />
              <LanguageSelect locale={locale} />
            </header>
            <main className="panel-page">
              <section aria-labelledby="connect-h" className="modal">
                <SendPanel
                  busy={busy !== null}
                  code={code!}
                  foot={
                    <>
                      {switcher}
                      {skip(c.link.altDesktop)}
                      <span className="fine" style={{ maxWidth: "64ch" }}>
                        {c.send.fine}
                      </span>
                      {notice}
                    </>
                  }
                  headingRef={heading}
                  labels={c.copy}
                  lede={c.link.lede}
                  locale={locale}
                  now={now}
                  onNewCode={() => void newCode(channel)}
                  pageHeading
                  platform={platform}
                  t={c.send}
                  title={c.link.heading}
                  titleId="connect-h"
                />
              </section>
            </main>
          </div>
        </InkStage>
      );

    case "ask":
      // Another computer: which app the host uses on their phone decides the code (D7).
      body = (
        <main className="handoff">
          <h1 ref={heading} tabIndex={-1}>
            {c.link.askTitle}
          </h1>
          <p className="lede small">{c.link.askLede}</p>
          <div className="choices">
            {askChannels(status.channels).map((option) => (
              <button
                aria-disabled={busy !== null}
                className="secondary-btn"
                key={option}
                onClick={() => busy === null && void newCode(option)}
                type="button"
              >
                <AppGlyph channel={option} />
                {channelName(option)}
              </button>
            ))}
          </div>
          {notice}
          <p className="alt">{skip(c.link.altDesktop)}</p>
        </main>
      );
      break;

    case "number":
      body = (
        <main className="handoff">
          <h1 ref={heading} tabIndex={-1}>
            {base.number.heading}
          </h1>
          <p className="lede small">{base.number.lede}</p>
          <NumberForm id="link-number" look="ink" onSubmit={submitNumber} t={base.number} />
          {notice}
          <p className="fine">{base.number.fine}</p>
          {switcher ? <p className="opens">{switcher}</p> : null}
          <p className="alt">{skip(phone ? c.link.altPhone : c.link.altDesktop)}</p>
        </main>
      );
      break;

    case "send": {
      const link = appLinkFor(code!.channel, platform, code!.lineNumber, code!.message);
      body = (
        <main className="handoff">
          <h1 ref={heading} tabIndex={-1}>
            {c.link.heading}
          </h1>
          <p className="lede small">{c.link.ledePhone}</p>
          <MessagePreview code={code!} t={c.send} />
          <a className="primary-btn wide" href={link ?? "#"} onClick={() => setOpened(true)}>
            <AppGlyph channel={code!.channel} />
            {c.send.open}
          </a>
          <p className="opens">
            <ExternalIcon />
            <span>{c.send.opensNote}</span>
          </p>
          {notice}
          <p className="fine">{c.send.fine}</p>
          {switcher ? <p className="opens">{switcher}</p> : null}
          <p className="alt">{skip(c.link.altPhone)}</p>
        </main>
      );
      break;
    }

    case "waiting":
      body = (
        <main className="handoff verify">
          <StatusMark state="busy" />
          <h1 ref={heading} tabIndex={-1}>
            {c.send.waiting}
          </h1>
          <p className="lede">{c.send.waitingLede}</p>
          <p className="sent-to">
            {c.send.to} <b>Thyme · {shownNumber(code!)}</b>
          </p>
          <span className="code-left">{c.send.left(clock(Date.parse(code!.expiresAt) - now))}</span>
          <div className="verify-help">
            <a className="link-btn" href={appLinkFor(code!.channel, platform, code!.lineNumber, code!.message) ?? "#"}>
              {c.send.reopen}
            </a>
            {switcher}
            {skip(c.link.altPhone)}
          </div>
          {notice}
        </main>
      );
      break;

    case "expired":
      body = (
        <main className="handoff verify">
          <StatusMark state="failed" />
          <h1 ref={heading} tabIndex={-1}>
            {c.link.expired}
          </h1>
          <p className="lede">{c.link.expiredLede}</p>
          <div className="verify-actions">
            <button aria-disabled={busy !== null} className="primary-btn" onClick={() => busy === null && void newCode(channel)} type="button">
              {c.link.again}
            </button>
            <button className="link-btn" onClick={() => toChat(true)} type="button">
              {c.link.skip}
            </button>
          </div>
          {notice}
        </main>
      );
      break;

    case "confirm": {
      const received = status as Extract<ImessageStatus, { state: "received" }>;
      body = (
        <main className="handoff verify">
          <StatusMark state="done" />
          <h1 ref={heading} tabIndex={-1}>
            {c.link.confirmTitle}
          </h1>
          <p className="lede">{c.link.confirmLede}</p>
          <div className="code">
            <span className="code-label">{c.link.sentFrom}</span>
            <span className="code-digits">{received.sender}</span>
            <span className="code-left">{c.link.confirmWithin(clock(Date.parse(received.confirmBy) - now))}</span>
          </div>
          {received.replaces ? (
            <p className="lede small">{replacesText(c, received.replaces)}</p>
          ) : null}
          {received.channel === "whatsapp" ? <p className="lede small">{c.link.optIn}</p> : null}
          {received.channel === "telegram" ? <p className="lede small">{c.link.privacyTelegram}</p> : null}
          <div className="verify-actions">
            <button
              aria-disabled={busy !== null}
              className="primary-btn"
              onClick={() => busy === null && void command("imessage.link.confirm", { linkId: received.linkId })}
              type="button"
            >
              {busy === "imessage.link.confirm" ? c.link.linking : c.link.confirm}
            </button>
            <button
              className="link-btn"
              disabled={busy !== null}
              onClick={async () => {
                if (await command("imessage.link.cancel")) await newCode(received.channel);
              }}
              type="button"
            >
              {c.link.notMe}
            </button>
          </div>
          {notice}
        </main>
      );
      break;
    }

    case "connected": {
      const linked = status as Extract<ImessageStatus, { state: "linked" }>;
      body = (
        <main className="handoff verify">
          <StatusMark state="done" />
          <h1 ref={heading} tabIndex={-1}>
            {c.link.connected}
          </h1>
          <p className="lede">{c.link.connectedLede}</p>
          <p className="sent-to">
            {c.link.linkedTo} <b>{linked.sender}</b>
          </p>
          <div className="verify-actions">
            <button className="primary-btn" onClick={() => toChat(false)} type="button">
              {c.link.goHome}
            </button>
            <button className="link-btn faint" onClick={() => toChat(false)} type="button">
              {c.link.chatWeb}
            </button>
          </div>
        </main>
      );
      break;
    }

    default:
      // No code could be made (for example too many tries): say why and leave the way to the web chat.
      body = (
        <main className="handoff">
          <h1 ref={heading} tabIndex={-1}>
            {c.link.heading}
          </h1>
          {notice}
          <div className="verify-actions" style={{ alignItems: "flex-start" }}>
            <button aria-disabled={busy !== null} className="primary-btn" onClick={() => busy === null && void newCode(channel)} type="button">
              {c.send.newCode}
            </button>
          </div>
          <p className="alt">{skip(phone ? c.link.altPhone : c.link.altDesktop)}</p>
        </main>
      );
  }

  return (
    <InkStage locale={locale}>
      <div className="inner" data-screen="imessage-link">
        <header className="top">
          <Brand />
          <LanguageSelect locale={locale} />
        </header>
        {body}
      </div>
    </InkStage>
  );
}
