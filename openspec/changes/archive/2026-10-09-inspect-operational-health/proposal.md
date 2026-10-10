# Proposal

## Why

[Implementation Phase 9](../../../../documentations/technical_specification/04_implementation_plan.md#phase-9--harden-deploy-and-close-release-gates) requires redacted diagnostics for stalled work and uncertain provider outcomes. Operators currently need ad hoc private-table queries, increasing exposure risk and making missing telemetry easy to mistake for a healthy system.

## What Changes

- Add a service-only, read-only snapshot of persisted job, runtime, reservation, booking and channel delivery states, with fixed categories, counts, oldest timestamps and bounded opaque identifiers.
- Add an explicit-project operator CLI with strict output validation and sanitized errors. No public HTTP or agent tool exposes this snapshot.
- Document each signal, its limits and the existing guarded recovery boundary. State that rejected stale actions and authorization-denial event rates are not yet durably measured, rather than reporting zero.
- Verify no domain mutations, privilege bypass, sensitive output or provider sends; deploy and inspect the selected database before completion.

## Capabilities

### New Capabilities

- `operational-diagnostics`: authorized redacted inspection of persisted work and uncertainty, with truthful telemetry coverage.

### Modified Capabilities

None. Existing [durable jobs](../../../specs/durable-jobs/spec.md), [command authorization](../../../specs/application-commands/spec.md) and [email uncertainty](../../../specs/email-delivery/spec.md) retain their contracts.

## Impact

One additive service RPC and declarative migration, shared server/operator contracts, a repository CLI, SQL/integration/command tests and an operations runbook. No new provider dependency or recovery mutation. Durable denial/stale-rejection event instrumentation, automated alerts, audited new recovery actions, retention/backup policy, performance SLOs and operational ownership remain separate Phase 9 obligations; this change does not mark the whole phase complete.
