// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16
"use client";

import { useEffect, useRef } from "react";
import { Brand } from "./brand";
import { Tick } from "./icons";
import { maskNumber } from "./phone";

// The text is on its way: one check, the message, and a quiet way to stay on the web.
export function SentStep({ phone, onContinue }: { phone: string; onContinue: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  return (
    <div className="inner" data-screen="sent">
      <header className="top">
        <Brand />
      </header>
      <main className="handoff sent">
        <Tick />
        <h1 ref={heading} tabIndex={-1}>Thyme just texted you.</h1>
        <p className="lede">Reply to that message to finish setup. You can close this window. All you need is your phone.</p>
        <p className="sent-to">Sent to <span>{maskNumber(phone)}</span></p>
        <button className="link-btn faint" type="button" onClick={onContinue}>Or continue on the web</button>
      </main>
    </div>
  );
}
