# Proposal

## Why

The Phase 2 legacy audit found that the retired evaluator shared an 18-second deadline across provider work (`5c305d9^`, request evaluation and `deadlineFetcher`). The replacement `AvailabilityEvaluation` uses individual timeouts but can start fresh budgets for successive Calendar pages, parties, candidates and travel legs. Cancellation and prevention of later calls are therefore unproven. This undermines the bounded execution required by the [implementation plan](../../../../documentations/technical_specification/04_implementation_plan.md) and safe uncertainty in [meeting feasibility](../../../specs/meeting-feasibility/spec.md).

## What Changes

- Restore one 18-second elapsed-time budget for a scheduling evaluation, including refresh, Calendar/freebusy/adjacent reads, travel and optional ranking/publication orchestration.
- Propagate cancellation through provider requests and response bodies; stop waiting for non-cooperative providers and prevent late results from continuing domain work.
- Preserve narrower adapter/model deadlines, existing authorization checks and durable uncertainty. A timeout is never an empty calendar, zero travel, approval or proof that an in-flight mutation rolled back.
- Verify boundary cases and deploy the application correction without schema changes unless implementation evidence establishes a need.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-feasibility`: bound a complete evaluation and prevent late provider work from authorizing publication or booking.

## Impact

Availability evaluation, publication/ranking orchestration, Calendar refresh/list/freebusy/adjacent interfaces, route transport and their tests. Booking revalidation uses the same evaluation budget, but uncertain Calendar writes retain their separate durable recovery contract. No new provider, dependency or user permission is required. The proposed 18-second bound restores the historical value; production latency acceptance still requires measurement. This change does not resolve live Google consent or named-client acceptance.
