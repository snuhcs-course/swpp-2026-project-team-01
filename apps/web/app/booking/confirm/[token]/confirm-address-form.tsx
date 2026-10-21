"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// **Confirm this address** (design decision 6). Opening the email's link only
// shows this button; the press posts the token to /api/contact-confirmations,
// so a mail scanner that fetches the link confirms nothing.

type Phase = "idle" | "confirming" | "confirmed" | "unavailable" | "failed";

export function ConfirmAddressForm({ token }: { readonly token: string }) {
  const [phase, setPhase] = useState<Phase>("idle");

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase("confirming");

    try {
      const response = await fetch("/api/contact-confirmations", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (response.ok) setPhase("confirmed");
      else if (response.status === 404) setPhase("unavailable");
      else throw new Error("unavailable");
    } catch {
      setPhase("failed");
    }
  }

  if (phase === "confirmed") {
    return (
      <section aria-labelledby="confirm-title" className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-tight" id="confirm-title" tabIndex={-1}>
          Address confirmed
        </h1>
        <p role="status">Thanks. Your email address is confirmed for this meeting request. You can close this page.</p>
        <p className="text-muted-foreground text-sm">To continue the request, open the booking link from the same email.</p>
      </section>
    );
  }

  if (phase === "unavailable") {
    return (
      <section aria-labelledby="confirm-title" className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-tight" id="confirm-title">
          This confirmation link is not available
        </h1>
        <p role="status">
          It may have been used already, or a newer email replaced it. Use the latest email we sent, or open your booking
          link to send a new one.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="confirm-title" className="flex flex-col gap-3">
      <h1 className="font-display text-3xl leading-tight" id="confirm-title">
        Confirm your address
      </h1>
      <p>Confirm that this email address belongs to you for this meeting request.</p>
      <form onSubmit={confirm}>
        <Button className="min-h-11" disabled={phase === "confirming"} type="submit">
          Confirm this address
        </Button>
      </form>
      <div aria-live="polite" className="text-sm" role="status">
        {phase === "confirming" ? (
          <p>Confirming...</p>
        ) : phase === "failed" ? (
          <p className="text-destructive">That did not go through. Try again in a moment.</p>
        ) : null}
      </div>
    </section>
  );
}
