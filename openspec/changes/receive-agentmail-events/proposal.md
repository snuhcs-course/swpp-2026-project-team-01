# Proposal

## Why

The verified AgentMail transport currently has no durable receiver. Provider retries must not lose messages through premature acknowledgment or create duplicate dispatch work.

## What Changes

- Add a disabled-by-default, operator-owned inbox/receiver registry and private minimized receipt/delivery records.
- Persist verified locators and one recoverable job atomically, deduplicating concurrent message/event/delivery retries and rejecting changed evidence.
- Expose a bounded authenticated receiver that acknowledges only a committed receipt, with sanitized failures and no request or sender authority.

## Capabilities

### New Capabilities

- `requester-email-ingress`: Authenticated, durable requester-email receipts independent of conversation authority.

### Modified Capabilities

None. Existing [durable jobs](../../specs/durable-jobs/spec.md) and request authorization remain unchanged.

## Impact

Desired SQL, reviewed generated migration, service-only RPC, Next.js receiver, integration/provider tests and operational setup. Basis: [Phase 6](../../../documentations/technical_specification/04_implementation_plan.md#phase-6--add-requester-email-continuity). Inbox allocation, verified sender/request binding, full-message retrieval, execution, reply delivery and live provider registration remain subsequent full-plan work. This change must not enable a provider consumer before those prerequisites are verified.
