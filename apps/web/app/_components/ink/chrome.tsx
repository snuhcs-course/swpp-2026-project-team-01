"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { COPY, type Copy, LOCALE_COOKIE, type Locale } from "./copy";
import { Check, CopyIcon, GlobeIcon } from "./icons";
import "./ink.css";

// The ink screens' frame and the controls they share (from the landing redesign's brand.tsx,
// language-select.tsx and copy-button.tsx): the stage that scopes ink.css, the wordmark, the
// language menu and the copy button.

export function InkStage({ children, locale }: { readonly children: ReactNode; readonly locale: Locale }) {
  return (
    <div className="ink" lang={locale}>
      {children}
    </div>
  );
}

export function Brand() {
  return (
    <Link aria-label="Home" className="brand" href="/">
      <span aria-hidden="true" className="mark" />
      <span className="wordmark">Find Me a Time</span>
    </Link>
  );
}

const LANGUAGES: readonly { readonly value: Locale; readonly label: string }[] = [
  { label: "English", value: "en" },
  { label: "한국어", value: "ko" },
];

// A small pill that opens a two-item menu. The choice is the `lang` cookie, and a refresh re-renders the server
// parts in the new language while the page keeps its state. Opening puts focus on the current language;
// arrows move, Escape or a click outside closes.
export function LanguageSelect({ locale }: { readonly locale: Locale }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  function choose(next: Locale) {
    setOpen(false);
    button.current?.focus();
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }

  useEffect(() => {
    if (!open) return;
    items.current[LANGUAGES.findIndex((l) => l.value === locale)]?.focus();
    function onClick(event: MouseEvent) {
      if (!(event.target as Element).closest(".lang")) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const at = items.current.indexOf(document.activeElement as HTMLButtonElement);
      const next = (at + (event.key === "ArrowDown" ? 1 : -1) + LANGUAGES.length) % LANGUAGES.length;
      items.current[next]?.focus();
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, locale]);

  return (
    <div className="lang">
      <button
        aria-controls="lang-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${COPY[locale].language}: ${LANGUAGES.find((l) => l.value === locale)!.label}`}
        className="lang-btn"
        onClick={() => setOpen((o) => !o)}
        ref={button}
        type="button"
      >
        <GlobeIcon />
        <span>{locale.toUpperCase()}</span>
      </button>
      <div className="lang-menu" hidden={!open} id="lang-menu" role="menu">
        {LANGUAGES.map((l, i) => (
          <button
            aria-checked={l.value === locale}
            className="menu-item"
            key={l.value}
            lang={l.value}
            onClick={() => choose(l.value)}
            ref={(el) => {
              items.current[i] = el;
            }}
            role="menuitemradio"
            type="button"
          >
            <span>{l.label}</span>
            {l.value === locale ? <Check /> : null}
          </button>
        ))}
      </div>
    </div>
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
