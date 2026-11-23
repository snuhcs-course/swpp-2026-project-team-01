# Proposal

Tracking issue: #204

## Why

A signed-in account currently sees only requests received on its own booking page in Requests, while the calendar Dashboard shows only meetings booked as the receiving account and Google events. Someone who also sent a request through another booking page has no single account view of both directions.

## What Changes

- The Requests view combines received requests with requests sent after either the guest's verified Google identity or an existing signed-in account session matched the account. A typed guest email alone never links a request. Each card names the other person, state and proposed time, and shows a direction tag: **Received request** (filled ink blue) or **Sent request** (white with an ink-blue outline). All, Received and Sent filters narrow the same list. **Needs your decision** uses clear red text; the sent-side approval state reads **Awaiting approval**.
- A sent card with a valid private request link opens the existing guest request workspace. The endpoint checks the account-to-request match before releasing that link. An expired link remains a non-interactive summary.
- The calendar Dashboard includes sent requests that have a proposed time or a confirmed booking, labeled and visually distinct from received bookings and Google events. A guest booking also returned as a Google invitation appears once.
- On request closure, revoke the chosen host-profile settings and requester grants while retaining only the verified account-to-request association needed for the account's request history.

The current [chat workspace contract](../../../specs/chat-workspaces/spec.md), [guest profile change](../../guest-flow-completion/specs/requester-host-profiles/spec.md), [visual direction](../../../../DESIGN.md) and [frontend architecture](../../../../documentations/technical_specification/02_frontend_architecture.md) remain the bases for the change.

## Capabilities

### Modified Capabilities

- `chat-workspaces`: account request inbox and calendar Dashboard show both directions.

The still-open `guest-flow-completion` change is updated alongside this change so its host-profile closure rule clears the choice while retaining the verified match.

## Impact

The host workspace's list projection and UI, calendar projection and UI, request closure, and their documentation and tests change. Existing tables suffice; no schema migration or new provider grant is needed. Requests without a verified Google match or a signed-in account session stay out of the account's sent view.
