// AI-generated with Claude Code (claude-opus-5-5), 2026-10-18
"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { PhoneLink } from "@/contracts/phone-link";
import type { Locale } from "@/contracts/profile";
import { COPY } from "./copy";
import { GoogleLink } from "./google-start";
import { GoogleLogo } from "./icons";
import { demoLinker, serverLinker } from "./phone-link";
import { PhoneForm, type SubmitPhone } from "./phone-step";
import { VerifyStep } from "./verify-step";

// The landing that starts from iMessage: the number goes in on the landing itself, and once it is checked
// Thyme carries on in Messages, including the sign-in link. Signing in with Google on this page stays as a
// small link, and becomes the way forward when the phone is put off.
// The landing is rendered on the server; this wraps it and takes over the page once a number is in.

const Submit = createContext<SubmitPhone | null>(null);

export function ImessageStart({ locale, direct, children }: { locale: Locale; direct: boolean; children: ReactNode }) {
  const t = COPY[locale];
  const linker = useMemo(() => (direct ? demoLinker() : serverLinker), [direct]);
  const [link, setLink] = useState<PhoneLink | null>(null);

  const submit: SubmitPhone = async (phone) => {
    const r = await linker.start(phone.e164);
    if (!r.ok) return r.kind;
    setLink(r.view);
    window.scrollTo({ top: 0 });
    return null;
  };

  if (!link) return <Submit.Provider value={submit}>{children}</Submit.Provider>;
  return (
    <VerifyStep
      locale={locale} linker={linker} initial={link} onBack={() => setLink(null)}
      verified={{ lede: t.verify.signInSent, action: <GoogleLink className="link-btn faint" direct={direct} calendar phoneDone>{t.verify.googleHere}</GoogleLink> }}
      later={<GoogleLink className="gbtn" direct={direct} calendar phoneDone><GoogleLogo /><span>{t.landing.google}</span></GoogleLink>}
      // not signed in yet, so there is no email address to write to
      notifyBy={["sms"]}
    />
  );
}

/** The landing's start block for the iMessage landing: the number field, and Google for people without iMessage. */
export function PhoneStart({ locale, direct }: { locale: Locale; direct: boolean }) {
  const t = COPY[locale];
  const submit = useContext(Submit);
  if (!submit) throw new Error("PhoneStart belongs inside ImessageStart");
  return (
    <>
      <PhoneForm locale={locale} onSubmit={submit} />
      <p className="fine">{t.phone.fine}</p>
      <p className="alt">{t.landing.noImessage} <GoogleLink className="link-btn" direct={direct} calendar>{t.landing.google}</GoogleLink></p>
    </>
  );
}
