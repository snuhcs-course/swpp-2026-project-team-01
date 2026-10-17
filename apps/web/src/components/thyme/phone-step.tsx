// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { COUNTRY_CODES, type CountryCode, PLACEHOLDER, nationalDigits, reformat, validLocal } from "./phone";

const HELP = "Hyphens are added for you.";

// After sign-in: where should Thyme text you. Skipping the number opens the web chat instead.
export function PhoneStep({ onSubmit, onSkip }: { onSubmit: (phone: string) => void; onSkip: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [cc, setCc] = useState<CountryCode>("+82");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
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
      setError(cc === "+82" ? "Enter a mobile number like 10-1234-5678." : "Check the number. It looks incomplete.");
      input.current?.focus();
      return;
    }
    onSubmit(`${cc} ${value}`);
  }

  return (
    <div className="inner" data-screen="phone">
      <header className="top">
        <Brand />
      </header>
      <main className="handoff">
        <h1 ref={heading} tabIndex={-1}>Where should Thyme text you?</h1>
        <p className="lede small">Setup continues in your messages, on your phone or your computer. After this, you won&apos;t need this page.</p>
        <form className="phone-form" noValidate onSubmit={submit}>
          <label htmlFor="phone-input">Mobile number</label>
          <div className="field-row">
            <div className="phone-field">
              <label className="sr-only" htmlFor="phone-cc">Country code</label>
              <select id="phone-cc" autoComplete="tel-country-code" value={cc} onChange={onCountry}>
                {COUNTRY_CODES.map((c) => <option value={c.code} key={c.code}>{c.label}</option>)}
              </select>
              <input
                id="phone-input" ref={input} type="tel" inputMode="tel" autoComplete="tel-national"
                placeholder={PLACEHOLDER[cc] ?? ""} value={value} onChange={onInput}
                aria-describedby="phone-help" aria-invalid={error ? "true" : "false"}
              />
            </div>
            <button className="primary-btn" type="submit">Text me</button>
          </div>
          <p className={error ? "field-help error" : "field-help"} id="phone-help" role={error ? "alert" : "status"}>{error || HELP}</p>
        </form>
        <p className="fine">By tapping Text me, you agree to get texts from Thyme about your meetings. Message and data rates may apply. Reply STOP to stop anytime. iMessage only for now.</p>
        <p className="alt">Don&apos;t use iMessage, or prefer not to give a number? <button className="link-btn" type="button" onClick={onSkip}>Set up here in web chat</button></p>
      </main>
    </div>
  );
}
