"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The Settings dialog's Delete account card (self-service-account-deletion D2):
// one step at a time, first what deletion does, then the typed confirmation.
// Scheduling signs the host out, so success leaves for the sign-in card's notice.
export function DeleteAccountCard({ handle, focus = false }: { readonly handle: string | null; readonly focus?: boolean }) {
  const [step, setStep] = useState<"closed" | "confirm">(focus ? "confirm" : "closed");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = useRef<HTMLElement>(null);
  const expected = handle ? `@${handle}` : "your Google address";

  useEffect(() => {
    if (focus) card.current?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  async function schedule() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/host/account-deletion", {
        body: JSON.stringify({ confirmation: typed, retryKey: crypto.randomUUID() }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) {
        window.location.assign("/app?deletion=scheduled");
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Your account could not be scheduled for deletion. Try again.");
    } catch {
      setError("Your account could not be scheduled for deletion. Try again.");
    }
    setBusy(false);
  }

  // Closed, it is a quiet link in the dialog's corner, not a card of its own.
  if (step === "closed") {
    return (
      <div className="flex justify-end px-1">
        <button
          className="min-h-11 cursor-pointer text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
          onClick={() => setStep("confirm")}
          type="button"
        >
          Delete account
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Delete account" className="space-y-3 rounded-2xl bg-card p-4 sm:p-5" id="delete-account" ref={card}>
      <h3 className="font-semibold">Delete account</h3>
      <>
          <div className="rounded-2xl bg-[color-mix(in_srgb,var(--destructive)_9%,white)] p-4 text-sm text-destructive">
            <p className="font-semibold">Your account will be deleted in 7 days.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Your settings, requests and their history, conversations and Google connection are deleted, and this cannot be undone.</li>
              <li>Open requests you received are closed and their guests told by email.</li>
              <li>Meetings you host stay in your calendar; cancel any you no longer want first.</li>
              <li>Open requests you sent to other hosts are withdrawn, and meetings you booked with them are cancelled and their hosts told.</li>
              <li>You will be signed out. Signing in again within 7 days cancels the deletion.</li>
            </ul>
          </div>
          <div>
            <label className="font-medium" htmlFor="delete-account-confirmation">
              Type {expected} to confirm
            </label>
            <Input
              aria-describedby={error ? "delete-account-error" : undefined}
              aria-invalid={error ? true : undefined}
              autoCapitalize="none"
              autoComplete="off"
              autoFocus={focus}
              className="mt-2 bg-card"
              disabled={busy}
              id="delete-account-confirmation"
              maxLength={320}
              onChange={(event) => setTyped(event.target.value)}
              spellCheck={false}
              value={typed}
            />
            {error ? (
              <p className="mt-1 text-sm text-destructive" id="delete-account-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || typed.trim() === ""} onClick={() => void schedule()} type="button" variant="destructive">
              {busy ? "Scheduling…" : "Delete my account"}
            </Button>
            <Button disabled={busy} onClick={() => { setStep("closed"); setTyped(""); setError(""); }} type="button" variant="outline">
              Keep my account
            </Button>
          </div>
      </>
    </section>
  );
}
