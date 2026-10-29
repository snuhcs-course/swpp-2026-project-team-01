"use client";

import { deepLinkFor, type ImessageOperation, type ImessageStatus } from "@lib/contracts/imessage";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { readStatus, rememberedLater, rememberLater, sendCommand } from "@/app/_components/imessage/imessage-card";
import { Brand, InkStage, LanguageSelect } from "./chrome";
import { COPY, type Locale } from "./copy";
import { ExternalIcon, MessagesGlyph, StatusMark } from "./icons";
import { clock, isPhone, MessagePreview, type SendCode, SendPanel, useNow, usePlatform } from "./send";

// The /app link step (H11, D15, D16): right after Google sign-in, in place of the phone number the landing
// redesign asked for, a host who has not linked iMessage sends Thyme one message. The step opens with a link
// code already made. On a phone, Open Messages is a plain link the tap follows, and the screen then waits; on a
// computer the send panel shows the QR code, this Mac's Messages and Copy. The message arriving shows the
// masked sender for Confirm and link; an attempt carried over from the iMessage start on the landing shows here
// the same way. A code that ran out shows Time's up with a new one a tap away. The step shows when a message
// has arrived for the host to confirm, or, unless this browser chose Set up here in web chat (Maybe later,
// remembered as the Connect iMessage card does), when a code is waiting or the host is not ready and has none.
// Its words follow the `lang` cookie.

const POLL_MS = 2000;

export function LinkStep({ children, locale, ready }: { readonly children: ReactNode; readonly locale: Locale; readonly ready: boolean }) {
  const t = COPY[locale];
  const platform = usePlatform();
  const phone = isPhone(platform);
  const [shown, setShown] = useState<"loading" | "step" | "chat">("loading");
  const [status, setStatus] = useState<ImessageStatus | null>(null);
  // The latest code, kept after the server stops showing it so the screen can say it ran out.
  const [code, setCode] = useState<SendCode | null>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState<ImessageOperation | null>(null);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const now = useNow(shown === "step");

  const take = useCallback((next: ImessageStatus | null | undefined) => {
    if (!next) return;
    setStatus(next);
    if (next.state === "pending") setCode({ expiresAt: next.expiresAt, lineNumber: next.lineNumber, message: next.message });
  }, []);

  const command = useCallback(
    async (operation: ImessageOperation, input: unknown = {}) => {
      setBusy(operation);
      setError("");
      const outcome = await sendCommand({ input, operation, retryKey: crypto.randomUUID() });
      setBusy(null);
      take(outcome.status);
      if (outcome.lost) setError(t.send.lost);
      else if (outcome.error) setError(outcome.error.category === "rate_limited" ? t.send.limited : t.send.error);
      return !outcome.lost && !outcome.error;
    },
    [t, take],
  );

  const newCode = useCallback(async () => {
    setOpened(false);
    await command("imessage.link.create");
  }, [command]);

  // The first read decides whether the step shows, and makes the code when it does. It runs once, so a
  // language change (which re-renders with new words) does not make another code.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const first = await readStatus();
      const later = rememberedLater();
      const show =
        first?.state === "received" || (!later && (first?.state === "pending" || (first?.state === "none" && !ready)));
      if (!first || !show) {
        setShown("chat");
        return;
      }
      take(first);
      setShown("step");
      if (first.state === "none") await command("imessage.link.create");
    })();
  }, [command, ready, take]);

  const state = status?.state;
  useEffect(() => {
    if (shown !== "step" || state !== "pending") return;
    const id = window.setInterval(() => void readStatus().then(take), POLL_MS);
    return () => window.clearInterval(id);
  }, [shown, state, take]);

  const expired = state !== "received" && state !== "linked" && code !== null && Date.parse(code.expiresAt) <= now;
  const screen =
    state === "received" ? "confirm" : state === "linked" ? "connected" : !code ? "nocode" : expired && phone ? "expired" : phone ? (opened ? "waiting" : "send") : "panel";

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
  if (state === "unavailable" || state === "fallback") return <>{children}</>;

  const toChat = (later: boolean) => {
    if (later) rememberLater();
    setShown("chat");
    window.scrollTo({ top: 0 });
  };

  const skip = (alt: string) => (
    <span>
      {alt}{" "}
      <button className="link-btn" onClick={() => toChat(true)} type="button">
        {t.link.skip}
      </button>
    </span>
  );
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
                      {skip(t.link.altDesktop)}
                      <span className="fine" style={{ maxWidth: "64ch" }}>
                        {t.send.fine}
                      </span>
                      {notice}
                    </>
                  }
                  headingRef={heading}
                  labels={t.copy}
                  lede={t.link.lede}
                  locale={locale}
                  now={now}
                  onNewCode={() => void newCode()}
                  pageHeading
                  platform={platform}
                  t={t.send}
                  title={t.link.heading}
                  titleId="connect-h"
                />
              </section>
            </main>
          </div>
        </InkStage>
      );

    case "send": {
      const link = deepLinkFor(platform, code!.lineNumber, code!.message);
      body = (
        <main className="handoff">
          <h1 ref={heading} tabIndex={-1}>
            {t.link.heading}
          </h1>
          <p className="lede small">{t.link.ledePhone}</p>
          <MessagePreview code={code!} t={t.send} />
          <a className="primary-btn wide" href={link ?? "#"} onClick={() => setOpened(true)}>
            <MessagesGlyph />
            {t.send.open}
          </a>
          <p className="opens">
            <ExternalIcon />
            <span>{t.send.opensNote}</span>
          </p>
          {notice}
          <p className="fine">{t.send.fine}</p>
          <p className="alt">{skip(t.link.altPhone)}</p>
        </main>
      );
      break;
    }

    case "waiting":
      body = (
        <main className="handoff verify">
          <StatusMark state="busy" />
          <h1 ref={heading} tabIndex={-1}>
            {t.send.waiting}
          </h1>
          <p className="lede">{t.send.waitingLede}</p>
          <p className="sent-to">
            {t.send.to} <b>Thyme · {code!.lineNumber}</b>
          </p>
          <span className="code-left">{t.send.left(clock(Date.parse(code!.expiresAt) - now))}</span>
          <div className="verify-help">
            <a className="link-btn" href={deepLinkFor(platform, code!.lineNumber, code!.message) ?? "#"}>
              {t.send.reopen}
            </a>
            {skip(t.link.altPhone)}
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
            {t.link.expired}
          </h1>
          <p className="lede">{t.link.expiredLede}</p>
          <div className="verify-actions">
            <button aria-disabled={busy !== null} className="primary-btn" onClick={() => busy === null && void newCode()} type="button">
              {t.link.again}
            </button>
            <button className="link-btn" onClick={() => toChat(true)} type="button">
              {t.link.skip}
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
            {t.link.confirmTitle}
          </h1>
          <p className="lede">{t.link.confirmLede}</p>
          <div className="code">
            <span className="code-label">{t.link.sentFrom}</span>
            <span className="code-digits">{received.sender}</span>
            <span className="code-left">{t.link.confirmWithin(clock(Date.parse(received.confirmBy) - now))}</span>
          </div>
          <div className="verify-actions">
            <button
              aria-disabled={busy !== null}
              className="primary-btn"
              onClick={() => busy === null && void command("imessage.link.confirm", { linkId: received.linkId })}
              type="button"
            >
              {busy === "imessage.link.confirm" ? t.link.linking : t.link.confirm}
            </button>
            <button
              className="link-btn"
              disabled={busy !== null}
              onClick={async () => {
                if (await command("imessage.link.cancel")) await newCode();
              }}
              type="button"
            >
              {t.link.notMe}
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
            {t.link.connected}
          </h1>
          <p className="lede">{t.link.connectedLede}</p>
          <p className="sent-to">
            {t.link.linkedTo} <b>{linked.sender}</b>
          </p>
          <div className="verify-actions">
            <button className="primary-btn" onClick={() => toChat(false)} type="button">
              {t.link.goHome}
            </button>
            <button className="link-btn faint" onClick={() => toChat(false)} type="button">
              {t.link.chatWeb}
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
            {t.link.heading}
          </h1>
          {notice}
          <div className="verify-actions" style={{ alignItems: "flex-start" }}>
            <button aria-disabled={busy !== null} className="primary-btn" onClick={() => busy === null && void newCode()} type="button">
              {t.send.newCode}
            </button>
          </div>
          <p className="alt">{skip(phone ? t.link.altPhone : t.link.altDesktop)}</p>
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
