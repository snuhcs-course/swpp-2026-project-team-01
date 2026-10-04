# Proposal

## Why

A current requester agreement and explicit host approval must create one recoverable Calendar booking even when workers stop or provider responses are lost. P4 needs durable identities, reservations, revalidation, and honest pending states before enabling calendar writes.

## What Changes

- Accept attributable host approval through an explicit authenticated web action bound to current proposal and revision.
- Persist one booking identity per request, immutable dispatch attempts, provider-valid event IDs, fenced worker ownership, and durable host reservations.
- Revalidate required calendars, rules, requester availability, and travel before writing only to the selected host booking calendar.
- Reconcile uncertain writes using the persisted destination/event identity; keep notification outcomes independent of booking.
- Add audited recovery actions that preserve approval and evidence requirements.

## Capabilities

### New Capabilities

- `approved-booking`: Explicit current decisions, guarded dispatch, uncertain-write reconciliation, and verified booking outcomes.
- `booking-notifications`: Audience-safe confirmation records and delivery recovery independent of booking state.

### Modified Capabilities

None.

## Impact

Host approval UI, Calendar creation/reconciliation adapter, request decisions, booking/reservation/outbox schema, durable workers, operator recovery, and tests. Depends on P1 durable jobs and P3 lifecycle/feasibility.

Basis: [implementation plan P4](../../../documentations/technical_specification/04_implementation_plan.md), [PRD FR-17–FR-23 and AC-04, AC-06–AC-10, AC-13](../../../documentations/02_product_requirements.md), [reconciliation design](../../../documentations/03_technical_specification.md), and [backend contract](../../../scripts/backend-contract.md). P5/P6 client/channel approval and delivery adapters remain later work; P4 evidence must distinguish fixtures from a controlled live Calendar case.
