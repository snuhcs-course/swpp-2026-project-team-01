# Proposal

## Why

Hosts currently edit weekly meeting windows through setup cards and sign out through a compact menu, but there is no single place to see these controls or pause new meeting requests. A settings dialog would let a host adjust availability and intake from either the setup or request conversation without losing their place. This extends the [host onboarding flow](../../../documentations/user_experience/05_host_onboarding_flow.md) and the existing [conversation-first workspace](../../specs/chat-workspaces/spec.md), using the ink direction in [DESIGN.md](../../../DESIGN.md).

## What Changes

- Place a labeled gear button at the upper right of the host setup and host request/chat views in `/app`. It opens a floating settings modal over a translucent backdrop. A visible **X** at the modal's upper right closes it; keyboard and screen-reader operation remain available.
- Show the host's confirmed weekly available windows in their meeting timezone and let them edit them. Saving follows the existing draft, review and confirmation rules, so the public schedule changes only after a successful confirmation.
- Add a host-controlled **Accept new meeting requests** toggle. Turning it off stops new requests across the public web page, agent and email entry points while preserving existing requests and confirmed settings. Turning it back on resumes intake only when the host is otherwise ready. This is distinct from operator suspension.
- Put **Sign out** in the modal, preserving the existing sign-out action. Keep navigation to setup, requests, iMessage and connected agents reachable from the workspace.

No dedicated GitHub tracking issue exists yet. The shared ink migration in [issue #43](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/43) is related but does not cover this dashboard.

## Suggested Follow-ups

These are useful settings candidates, not part of the first dashboard implementation:

- **Calendar connection and booking destination status:** show whether Google access is healthy and give a direct route to reconnect or change the booking calendar.
- **Timezone and meeting defaults:** expose the current timezone, default duration, buffers, meeting mode and location, using the same review-and-confirm flow as weekly windows.
- **Public booking link:** let the host copy and preview the active link and see clearly when intake is paused.
- **Notifications:** let the host choose which request updates arrive through the channels the product actually supports.

## Capabilities

### New Capabilities

- `host-settings`: a host-authorized settings dialog, revision-safe weekly-window changes, host-controlled intake pause and resume, and sign-out access.

### Modified Capabilities

None. The new contract adds a host preference gate to public request admission while retaining the existing readiness and operator-authority rules.

## Impact

The workspace header and menu, host setup state and weekly-window editor, public readiness/admission checks for web, MCP and email, and persisted host settings are affected. A schema change stores the intake toggle separately from account suspension and confirmed scheduling rules. Existing requests, host decisions and bookings continue under their current authority. The modal uses the project's shared dialog and ink components rather than a separate settings page.
