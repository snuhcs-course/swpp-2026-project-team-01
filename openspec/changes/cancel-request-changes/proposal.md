# Proposal

Tracking issue: [#465](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/465).

## Why

The guest's Change meeting flow reopens an agreed request but offers no way to abandon the edit and return it to the host's decision queue. Its Find times that work? heading also obscures changes to other meeting details. This extends the existing [request lifecycle](../../specs/meeting-requests/spec.md) and [contextual artifacts](../../specs/chat-workspaces/spec.md) within the [guest journey](../../../documentations/user_experience/06_guest_booking_flow.md).

## What Changes

- Use the user-selected title **What would you like to change?** while a guest edits an existing request or booking.
- Offer **Find a new time**, **Edit details** and **Cancel**.
- Cancel restores the previously agreed scheduling details and host decision state. A standing confirmed booking returns to Booked instead.
- Authorize and serialize cancellation under the request lock, retain immutable proposal history, reject stale/expired actions, and keep exact retries safe.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: abandon a requester-initiated edit and restore the prior agreed request or standing booking.
- `chat-workspaces`: describe the edit accurately and expose a distinct **Cancel** action.

## Impact

Requester commands and projections, change-agreement and booking-change outcomes, guest cards, and regression tests. Reuse the existing requester-scoped command outcome store for bounded rollback snapshots; no database migration or new provider operation is needed. Existing edits without a snapshot are cancellable only when their scheduling details have not advanced since reopening. Focused database integration tests run on isolated PostgreSQL 17 using the repository’s actual table definitions. Full Supabase migration/Auth/provider validation remains separate.
