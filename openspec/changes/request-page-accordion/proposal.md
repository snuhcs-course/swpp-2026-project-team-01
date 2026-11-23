# Proposal

Tracking issue: #299

## Why

The signed-in Requests list currently sends a received request to `/app?request=…`, a separate host-private chat with a decision card. The host wants to inspect meeting details and take the existing decisions directly from the request list. The proposed interaction changes the conversation-first host request behavior in [chat-workspaces](../../specs/chat-workspaces/spec.md) and the [host-review-and-booking change](../archive/2026-11-24-host-review-and-booking/proposal.md).

## What Changes

- A received request expands within the Requests list. Its details and permitted actions appear in the same card; selecting another request closes the first.
- The expanded card presents the proposal status, date and time, length, mode, place or meeting link, requester identity and purpose. It preserves **Approve this proposal**, **Request changes** and **Decline** when those actions are allowed by the current request state.
- The separate host-private request chat screen is removed from the host's request review path. No new chat surface appears inside the accordion.

This branch includes [a standalone interactive prototype](prototype.html) for design review and implements the reviewed accordion in the Requests route. The prototype uses filled example requests shaped from the existing list and host request responses. The request commands retain their existing authorization and revision checks.

## Scope

The prototype covers the received proposal states, a withdrawn request, a cancelled booking and a sent request using sample data. Sent requests continue to use their guest-authorized path. Prototype action buttons send no commands; the application buttons use the existing commands.

## Impact

Implementation affects `apps/web/app/_components/host/host-requests.tsx`, its request cards, the [visual design](../../../DESIGN.md), and the chat-workspaces capability delta. Existing command authorization, revision checks and booking rules continue to govern actions. Interaction tests remain before the change can be archived.
