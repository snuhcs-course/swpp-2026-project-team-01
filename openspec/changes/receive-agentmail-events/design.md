# Design

## Context

See [proposal.md](proposal.md). The existing Svix verifier produces minimized locators and a signed-body hash. Photon ingress and the durable job service provide established private-table and atomic-publication patterns.

## Goals / Non-Goals

**Goals:** durable receipt, concurrent replay/conflict handling, receiver generation fencing and sanitized HTTP acknowledgment.

**Non-Goals:** resolving senders, reading message bodies, linking requests, running agents, replying or enabling live provider consumers. These remain required Phase 6 work.

## Decisions

- Operator registry keyed by AgentMail inbox has a unique internal receiver UUID and disabled default. Deployment configuration provides that UUID, inbox and signing secret. Receiver replacement changes the UUID; the service-only RPC checks it under a shared row lock before any receipt or duplicate acknowledgment. No runtime administration endpoint is exposed.
- Private receipt table is unique by inbox/message and inbox/event. A separate inbox/delivery mapping supports a new Svix delivery ID for an exact retry without creating new work. Every identity points to the same immutable signed-payload digest and locators; changed evidence conflicts instead of overwriting history.
- Lock registry first, then one transaction advisory lock per inbox. This serializes the small receipt transaction and avoids crossed event/message/delivery deadlocks. Avoid provider calls while database locks are held.
- Receipt and `agentmail_ingress` job publication share the same transaction. Queue payload contains only receipt UUID. A lost commit response is safely recoverable through provider retry; the HTTP handler does not invent a new provider identity.
- Receiver errors are sanitized, no-store responses. Verified unsupported types require a current enabled registration before 204; normal received events return empty 200 only after database commit. Missing configuration returns 503.
- Reuse pg-delta desired schema workflow. Keep receipt order for future processing, but do not infer sender authority or event ordering from timestamps. Future execution must bind authority explicitly and cannot retrospectively trust these receipts solely because a new link was created.

## Risks / Trade-offs

- An enabled receiver without a worker accumulates jobs → keep registry empty/disabled until ownership and downstream acceptance are verified.
- Provider reissues a message with different signed payload → preserve evidence and return conflict for explicit reconciliation rather than duplicate execution.
- Per-inbox serialization limits throughput → transaction is short and indexed; measure before replacing with more complex multi-key locking.

## Migration Plan

Generate one additive migration, inspect grants/order, rebuild the disposable local chain and run isolation/concurrency/rollback tests. Identify the selected remote project, review push dry-run and apply migration before deployment. Verify a rollback-only remote probe leaves no records. Deployment does not register or enable a provider webhook. Disable the registry to fence ingress during operational rollback; preserve committed evidence.
