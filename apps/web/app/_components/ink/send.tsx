"use client";

import { deepLinkFor, type MessagesPlatform, messagesPlatform, qrDeepLink } from "@lib/contracts/imessage";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { CopyButton } from "./chrome";
import type { Copy } from "./copy";
import { CloseIcon, MessagesGlyph } from "./icons";

// The send-a-message panel (the "iMessage 연결 화면 시안" canvas): the message as Messages will show it, then
// the ways to send it from here: the iPhone's camera (a QR code of the same sms: deep link), this Mac's
// Messages (shown on a Mac only) and copying the number and the text. It shows how long the code works and,
// once it ran out, the same panel greyed out with Make a new code. The landing shows it as a popup over the
// page; /app shows it in the page.

export type SendCode = { readonly lineNumber: string; readonly message: string; readonly expiresAt: string };

export function usePlatform(): MessagesPlatform {
  const [platform, setPlatform] = useState<MessagesPlatform>("other");
  useEffect(() => setPlatform(messagesPlatform(navigator.userAgent, navigator.maxTouchPoints)), []);
  return platform;
}

export const isPhone = (platform: MessagesPlatform) => platform === "ios" || platform === "android";

// The clock, ticking once a second while `on`.
export function useNow(on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const timeOf = (iso: string, locale: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

export function MessagePreview({ code, gone, t }: { readonly code: SendCode; readonly gone?: boolean; readonly t: Copy["send"] }) {
  return (
    <div className={gone ? "preview gone" : "preview"}>
      <div className="preview-to">
        <span>{t.to}</span>
        <b>Thyme · {code.lineNumber}</b>
      </div>
      <div className="preview-body">
        <p className="blue" data-testid="imessage-link-message">
          {code.message}
        </p>
      </div>
    </div>
  );
}

function Qr({ code, gone, label, mark }: { readonly code: SendCode; readonly gone: boolean; readonly label: string; readonly mark: string }) {
  const svg = useMemo(() => renderSVG(qrDeepLink(code.lineNumber, code.message), { border: 1 }), [code.lineNumber, code.message]);
  return (
    <div className={gone ? "qr gone" : "qr"}>
      <div
        aria-label={gone ? undefined : label}
        data-testid="imessage-qr"
        // The SVG is generated locally from the line number and the message.
        dangerouslySetInnerHTML={{ __html: svg }}
        role={gone ? undefined : "img"}
        style={{ height: "100%", width: "100%" }}
      />
      {gone ? <span className="qr-over">{mark}</span> : null}
    </div>
  );
}

function Ways({ code, gone, labels, mac, t }: { readonly code: SendCode; readonly gone: boolean; readonly labels: Copy["copy"]; readonly mac: boolean; readonly t: Copy["send"] }) {
  const numberRef = useRef<HTMLSpanElement>(null);
  const messageRef = useRef<HTMLSpanElement>(null);
  const link = deepLinkFor("mac", code.lineNumber, code.message);
  const way = gone ? "way gone" : "way";
  return (
    <div className={mac ? "ways" : "ways two"}>
      <section className={way}>
        <span className="way-tag">{t.qrTag}</span>
        <h3>{t.qrTitle}</h3>
        {gone ? null : <p>{t.qrBody}</p>}
        <div className="soft">
          <Qr code={code} gone={gone} label={t.qrAlt} mark={t.expiredMark} />
        </div>
      </section>
      {mac ? (
        <section className={way}>
          <span className="way-tag">{t.macTag}</span>
          <h3>{t.macTitle}</h3>
          {gone ? null : <p>{t.macBody}</p>}
          <div className="soft roomy">
            {gone || !link ? (
              <button className="primary-btn" disabled type="button">
                <MessagesGlyph />
                {t.open}
              </button>
            ) : (
              <a className="primary-btn" href={link}>
                <MessagesGlyph />
                {t.open}
              </a>
            )}
          </div>
        </section>
      ) : null}
      <section className={way}>
        <span className="way-tag">{t.copyTag}</span>
        <h3>{t.copyTitle}</h3>
        {gone ? null : <p>{t.copyBody}</p>}
        {gone ? null : (
          <div className="copyrow">
            <span className="val" ref={numberRef}>
              {code.lineNumber}
            </span>
            <CopyButton className="copy" fallbackTarget={numberRef} labels={labels} text={code.lineNumber} />
          </div>
        )}
        <div className="copyrow">
          <span className="val" ref={messageRef}>
            {code.message}
          </span>
          {gone ? null : <CopyButton className="copy" fallbackTarget={messageRef} labels={labels} text={code.message} />}
        </div>
      </section>
    </div>
  );
}

// The panel itself. `heading` gets focus when the panel opens or the code runs out, so a screen reader hears it.
export function SendPanel({
  busy,
  code,
  foot,
  headingRef,
  labels,
  lede,
  locale,
  now,
  onClose,
  onNewCode,
  pageHeading = false,
  platform,
  t,
  title,
  titleId,
}: {
  readonly busy: boolean;
  readonly code: SendCode;
  readonly foot: ReactNode;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly labels: Copy["copy"];
  readonly lede: string;
  readonly locale: string;
  readonly now: number;
  readonly onClose?: () => void;
  readonly onNewCode: () => void;
  // In the /app page the panel's title is the page's heading.
  readonly pageHeading?: boolean;
  readonly platform: MessagesPlatform;
  readonly t: Copy["send"];
  readonly title: string;
  readonly titleId: string;
}) {
  const left = Date.parse(code.expiresAt) - now;
  const gone = left <= 0;
  const Heading = pageHeading ? "h1" : "h2";

  return (
    <>
      {onClose ? (
        <button aria-label={t.close} className="modal-close" onClick={onClose} type="button">
          <CloseIcon />
        </button>
      ) : null}
      <Heading id={titleId} ref={headingRef} tabIndex={-1}>
        {gone ? t.expiredTitle : title}
      </Heading>
      <p>{gone ? t.expiredLede : lede}</p>
      {gone ? (
        <span className="count over" role="status">
          {t.expiredAt(timeOf(code.expiresAt, locale))}
        </span>
      ) : (
        <span className="count" role="status">
          <span aria-hidden="true" className="spin" />
          {t.waitingFor(clock(left))}
        </span>
      )}
      {gone ? (
        <button aria-disabled={busy} className="primary-btn" onClick={() => !busy && onNewCode()} type="button">
          {t.newCode}
        </button>
      ) : null}
      <MessagePreview code={code} gone={gone} t={t} />
      <Ways code={code} gone={gone} labels={labels} mac={platform === "mac"} t={t} />
      <div className="modal-foot">{foot}</div>
    </>
  );
}
