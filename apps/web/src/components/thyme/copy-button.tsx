// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16
"use client";

import { useEffect, useRef, useState } from "react";
import { CopyIcon } from "./icons";

// Copies `text`. When the clipboard is refused, it selects `fallbackTarget` so the person can copy it themselves.
export function CopyButton({ text, className, fallbackTarget }: {
  text: string;
  className: string;
  fallbackTarget?: React.RefObject<HTMLElement | null>;
}) {
  const [label, setLabel] = useState("Copy");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function show(message: string) {
    setLabel(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel("Copy"), 1600);
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
    show("Select the text");
  }
  function copy() {
    if (!navigator.clipboard?.writeText) return selectFallback();
    navigator.clipboard.writeText(text).then(() => show("Copied"), selectFallback);
  }

  return (
    <button className={className} type="button" onClick={copy}>
      <CopyIcon />
      <span>{label}</span>
    </button>
  );
}
