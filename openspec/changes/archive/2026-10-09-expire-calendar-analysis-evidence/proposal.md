# Proposal

## Why

The [Calendar analysis design](../../conversational-host-setup/design.md#bounded-calendar-analysis-contract) already removes temporary scans after 24 hours when a host returns, but inactive hosts retain them indefinitely. The [Phase 9 operations work](../../../../documentations/technical_specification/04_implementation_plan.md#phase-9--harden-deploy-and-close-release-gates) calls for global cleanup.

## What Changes

- Apply the existing 24-hour scan cutoff through bounded scheduled database maintenance without requiring a host visit.
- Preserve recent scans, dismissal fingerprints, selected draft values, setup progress and confirmed settings; cleanup grants no scheduling or provider authority.
- Restrict maintenance to the database operator/scheduler, and document cadence, contention/backlog behavior, verification and disablement.

## Capabilities

### New Capabilities

- `calendar-analysis-retention`: scheduled removal of temporary Calendar scan evidence while preserving adopted settings and private access boundaries.

### Modified Capabilities

None. The [chat workspace contract](../../../specs/chat-workspaces/spec.md) continues to own host setup and explicit confirmation.

## Impact

An expiry index, private maintenance function and scheduler registration in declarative SQL and reviewed migrations; database/concurrency tests; architecture, setup and operational documentation. No provider call, application route or new dependency. General transcript/request/audit retention, backups and operational ownership remain separate decisions.
