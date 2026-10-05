# Proposal

## Why

Host setup and meeting requests now support conversation, but the workspaces still give manual controls comparable prominence. The user wants chat to be the primary path, with reviewable artifacts and action buttons in the conversation, while retaining manual controls as a secondary option.

## What Changes

- Make the host setup and requester/host request workspaces open on a conversation-first view.
- Show server-derived progress, setting drafts, availability, proposals, and decisions as artifacts beside the relevant conversation turn, with explicit in-chat actions.
- Move the existing structured controls into a clearly labeled secondary tab or settings surface without changing their command semantics.
- Remove requester credential-paste and email-recovery controls from the request page; private links continue to restore access automatically.
- Preserve visible pending, error, stale-decision, consent, and authorization states across both surfaces and on narrow screens.

## Capabilities

### New Capabilities

- `chat-workspaces`: Presentation and action continuity for conversation-first host setup and request management.

### Modified Capabilities

None. The existing [meeting-requests spec](../../specs/meeting-requests/spec.md) and pending [conversational-host-setup change](../conversational-host-setup/specs/conversational-host-setup/spec.md) retain their authority and data contracts.

## Impact

The React/Vite website, its browser checks, and [interface guidance](../../../documentations/user_experience/03_interfaces.md) change. Existing AI Elements, shadcn preset `b6rtA2Hmi`, server APIs, stored conversations, and approval guards remain in use. No database migration or new model/provider permission is required.
