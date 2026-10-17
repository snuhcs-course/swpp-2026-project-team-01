// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17, 2026-10-18
"use client";

import { useState, type ReactNode } from "react";
import { z } from "zod";
import { request } from "@/components/api";
import type { Copy } from "./copy";
import { GoogleLogo } from "./icons";

// Sign-in always returns to the host page. With the Calendar box checked, the same Google consent also grants
// Calendar access, and the host page imports the calendar in the background.
// Demo mode has no Google sign-in: it goes straight there, `?calendar=1` asks for the example calendar and
// `?phone=1` says the iMessage start already dealt with the number.
async function start(calendar: boolean, direct: boolean, phoneDone = false): Promise<string | null> {
  if (direct) {
    const query = new URLSearchParams([...(calendar ? [["calendar", "1"]] : []), ...(phoneDone ? [["phone", "1"]] : [])]).toString();
    location.assign(query ? `/app?${query}` : "/app");
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
  return <GoogleLink className="signin" direct={direct}>{copy.signIn}</GoogleLink>;
}

/** A plain link into Google sign-in, for places that offer it on the side. */
export function GoogleLink({ direct, calendar = false, phoneDone = false, className, children }: {
  direct: boolean; calendar?: boolean; phoneDone?: boolean; className: string; children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <a className={className} href="/app" aria-disabled={busy} onClick={(event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      void start(calendar, direct, phoneDone).then((error) => { if (error) setBusy(false); });
    }}>{children}</a>
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
