# Proposal

## Why

The [Phase 9 plan](../../../documentations/technical_specification/04_implementation_plan.md#phase-9--harden-deploy-and-close-release-gates) requires redacted diagnostics for rejected stale actions and authorization failures. The current [operational snapshot](../../specs/operational-diagnostics/spec.md) can only inspect retained domain state; rejected transactions leave no measurable event count.

## What Changes

- Record only two fixed categories of rejected database RPC attempts in bounded hourly counters, without actor, resource, payload, provider or credential data.
- Add explicitly enabled, best-effort collection in the server database adapter with a short independent deadline and no effect on the original response or error.
- Add a service-only rejection snapshot and an explicit operator CLI mode. Keep the existing persisted-state snapshot and its version unchanged.
- Expose collection scope, partial current-hour coverage, saturation and missing pre-database instrumentation. Zero observations never establish readiness or absence of rejected activity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operational-diagnostics`: bounded rejection counters, read-only operator inspection and truthful collection limits.

## Impact

Private declarative schema and an additive migration; database adapter; diagnostic contracts/CLI/tests; deployment configuration and the operational runbook. No meeting decision, provider write, retry or recovery authority changes. Broader ingress instrumentation, alerting, general user-data retention, operational ownership and performance/SLO decisions remain separate unresolved release work.
