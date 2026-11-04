"use client";

import { type ChangeEvent, type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { COUNTRY_CODES, type CountryCode, nationalDigits, PLACEHOLDER, reformat, validLocal } from "./phone";

// The number field asked before an iMessage link code (imessage-number-registration D1, D3): Photon's shared
// lines take messages only from numbers registered first, so each start asks for the number, the server
// registers it, and the existing link message follows. The form is the landing redesign's phone field
// (feat/web-language-switch d3ca3be8, components/thyme/phone-step.tsx): the country code on its own, hyphens
// added while typing, sent as E.164. `look` picks the ink screens' classes or the conversation cards' (PR #23's
// phone-step.tsx, fd429eeb).

export type NumberCopy = {
  readonly label: string;
  readonly country: string;
  readonly help: string;
  readonly errorKr: string;
  readonly errorOther: string;
  readonly errorServer: string;
  readonly submit: string;
};

// Resolves to null once the number was taken, or to why it was not.
export type SubmitNumber = (e164: string) => Promise<"invalid" | "other" | null>;

const CARD_FIELD =
  "min-h-11 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function NumberForm({
  id,
  look,
  onSubmit,
  t,
}: {
  // Prefixes the field IDs, so two forms never share one.
  readonly id: string;
  readonly look: "ink" | "card";
  readonly onSubmit: SubmitNumber;
  readonly t: NumberCopy;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [cc, setCc] = useState<CountryCode>("+82");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // Which message to show, kept as a kind so it follows a language change.
  const [error, setError] = useState<"" | "errorKr" | "errorOther" | "errorServer">("");
  const caret = useRef<number | null>(null);
  const ink = look === "ink";

  // Put the caret back after React writes the reformatted value.
  useLayoutEffect(() => {
    if (caret.current !== null && document.activeElement === input.current) input.current!.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    const next = reformat(cc, event.target.value, event.target.selectionStart ?? event.target.value.length);
    caret.current = next.caret;
    setValue(next.value);
    setError("");
  }

  function onCountry(event: ChangeEvent<HTMLSelectElement>) {
    const code = event.target.value as CountryCode;
    setCc(code);
    setValue(reformat(code, value, value.length).value);
    setError("");
  }

  async function submit(event: FormEvent) {
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
    const refused = await onSubmit(`${cc}${digits}`);
    setBusy(false);
    if (!refused) return;
    setError(refused === "invalid" ? wrong : "errorServer");
    input.current?.focus();
  }

  const select = (
    <select autoComplete="tel-country-code" className={ink ? undefined : CARD_FIELD} id={`${id}-cc`} onChange={onCountry} value={cc}>
      {COUNTRY_CODES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  );
  const field = (
    <input
      aria-describedby={`${id}-help`}
      aria-invalid={error ? "true" : "false"}
      autoComplete="tel-national"
      className={ink ? undefined : cn(CARD_FIELD, "min-w-40 flex-1 aria-invalid:border-destructive")}
      id={`${id}-input`}
      inputMode="tel"
      onChange={onInput}
      placeholder={PLACEHOLDER[cc] ?? ""}
      ref={input}
      type="tel"
      value={value}
    />
  );
  const button = (
    <button
      aria-disabled={busy}
      className={
        ink
          ? "primary-btn"
          : "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover aria-disabled:opacity-50 sm:w-auto"
      }
      type="submit"
    >
      {t.submit}
    </button>
  );

  return (
    <form className={ink ? "phone-form" : "flex flex-col gap-2"} noValidate onSubmit={submit}>
      <label className={ink ? undefined : "text-sm font-medium"} htmlFor={`${id}-input`}>
        {t.label}
      </label>
      <div className={ink ? "field-row" : "flex flex-wrap gap-2"}>
        {ink ? (
          <div className="phone-field">
            <label className="sr-only" htmlFor={`${id}-cc`}>
              {t.country}
            </label>
            {select}
            {field}
          </div>
        ) : (
          <>
            <label className="sr-only" htmlFor={`${id}-cc`}>
              {t.country}
            </label>
            {select}
            {field}
          </>
        )}
        {button}
      </div>
      <p
        className={ink ? (error ? "field-help error" : "field-help") : error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        id={`${id}-help`}
        role={error ? "alert" : "status"}
      >
        {error ? t[error] : t.help}
      </p>
    </form>
  );
}
