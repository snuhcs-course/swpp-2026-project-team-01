// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16, 2026-10-17
"use client";

import { useRef } from "react";
import type { Copy } from "./copy";
import { CopyButton } from "./copy-button";

// Second way in: one line the host pastes into the AI agent they already use.
// It reads like a code block and scrolls inside its box once it passes about eight lines.
export function AgentPrompt({ copy, labels }: { copy: Copy["landing"]; labels: Copy["copy"] }) {
  const body = useRef<HTMLPreElement>(null);
  return (
    <div className="agent-start">
      <p className="or">{copy.agentOr}</p>
      <div className="prompt">
        <div className="prompt-head">
          <span className="prompt-label">prompt</span>
          <CopyButton className="prompt-copy" text={copy.agentPrompt} labels={labels} fallbackTarget={body} />
        </div>
        <pre className="prompt-body" ref={body} tabIndex={0} aria-label={copy.agentLabel}>{copy.agentPrompt}</pre>
      </div>
      <p className="agent-note">{copy.agentNote}</p>
    </div>
  );
}
