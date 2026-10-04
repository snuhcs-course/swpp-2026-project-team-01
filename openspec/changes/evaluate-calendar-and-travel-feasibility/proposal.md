# Proposal

## Why

Calendar gaps alone do not prove a meeting fits host focus rules, requester availability, or travel between physical commitments. P3 needs deterministic candidate evaluation and explicit clarification when route or location context is missing.

## What Changes

- Generate candidates from requester windows intersected with host working rules, busy intervals, focus blocks, and authorized requester availability.
- Normalize absolute instants/timezones and reject ambiguous local date input.
- Evaluate both adjacent trips with Google Routes, departure context, selected travel mode, and host buffers; missing estimates never become zero travel.
- Keep preference exceptions host-private and explicit; use structured AI only for extraction/ranking and reject stale asynchronous results.

## Capabilities

### New Capabilities

- `meeting-feasibility`: Deterministic interval/rule/travel checks, private exceptions, clarification, and stale-result protection.

### Modified Capabilities

None.

## Impact

Calendar/Routes adapters, scheduling evaluation, versioned candidate persistence, rule configuration, private host controls, and tests. Depends on P2 connections and P3 lifecycle; P4 reuses the same feasibility checks before dispatch.

Basis: [implementation plan P3](../../../documentations/technical_specification/04_implementation_plan.md), [PRD FR-05–FR-17 and AC-02–AC-03, AC-12, AC-27](../../../documentations/02_product_requirements.md), [technical availability design](../../../documentations/03_technical_specification.md), and [backend contract](../../../scripts/backend-contract.md). Route coverage must be reported by tested geography/mode; unsupported coverage remains a visible clarification condition.
