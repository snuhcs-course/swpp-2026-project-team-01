# Proposal

## Why

The website already supports conversational setup and request decisions, but a permanent host sidebar, dashboard cards, and page-level introductions compete with the chat. On phones they push the composer below the useful viewport and make the experience feel like a form-driven dashboard.

## What Changes

- Use a centered conversation as the default host setup, inbox, requester intake, and request-detail surface.
- Replace the permanent host sidebar with a compact workspace menu; keep structured controls in labeled settings dialogs.
- Show request status and decision artifacts inside the transcript, with a compact shared/private switch for host request discussions.
- Keep the composer visible on phone widths and preserve keyboard navigation and exact approval controls.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-workspaces`: Require a chat-only primary layout, compact navigation, and readable, reachable controls on narrow screens.

## Impact

This changes the React/Vite web layout and its browser fixtures. Scheduling APIs, permissions, and booking semantics are unchanged. See [interface direction](../../../../documentations/user_experience/03_interfaces.md) and the existing [chat-workspaces spec](../../../specs/chat-workspaces/spec.md).
