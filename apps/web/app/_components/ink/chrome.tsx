"use client";

import Link from "next/link";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { type Copy, type Locale } from "./copy";
import { CopyIcon } from "./icons";
import "./ink.css";

// The ink screens' frame and shared controls: the stage that scopes ink.css, the wordmark and copy button.

export function InkStage({ children, locale }: { readonly children: ReactNode; readonly locale: Locale }) {
  return (
    <div className="ink" lang={locale}>
      {children}
    </div>
  );
}

// The logo leads to the public landing; on a signed-in host's screens it leads
// to the workspace at /app instead.
export function Brand({ href = "/" }: { readonly href?: "/" | "/app" }) {
  return (
    <Link aria-label="Home" className="brand" href={href}>
      <span aria-hidden="true" className="mark" />
      <span className="wordmark">Find Me a Time</span>
    </Link>
  );
}

// Copies `text`. When the clipboard is refused, it selects `fallbackTarget` so the person can copy it themselves.
export function CopyButton({
  className,
  fallbackTarget,
  labels,
  text,
}: {
  readonly className: string;
  readonly fallbackTarget?: RefObject<HTMLElement | null>;
  readonly labels: Copy["copy"];
  readonly text: string;
}) {
  const [shown, setShown] = useState<keyof Copy["copy"]>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function show(message: keyof Copy["copy"]) {
    setShown(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown("idle"), 1600);
  }
  function selectFallback() {
    const el = fallbackTarget?.current;
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    show("fallback");
  }
  function copy() {
    if (!navigator.clipboard?.writeText) return selectFallback();
    navigator.clipboard.writeText(text).then(() => show("done"), selectFallback);
  }

  return (
    <button className={className} onClick={copy} type="button">
      <CopyIcon />
      <span>{labels[shown]}</span>
    </button>
  );
}
