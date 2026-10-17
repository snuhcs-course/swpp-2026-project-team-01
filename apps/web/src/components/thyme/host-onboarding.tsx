// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { HostChatView } from "@/contracts/host-chat";
import type { Locale } from "@/contracts/profile";
import { useCalendarImport } from "./calendar-import";
import { HostChat } from "./host-chat";
import { PhoneStep } from "./phone-step";
import { SentStep } from "./sent-step";

/** What the host page knows about the signed-in host when it opens. */
export type HostSetup = {
  locale: Locale;
  name: string;
  demo: boolean;
  hasProfile: boolean;
  /** Demo only: the landing's Calendar box was checked, so attach the example calendar. */
  attachExampleCalendar: boolean;
};

// The host page after sign-in: phone number, then the text-sent screen, then the web chat.
// These are states of /app, not separate routes. Nothing is sent yet: the number stays in this page.
// A host who already confirmed a profile has been through the number once and opens on the chat.
type Step = "phone" | "sent" | "chat";

export function HostOnboarding({ host, chat }: { host: HostSetup; chat: HostChatView }) {
  const router = useRouter();
  // The calendar comes in while the host is on the number step; a refresh then brings the chat up to date.
  useCalendarImport(host.attachExampleCalendar, useCallback(() => router.refresh(), [router]));
  const [step, setStep] = useState<Step>(host.hasProfile ? "chat" : "phone");
  // empty when the host chose the web chat instead of giving a number
  const [phone, setPhone] = useState("");

  function go(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  if (step === "phone") {
    return <PhoneStep locale={host.locale} onSubmit={(number) => { setPhone(number); go("sent"); }} onSkip={() => { setPhone(""); go("chat"); }} />;
  }
  if (step === "sent") return <SentStep locale={host.locale} phone={phone} onContinue={() => go("chat")} />;
  return <HostChat host={host} initial={chat} />;
}
