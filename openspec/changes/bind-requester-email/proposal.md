# Proposal

## Why

Authenticated email receipts and domain-signed content do not identify an authorized scheduling request. Requester email needs an explicit protected binding that survives normal retries and is invalidated by authority changes.

## What Changes

- Let the current requester with verified contact prepare a short-lived one-time linking message from the protected booking page, recover pending state and revoke the link.
- Bind only a newly received, independently authenticated message from the verified contact containing that exact linking proof; preserve immutable inbox/thread/request and receiver-generation association.
- Reject unknown, forwarded, conflicting, pre-binding or revoked messages without revealing request state. Recheck authority for every subsequent receipt.
- Add protected browser controls and connect the durable ingress worker to binding and authorized conversation preparation, with truthful unavailable/failure states.

## Capabilities

### New Capabilities

- `requester-email-access`: Protected enrollment and current request-bound email authority.

### Modified Capabilities

None. [Request continuation](../../specs/meeting-requests/spec.md) and [durable ingress](../../specs/requester-email-ingress/spec.md) remain required prerequisites.

## Impact

Private desired schema/migration, service-only operations, server adapters, protected booking controls, ingress processing and focused database/provider/browser tests. Follow [Phase 6](../../../documentations/technical_specification/04_implementation_plan.md#phase-6--add-requester-email-continuity) and [channel boundaries](../../../documentations/technical_specification/01_backend_architecture.md#8-jobs-inbox-and-outbox). Initial email intake and outbound reply/uncertain-send execution remain full-plan work; this change does not establish live channel readiness without controlled acceptance.
