# Proposal

## Why

P3 needs a web journey that carries an account-free requester from complete intake to a versioned proposal and host review. A single persisted lifecycle prevents stale decisions, guest credential leakage, and independent channel state machines.

## What Changes

- Add public ready-host discovery, structured intake, protected continuation, and a responsive authenticated host inbox.
- Persist immutable proposals, revisions, conversation history, requester agreement, revision/decline/withdrawal, and seven-day request expiry.
- Bind guest credentials to one request for at most thirty days and revoke mutation, OAuth, and recovery authority on closure while retaining a minimal terminal receipt read until expiry; require verified contact for credential recovery.
- Separate host-private context from requester projections; support English and Korean intake and structured AI extraction with deterministic validation.

## Capabilities

### New Capabilities

- `meeting-requests`: Account-free intake, protected continuation, versioned negotiation, lifecycle guards, and audience-safe views.

### Modified Capabilities

None.

## Impact

Web intake/inbox/review, guest credentials and contact recovery, request/proposal/history schema, API commands, AI extraction, and tests. Depends on P2. Candidate generation belongs to `evaluate-calendar-and-travel-feasibility`; event creation remains P4.

Basis: [implementation plan P3](../../../../documentations/technical_specification/04_implementation_plan.md), [PRD lifecycle and AC-01, AC-03–AC-04, AC-10–AC-13](../../../../documentations/02_product_requirements.md), [backend contract](../../../../scripts/backend-contract.md), and [architecture](../../../../documentations/technical_specification/01_backend_architecture.md). Guest recovery must use verified contact; reminders and automated follow-up limits remain later pilot decisions.
