// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/contracts/profile";
import { COPY, LOCALE_COOKIE } from "./copy";
import { Check, GlobeIcon } from "./icons";

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
];

// A small pill beside the account button (or Sign in) that opens a two-item menu.
// The choice is a cookie, and a refresh re-renders the server parts in the new language while the page keeps
// its state, such as the chat in progress.
export function LanguageSelect({ locale }: { locale: Locale }) {
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

  // Opening puts focus on the current language; arrows move, Escape or a click outside closes.
  useEffect(() => {
    if (!open) return;
    items.current[LANGUAGES.findIndex((l) => l.value === locale)]?.focus();
    function onClick(event: MouseEvent) {
      if (!(event.target as Element).closest(".lang")) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); button.current?.focus(); return; }
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
      <button className="lang-btn" type="button" ref={button} aria-haspopup="menu" aria-expanded={open} aria-controls="lang-menu"
        aria-label={`${COPY[locale].language}: ${LANGUAGES.find((l) => l.value === locale)!.label}`} onClick={() => setOpen((o) => !o)}>
        <GlobeIcon />
        <span>{locale.toUpperCase()}</span>
      </button>
      <div className="lang-menu" id="lang-menu" role="menu" hidden={!open}>
        {LANGUAGES.map((l, i) => (
          <button className="menu-item" type="button" role="menuitemradio" aria-checked={l.value === locale} lang={l.value}
            ref={(el) => { items.current[i] = el; }} key={l.value} onClick={() => choose(l.value)}>
            <span>{l.label}</span>
            {l.value === locale && <Check />}
          </button>
        ))}
      </div>
    </div>
  );
}
