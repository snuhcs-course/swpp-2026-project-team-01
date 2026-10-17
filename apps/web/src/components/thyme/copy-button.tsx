// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useEffect, useRef, useState } from "react";
import type { Copy } from "./copy";
import { CopyIcon } from "./icons";

// Copies `text`. When the clipboard is refused, it selects `fallbackTarget` so the person can copy it themselves.
export function CopyButton({ text, className, labels, fallbackTarget }: {
  text: string;
  className: string;
  labels: Copy["copy"];
  fallbackTarget?: React.RefObject<HTMLElement | null>;
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
    <button className={className} type="button" onClick={copy}>
      <CopyIcon />
      <span>{labels[shown]}</span>
    </button>
  );
}
