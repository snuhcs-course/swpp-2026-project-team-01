// Small inline icons for the ink screens (from the landing redesign's components/thyme/icons.tsx). All are
// decorative: the control around them carries the label.

export function GoogleLogo() {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 48 48" width="18">
      <path d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" fill="#EA4335" />
      <path d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" fill="#4285F4" />
      <path d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" fill="#FBBC05" />
      <path d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" fill="#34A853" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg aria-hidden="true" height="14" viewBox="0 0 14 14" width="14">
      <rect fill="none" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.4" width="8" x="4.5" y="4.5" />
      <path d="M9.5 2.6V2.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

// A wide-angled chevron, flatter than a right angle.
export function Chevron({ direction }: { readonly direction: "prev" | "next" }) {
  const d = direction === "prev" ? "M10.5 2.5 7.5 9l3 6.5" : "M7.5 2.5 10.5 9l-3 6.5";
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 18 18" width="18">
      <path d={d} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

// Placeholder profile picture for Thyme until a real avatar is drawn.
export function Avatar() {
  return (
    <span aria-hidden="true" className="avatar">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="15.5" r="7" />
        <path d="M5 40c1.6-8 7.6-13 15-13s13.4 5 15 13z" />
      </svg>
    </span>
  );
}

export function GlobeIcon() {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
      <circle cx="8" cy="8" fill="none" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.8 8h12.4M8 1.8c1.7 1.8 2.5 3.9 2.5 6.2S9.7 12.4 8 14.2C6.3 12.4 5.5 10.3 5.5 8S6.3 3.6 8 1.8z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
    </svg>
  );
}

export function Check() {
  return (
    <svg aria-hidden="true" height="14" viewBox="0 0 14 14" width="14">
      <path d="M2.5 7.4 5.6 10.4 11.5 3.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

export function ExternalIcon() {
  return (
    <svg aria-hidden="true" height="14" viewBox="0 0 14 14" width="14">
      <path d="M5.5 2.5H3a1 1 0 0 0-1 1V11a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V8.5M8 2h4v4M12 2 6.5 7.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
    </svg>
  );
}

// A speech bubble on the Messages-app green tile: the control opens Messages.
export function MessagesGlyph() {
  return (
    <span aria-hidden="true" className="im-glyph">
      <svg height="14" viewBox="0 0 14 14" width="14">
        <path d="M7 2C3.8 2 1.5 3.9 1.5 6.3c0 1.3.7 2.5 1.9 3.3-.1.8-.5 1.6-1.1 2.1 1.2-.1 2.3-.6 3-1.2.5.1 1.1.2 1.7.2 3.2 0 5.5-1.9 5.5-4.4S10.2 2 7 2z" fill="currentColor" />
      </svg>
    </span>
  );
}

// A ring that spins while waiting, then closes into a filled circle and draws a check or a cross. Decorative:
// the heading next to it says what happened.
export function StatusMark({ state }: { readonly state: "busy" | "done" | "failed" }) {
  return (
    <span aria-hidden="true" className={`status-mark ${state}`}>
      <svg viewBox="0 0 64 64">
        <circle className="disc" cx="32" cy="32" r="29" />
        <circle className="ring" cx="32" cy="32" pathLength="100" r="29" />
        {state === "busy" ? <path className="waiting-glyph" d="M22 18h20M22 46h20M24 18v6l16 16v6M40 18v6L24 40v6" /> : null}
        {state === "done" ? <path className="glyph" d="M19 33.5 28 42.5 46 23.5" pathLength="100" /> : null}
        {state === "failed" ? <path className="glyph" d="M23 23 41 41M41 23 23 41" pathLength="100" /> : null}
      </svg>
    </span>
  );
}
