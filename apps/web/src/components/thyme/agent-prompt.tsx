// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16
"use client";

import { useRef } from "react";
import { CopyButton } from "./copy-button";

// Second way in: one line the host pastes into the AI agent they already use.
// It reads like a code block and scrolls inside its box once it passes about eight lines.
const PROMPT = "Let me use findmeatime.com/SKILL.md for my scheduling";

export function AgentPrompt() {
  const body = useRef<HTMLPreElement>(null);
  return (
    <div className="agent-start">
      <p className="or">Or start from the AI agent you already use</p>
      <div className="prompt">
        <div className="prompt-head">
          <span className="prompt-label">prompt</span>
          <CopyButton className="prompt-copy" text={PROMPT} fallbackTarget={body} />
        </div>
        <pre className="prompt-body" ref={body} tabIndex={0} aria-label="Prompt for your agent">{PROMPT}</pre>
      </div>
      <p className="agent-note">Paste it into your agent. It walks you through the same setup.</p>
    </div>
  );
}
