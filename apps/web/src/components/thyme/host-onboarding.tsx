// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17, 2026-10-18
"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HostChatView } from "@/contracts/host-chat";
import type { PhoneLink } from "@/contracts/phone-link";
import type { Locale } from "@/contracts/profile";
import { useCalendarImport } from "./calendar-import";
import { COPY } from "./copy";
import { HostChat } from "./host-chat";
import { demoLinker, serverLinker } from "./phone-link";
import { PhoneStep, type SubmitPhone } from "./phone-step";
import { VerifyStep } from "./verify-step";

/** What the host page knows about the signed-in host when it opens. */
export type HostSetup = {
  locale: Locale;
  name: string;
  demo: boolean;
  hasProfile: boolean;
  /** The iMessage start already dealt with the number: it was checked, or put off. */
  phoneDone: boolean;
  /** Demo only: the landing's Calendar box was checked, so attach the example calendar. */
  attachExampleCalendar: boolean;
};

// The host page after sign-in: phone number, then the number check, then home (/home) or the web chat.
// These are states of /app, not separate routes. Before a number is in, the host can skip to the web chat;
// after that the chat opens only once the number is checked or the phone is put off.
// A host who already confirmed a profile, or came from the iMessage start, opens on the chat.
type Step = "phone" | "verify" | "chat";

export function HostOnboarding({ host, chat }: { host: HostSetup; chat: HostChatView }) {
  const router = useRouter();
  const t = COPY[host.locale].verify;
  // The calendar comes in while the host is on the number step; a refresh then brings the chat up to date.
  useCalendarImport(host.attachExampleCalendar, useCallback(() => router.refresh(), [router]));
  const linker = useMemo(() => (host.demo ? demoLinker() : serverLinker), [host.demo]);
  const [step, setStep] = useState<Step>(host.hasProfile || host.phoneDone ? "chat" : "phone");
  const [link, setLink] = useState<PhoneLink | null>(null);

  function go(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  const submit: SubmitPhone = async (phone) => {
    const r = await linker.start(phone.e164);
    if (!r.ok) return r.kind;
    setLink(r.view);
    go("verify");
    return null;
  };

  if (step === "phone") return <PhoneStep locale={host.locale} onSubmit={submit} onSkip={() => go("chat")} />;
  if (step === "verify" && link) {
    const toChat = <button className="primary-btn" type="button" onClick={() => go("chat")}>{t.webChat}</button>;
    return (
      <VerifyStep
        locale={host.locale} linker={linker} initial={link} onBack={() => go("phone")}
        verified={{
          lede: t.connectedLede,
          action: (
            <div className="verify-actions">
              <button className="primary-btn" type="button" onClick={() => location.assign("/home")}>{t.goHome}</button>
              <button className="link-btn faint" type="button" onClick={() => go("chat")}>{t.chatWeb}</button>
            </div>
          ),
        }}
        later={toChat} notifyBy={["sms", "email"]}
      />
    );
  }
  return <HostChat host={host} initial={chat} />;
}
