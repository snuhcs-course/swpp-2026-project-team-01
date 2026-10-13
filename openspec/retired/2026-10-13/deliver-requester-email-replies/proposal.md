# Proposal

## Why

Authorized requester email inputs can run the agent, but settlement does not yet queue an outbound answer. Normal email clients then reply to the service's outgoing message; current parent checks recognize only incoming receipts, preventing that continuation.

## What Changes

- Atomically freeze one private reply with runtime settlement and preserve its original recipient, inbox, receiver, link, thread, parent, content and dispatch identity.
- Deliver through a fenced recoverable worker using the existing AgentMail transport; retry the same payload only within its conservative 23-hour horizon and retain uncertainty afterward.
- Accept signed continuation parents referencing an accepted outgoing reply belonging to this same current link, while preserving authenticated-author and recipient checks.
- Verify revoked access, concurrent claims, lost responses, ordering and outgoing-parent continuation before controlled live activation.

## Capabilities

### New Capabilities

- `requester-email-replies`: Durable private conversational replies and their narrowly scoped outgoing-parent evidence.

### Modified Capabilities

None. The pending [requester email binding delta](../bind-requester-email/specs/requester-email-access/spec.md) will be reconciled to allow this exact additional parent evidence; it is not yet a main capability.

## Impact

Changes runtime settlement, private SQL schema and generated migration, AgentMail worker/route/scheduler, integration tests and provider/backend documentation. Builds on [email delivery](../../specs/email-delivery/spec.md) and [authenticated ingress](../../specs/requester-email-ingress/spec.md). Implements the requester conversation portion of [Phase 6](../../../documentations/technical_specification/04_implementation_plan.md) under the [PRD](../../../documentations/02_product_requirements.md).

Provider acceptance is not inbox delivery. Authentic delivery events, live signed-mail enrollment and full email intake remain explicit full-plan gates; this change cannot claim those outcomes from send/readback responses. No unresolved product policy is promoted into a settled spec.
