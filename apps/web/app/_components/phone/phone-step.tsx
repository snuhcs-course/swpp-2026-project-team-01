"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { COUNTRY_CODES, type CountryCode, nationalDigits, PLACEHOLDER, reformat, validLocal } from "./phone-number";

/** Resolves to null once the text is on its way, or to why the number was not taken. */
export type SubmitPhone = (e164: string) => Promise<"invalid" | "taken" | "other" | null>;

const COPY = {
  alt: "On Android, or no iMessage? Prefer not to give a number?",
  country: "Country code",
  errorKr: "Enter a mobile number like 10-1234-5678.",
  errorOther: "Check the number. It looks incomplete.",
  errorServer: "Couldn't reach Thyme. Try again in a moment.",
  errorTaken: "This number is already in use.",
  fine: "By tapping Text me, you agree to get texts from Thyme about your meetings. Message and data rates may apply. iMessage only for now.",
  heading: "Where should Thyme text you on iMessage?",
  help: "Hyphens are added for you.",
  label: "Mobile number",
  lede: "Thyme sends your meeting updates to iMessage. A quick reply checks that the number is yours.",
  skip: "Set up here in web chat",
  submit: "Text me",
} as const;

type ErrorKind = "" | "errorKr" | "errorOther" | "errorTaken" | "errorServer";

// After sign-in: where should Thyme text you. Skipping the number opens the web
// chat instead; once a number is in, the host moves on only after it is checked
// or put off.
export function PhoneStep({ onSubmit, onSkip }: { readonly onSubmit: SubmitPhone; readonly onSkip: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4" data-screen="phone">
      <div>
        <h1 className="font-display text-3xl outline-none" ref={heading} tabIndex={-1}>
          {COPY.heading}
        </h1>
        <p className="mt-2 text-muted-foreground">{COPY.lede}</p>
      </div>
      <PhoneForm onSubmit={onSubmit} />
      <p className="text-sm text-muted-foreground">{COPY.fine}</p>
      <p className="text-sm">
        {COPY.alt}{" "}
        <Button className="h-auto p-0" onClick={onSkip} type="button" variant="link">
          {COPY.skip}
        </Button>
      </p>
    </main>
  );
}

// The number field: country code on its own, hyphens added while typing, sent as E.164.
function PhoneForm({ onSubmit }: { readonly onSubmit: SubmitPhone }) {
  const input = useRef<HTMLInputElement>(null);
  const [cc, setCc] = useState<CountryCode>("+82");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKind>("");
  const caret = useRef<number | null>(null);

  // Put the caret back after React writes the reformatted value.
  useLayoutEffect(() => {
    if (caret.current !== null && document.activeElement === input.current) {
      input.current!.setSelectionRange(caret.current, caret.current);
    }
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
    const refused = await onSubmit(`${cc}${digits}`);
    setBusy(false);
    if (!refused) return;
    setError(refused === "invalid" ? wrong : refused === "taken" ? "errorTaken" : "errorServer");
    input.current?.focus();
  }

  const field =
    "min-h-11 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <form className="flex flex-col gap-2" noValidate onSubmit={submit}>
      <label className="text-sm font-medium" htmlFor="phone-input">
        {COPY.label}
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="phone-cc">
          {COPY.country}
        </label>
        <select autoComplete="tel-country-code" className={field} id="phone-cc" onChange={onCountry} value={cc}>
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          aria-describedby="phone-help"
          aria-invalid={error ? "true" : "false"}
          autoComplete="tel-national"
          className={`${field} min-w-0 flex-1 aria-invalid:border-destructive`}
          id="phone-input"
          inputMode="tel"
          onChange={onInput}
          placeholder={PLACEHOLDER[cc] ?? ""}
          ref={input}
          type="tel"
          value={value}
        />
        <Button aria-disabled={busy} type="submit">
          {COPY.submit}
        </Button>
      </div>
      <p
        className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        id="phone-help"
        role={error ? "alert" : "status"}
      >
        {error ? COPY[error] : COPY.help}
      </p>
    </form>
  );
}
