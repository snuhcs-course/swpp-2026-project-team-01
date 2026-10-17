// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
"use client";

import { useState } from "react";
import { z } from "zod";
import { request } from "@/components/api";
import { GoogleLogo } from "./icons";

// Sign-in returns to the host page, or first to the calendar step when the host asked to connect it there.
// Demo mode has no Google sign-in and a signed-in host needs none, so both go straight to the destination.
async function start(returnPath: string, direct: boolean): Promise<string | null> {
  if (direct) {
    location.assign(returnPath);
    return null;
  }
  const r = await request("POST", "/api/auth/google/start", z.object({ authorizationUrl: z.string() }), { purpose: "login", returnPath });
  if (r.ok) {
    location.assign(r.data.authorizationUrl);
    return null;
  }
  return r.error.message;
}

export function SignInLink({ direct }: { direct: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <a className="signin" href="/app" aria-disabled={busy} onClick={(event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      void start("/app", direct).then((error) => { if (error) setBusy(false); });
    }}>Sign in</a>
  );
}

export function GoogleStart({ direct }: { direct: boolean }) {
  const [calendar, setCalendar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <a className="gbtn" href="/app" aria-disabled={busy} onClick={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        void start(calendar ? "/settings/calendars" : "/app", direct).then((message) => {
          if (message) { setError(message); setBusy(false); }
        });
      }}>
        <GoogleLogo />
        <span>Continue with Google</span>
      </a>
      <label className="check" htmlFor="cal">
        <input type="checkbox" id="cal" checked={calendar} onChange={(event) => setCalendar(event.target.checked)} />
        <span>Connect my Google Calendar too<small>Thyme reads when you&apos;re busy. Nothing is booked until you say OK.</small></span>
      </label>
      {error && <p className="field-help error" role="alert">{error}</p>}
    </>
  );
}
