// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "@/contracts/profile";
import { Brand } from "./brand";
import { COPY } from "./copy";
import { LanguageSelect } from "./language-select";
import { COUNTRY_CODES, type CountryCode, PLACEHOLDER, nationalDigits, reformat, validLocal } from "./phone";

// After sign-in: where should Thyme text you. Skipping the number opens the web chat instead.
export function PhoneStep({ locale, onSubmit, onSkip }: { locale: Locale; onSubmit: (phone: string) => void; onSkip: () => void }) {
  const t = COPY[locale].phone;
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [cc, setCc] = useState<CountryCode>("+82");
  const [value, setValue] = useState("");
  // which message to show, kept as a kind so it follows a language change
  const [error, setError] = useState<"" | "errorKr" | "errorOther">("");
  const caret = useRef<number | null>(null);

  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  // Put the caret back after React writes the reformatted value.
  useLayoutEffect(() => {
    if (caret.current !== null && document.activeElement === input.current) input.current!.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  function onInput(event: React.ChangeEvent<HTMLInputElement>) {
    const next = reformat(cc, event.target.value, event.target.selectionStart ?? event.target.value.length);
    caret.current = next.caret;
    setValue(next.value);
    setError("");
  }
  function onCountry(event: React.ChangeEvent<HTMLSelectElement>) {
    const code = event.target.value as CountryCode;
    setCc(code);
    setValue(reformat(code, value, value.length).value);
    setError("");
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validLocal(cc, nationalDigits(cc, value))) {
      setError(cc === "+82" ? "errorKr" : "errorOther");
      input.current?.focus();
      return;
    }
    onSubmit(`${cc} ${value}`);
  }

  return (
    <div className="inner" data-screen="phone">
      <header className="top">
        <Brand />
        <LanguageSelect locale={locale} />
      </header>
      <main className="handoff">
        <h1 ref={heading} tabIndex={-1}>{t.heading}</h1>
        <p className="lede small">{t.lede}</p>
        <form className="phone-form" noValidate onSubmit={submit}>
          <label htmlFor="phone-input">{t.label}</label>
          <div className="field-row">
            <div className="phone-field">
              <label className="sr-only" htmlFor="phone-cc">{t.country}</label>
              <select id="phone-cc" autoComplete="tel-country-code" value={cc} onChange={onCountry}>
                {COUNTRY_CODES.map((c) => <option value={c.code} key={c.code}>{c.label}</option>)}
              </select>
              <input
                id="phone-input" ref={input} type="tel" inputMode="tel" autoComplete="tel-national"
                placeholder={PLACEHOLDER[cc] ?? ""} value={value} onChange={onInput}
                aria-describedby="phone-help" aria-invalid={error ? "true" : "false"}
              />
            </div>
            <button className="primary-btn" type="submit">{t.submit}</button>
          </div>
          <p className={error ? "field-help error" : "field-help"} id="phone-help" role={error ? "alert" : "status"}>{error ? t[error] : t.help}</p>
        </form>
        <p className="fine">{t.fine}</p>
        <p className="alt">{t.alt} <button className="link-btn" type="button" onClick={onSkip}>{t.skip}</button></p>
      </main>
    </div>
  );
}
