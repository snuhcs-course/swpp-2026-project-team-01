// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
"use client";

import { useState } from "react";
import { z } from "zod";
import { request } from "@/components/api";
import type { Copy } from "./copy";
import { GoogleLogo } from "./icons";

// Sign-in always returns to the host page. With the Calendar box checked, the same Google consent also grants
// Calendar access, and the host page imports the calendar in the background.
// Demo mode has no Google sign-in: it goes straight there, and `?calendar=1` asks for the example calendar.
async function start(calendar: boolean, direct: boolean): Promise<string | null> {
  if (direct) {
    location.assign(calendar ? "/app?calendar=1" : "/app");
    return null;
  }
  const r = await request("POST", "/api/auth/google/start", z.object({ authorizationUrl: z.string() }), { purpose: "login", returnPath: "/app", calendar });
  if (r.ok) {
    location.assign(r.data.authorizationUrl);
    return null;
  }
  return r.error.message;
}

export function SignInLink({ direct, copy }: { direct: boolean; copy: Copy["landing"] }) {
  const [busy, setBusy] = useState(false);
  return (
    <a className="signin" href="/app" aria-disabled={busy} onClick={(event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      void start(false, direct).then((error) => { if (error) setBusy(false); });
    }}>{copy.signIn}</a>
  );
}

export function GoogleStart({ direct, copy }: { direct: boolean; copy: Copy["landing"] }) {
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
        void start(calendar, direct).then((message) => {
          if (message) { setError(message); setBusy(false); }
        });
      }}>
        <GoogleLogo />
        <span>{copy.google}</span>
      </a>
      <label className="check" htmlFor="cal">
        <input type="checkbox" id="cal" checked={calendar} onChange={(event) => setCalendar(event.target.checked)} />
        <span>{copy.calendar}<small>{copy.calendarNote}</small></span>
      </label>
      {error && <p className="field-help error" role="alert">{error}</p>}
    </>
  );
}
