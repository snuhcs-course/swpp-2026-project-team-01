# Tasks

## Prototype

- [x] Create a standalone interactive accordion with filled received and sent examples for design review.
- [x] Match the existing list and per-request fields and decision conditions; verify desktop and phone layouts.
- [x] Review the prototype and settle the card layout and copy with the requester.

## Implementation after design review

- [x] Write the chat-workspaces delta spec for the approved host request interaction and reconcile the request-dashboard and host-review-and-booking changes.
- [x] Replace the separate host-private chat request screen with in-list details and authorized action controls.
- [ ] Test accordion keyboard and mobile behavior, data visibility, action availability, stale revisions, and retained command outcomes.
- [x] Update `DESIGN.md`; complete the capability spec and remaining documentation before archiving.

- [ ] Before archiving, rebase this change's `chat-workspaces` "Conversation-first entry" MODIFIED block onto the main spec: since #391 (and #440) the main text has no host web chat, discussion switch or private chat, and archiving the block as written would bring that wording back.
