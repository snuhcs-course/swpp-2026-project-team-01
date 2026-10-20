"use client";

import type { PhoneLink } from "@lib/contracts/phone-link";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { phoneLinker } from "./phone-client";
import { PhoneStep, type SubmitPhone } from "./phone-step";
import { VerifyStep } from "./verify-step";

// The host page after sign-in: phone number, then the number check, then the web
// chat. These are states of /app, not separate routes. Before a number is in, the
// host can skip to the web chat; after that the chat opens once the number is
// checked or the phone is put off. The page skips the gate for a host who is
// ready or already linked, and when the phone check is not configured.
type Step = "phone" | "verify" | "chat";

export function PhoneGate({ children, initial }: { readonly children: ReactNode; readonly initial: PhoneLink | null }) {
  const [link, setLink] = useState<PhoneLink | null>(initial);
  const [step, setStep] = useState<Step>(initial ? "verify" : "phone");

  function go(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  const submit: SubmitPhone = async (phone) => {
    const r = await phoneLinker.start(phone);
    if (!r.ok) return r.kind;
    setLink(r.view);
    go("verify");
    return null;
  };

  if (step === "phone") return <PhoneStep onSkip={() => go("chat")} onSubmit={submit} />;

  if (step === "verify" && link) {
    const toChat = (
      <Button onClick={() => go("chat")} type="button">
        Continue in web chat
      </Button>
    );

    return (
      <VerifyStep
        initial={link}
        later={toChat}
        linker={phoneLinker}
        notifyBy={["sms", "email"]}
        onBack={() => go("phone")}
        verified={{ action: toChat, lede: "Thyme will text your meeting updates to this number." }}
      />
    );
  }

  return <>{children}</>;
}
