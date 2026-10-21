"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// **Resend my booking link** (meeting-requests: accessible link resend), for the
// public host page and the booking page's unavailable view. The answer is the
// same for every address, so the form shows only that generic notice. A
// resubmitted address keeps its retry key, so a lost response is an exact retry.

type Phase = "idle" | "sending" | "accepted" | "failed";

const ACCEPTED = "If that address is confirmed for an open request, we will email its booking link shortly.";

export function ResendLinkForm({ heading = "Lost your booking link?" }: { readonly heading?: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<{ email: string; key: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();

    if (!address) {
      setError("Enter the email address you gave for the request.");
      return;
    }

    const retry = retryRef.current?.email === address ? retryRef.current : { email: address, key: crypto.randomUUID() };
    retryRef.current = retry;
    setError(null);
    setPhase("sending");

    try {
      const response = await fetch("/api/booking-links/resend", {
        body: JSON.stringify({ email: address, retryKey: retry.key }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (response.status === 400) {
        setError("Enter a valid email address.");
        setPhase("idle");
        return;
      }

      if (!response.ok) throw new Error("unavailable");

      retryRef.current = null;
      setPhase("accepted");
    } catch {
      setPhase("failed");
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 className="font-medium text-lg" id={`${id}-heading`}>
        {heading}
      </h2>
      <p className="text-muted-foreground text-sm">
        We can email the link again to an address that was confirmed for the request.
      </p>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate onSubmit={submit}>
        <div className="flex flex-1 flex-col gap-1">
          <label className="font-medium text-sm" htmlFor={`${id}-email`}>
            Email address
          </label>
          <Input
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="email"
            className="min-h-11"
            id={`${id}-email`}
            inputMode="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </div>
        <Button className="min-h-11" disabled={phase === "sending"} type="submit">
          Resend my booking link
        </Button>
      </form>
      <div aria-live="polite" className="text-sm" role="status">
        {error ? (
          <p className="text-destructive" id={`${id}-error`}>
            {error}
          </p>
        ) : phase === "sending" ? (
          <p>Sending...</p>
        ) : phase === "accepted" ? (
          <p>{ACCEPTED}</p>
        ) : phase === "failed" ? (
          <p className="text-destructive">That did not go through. Try again in a moment.</p>
        ) : null}
      </div>
    </section>
  );
}
