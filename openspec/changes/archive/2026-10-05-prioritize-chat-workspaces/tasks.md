# Tasks

## 1. Host setup workspace

- [x] 1.1 Make host setup conversation the default workspace and move existing manual setup controls to a clearly labeled secondary surface; verify signed-in, incomplete, ready, and failed-model states in browser checks.
- [x] 1.2 Show current setup draft, calendar choices, review, and readiness as conversation artifacts with explicit in-chat actions; verify current review identifiers and server errors still govern mutations.
- [x] 1.3 Update the host setup/interface guides for the visible journey and verify mobile and keyboard access to chat and structured recovery.

## 2. Request workspaces

- [x] 2.1 Make requester and host request conversations the default request view, moving structured editing to a secondary surface; verify active, pending, and closed request states in browser checks.
- [x] 2.2 Put candidate selection, exact proposal agreement/approval, and other available decisions next to their authoritative artifacts; verify stale versions cannot be accepted and audience-private data remains separate.
- [x] 2.3 Update the requester/interface guides for the visible journey and verify phone-width, keyboard, pending, and failure behavior.
- [x] 2.4 Remove credential-paste and recovery controls from the request view; verify a protected link still restores access and a bare request URL reveals no private details.

## 3. Integration review

- [x] 3.1 Run web typecheck, lint, browser checks, production build, and strict OpenSpec validation; inspect the diff for unintended backend or secret changes.

2026-10-05: `npm run check` passed (149 Deno tests and 13 Node tests), plus 25 browser, 14 host-setup, 10 requester-conversation, and 9 workspace browser checks. Both pending OpenSpec changes passed strict validation. The host ready-state screenshot and requester desktop/mobile screenshots were inspected. The web bundle retains an existing size warning.
