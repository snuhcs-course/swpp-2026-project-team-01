// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useEffect, useRef } from "react";
import type { Locale } from "@/contracts/profile";
import { Brand } from "./brand";
import { COPY } from "./copy";
import { LanguageSelect } from "./language-select";
import { Tick } from "./icons";
import { maskNumber } from "./phone";

// The text is on its way: one check, the message, and a quiet way to stay on the web.
export function SentStep({ locale, phone, onContinue }: { locale: Locale; phone: string; onContinue: () => void }) {
  const t = COPY[locale].sent;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  return (
    <div className="inner" data-screen="sent">
      <header className="top">
        <Brand />
        <LanguageSelect locale={locale} />
      </header>
      <main className="handoff sent">
        <Tick />
        <h1 ref={heading} tabIndex={-1}>{t.heading}</h1>
        <p className="lede">{t.lede}</p>
        <p className="sent-to">{t.sentTo} <span>{maskNumber(phone)}</span></p>
        <button className="link-btn faint" type="button" onClick={onContinue}>{t.web}</button>
      </main>
    </div>
  );
}
