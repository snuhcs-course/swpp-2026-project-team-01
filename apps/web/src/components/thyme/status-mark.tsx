// AI-generated with Claude Code (claude-opus-5-5), 2026-10-18

// A ring that spins while Thyme is texting, then closes into a filled circle and draws a check or a cross.
// The ring stops where it is instead of jumping back, so the circle closes from wherever it was.
// Decorative: the heading next to it says what happened.
export function StatusMark({ state }: { state: "busy" | "done" | "failed" }) {
  return (
    <span className={`status-mark ${state}`} aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <circle className="disc" cx="32" cy="32" r="29" />
        <circle className="ring" cx="32" cy="32" r="29" pathLength="100" />
        {state === "done" && <path className="glyph" pathLength="100" d="M19 33.5 28 42.5 46 23.5" />}
        {state === "failed" && <path className="glyph" pathLength="100" d="M23 23 41 41M41 23 23 41" />}
      </svg>
    </span>
  );
}
