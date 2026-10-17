// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17, 2026-10-18
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "@/contracts/profile";
import { Brand } from "./brand";
import { COPY } from "./copy";
import { LanguageSelect } from "./language-select";
import { COUNTRY_CODES, type CountryCode, PLACEHOLDER, nationalDigits, reformat, validLocal } from "./phone";

export type PhoneEntry = { e164: string; display: string };
/** Resolves to null once the text is on its way, or to why the number was not taken. */
export type SubmitPhone = (phone: PhoneEntry) => Promise<"invalid" | "taken" | "other" | null>;

// After sign-in: where should Thyme text you. Skipping the number opens the web chat instead; once a number
// is in, the web chat opens only after it is checked.
export function PhoneStep({ locale, onSubmit, onSkip }: { locale: Locale; onSubmit: SubmitPhone; onSkip: () => void }) {
  const t = COPY[locale].phone;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  return (
    <div className="inner" data-screen="phone">
      <header className="top">
        <Brand />
        <LanguageSelect locale={locale} />
      </header>
      <main className="handoff">
        <h1 ref={heading} tabIndex={-1}>{t.heading}</h1>
        <p className="lede small">{t.lede}</p>
        <PhoneForm locale={locale} onSubmit={onSubmit} />
        <p className="fine">{t.fine}</p>
        <p className="alt">{t.alt} <button className="link-btn" type="button" onClick={onSkip}>{t.skip}</button></p>
      </main>
    </div>
  );
}

// The number field: country code on its own, hyphens added while typing, sent as E.164.
export function PhoneForm({ locale, onSubmit }: { locale: Locale; onSubmit: SubmitPhone }) {
  const t = COPY[locale].phone;
  const input = useRef<HTMLInputElement>(null);
  const [cc, setCc] = useState<CountryCode>("+82");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // which message to show, kept as a kind so it follows a language change
  const [error, setError] = useState<"" | "errorKr" | "errorOther" | "errorTaken" | "errorServer">("");
  const caret = useRef<number | null>(null);

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
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const digits = nationalDigits(cc, value);
    const wrong = cc === "+82" ? "errorKr" : "errorOther";
    if (!validLocal(cc, digits)) {
      setError(wrong);
      input.current?.focus();
      return;
    }
    setBusy(true);
    const refused = await onSubmit({ e164: `${cc}${digits}`, display: `${cc} ${value}` });
    setBusy(false);
    if (!refused) return;
    setError(refused === "invalid" ? wrong : refused === "taken" ? "errorTaken" : "errorServer");
    input.current?.focus();
  }

  return (
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
        <button className="primary-btn" type="submit" aria-disabled={busy}>{t.submit}</button>
      </div>
      <p className={error ? "field-help error" : "field-help"} id="phone-help" role={error ? "alert" : "status"}>{error ? t[error] : t.help}</p>
    </form>
  );
}
