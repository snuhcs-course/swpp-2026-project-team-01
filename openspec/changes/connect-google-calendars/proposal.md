# Proposal

## Why

Scheduling must use authorized host context and optionally intersect requester availability without granting guests host privileges. P2 needs browser-bound consent, explicit calendar permissions, protected token storage, and recoverable connection failures.

## What Changes

- Implement host and request-scoped requester Google consent with distinct permissions and validated callback binding.
- Store encrypted grants server-side, refresh safely, and support revocation/disconnection.
- Select host conflict calendars and a writable booking destination before publishing readiness.
- Pause dependent scheduling on calendar failures and offer requester reconnection or explicit manual availability.

## Capabilities

### New Capabilities

- `calendar-connections`: Bound consent, scoped host/requester grants, calendar selection, and connection recovery.

### Modified Capabilities

None.

## Impact

Google OAuth callback and adapters, server secret configuration, grant records, setup UI, guest continuation, and tests. Depends on foundation and host admission. Requester end-to-end continuation completes with request lifecycle in P3; this change supplies its grant boundary.

Basis: [implementation plan P2](../../../documentations/technical_specification/04_implementation_plan.md), [PRD FR-36 and AC-27](../../../documentations/02_product_requirements.md), [Google access design](../../../documentations/03_technical_specification.md), and [backend contract](../../../scripts/backend-contract.md). Live consent and refresh results must be recorded separately from fixture tests; OAuth production verification remains a deployment/release dependency.
