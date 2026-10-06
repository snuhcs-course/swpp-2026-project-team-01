# Proposal

## Why

The application source has been removed and only scaffolds remain. The rebuild needs a tested shared authorization boundary and a complete acceptance ledger before the pending feature changes can safely use the new runtime.

## What Changes

- Rebuild shared contracts, verified principals, command errors, identity/session bindings and durable command integration in root `lib/`.
- Implement the selected single host `/app` workspace and protected requester `/booking/[bookingId]` route through the existing chat-workspace contract.
- Track each release acceptance scenario and allocate implementation to one owning change.
- Restore pinned install, typecheck, test and build commands, preserving migration history.

## Capabilities

### New Capabilities

- `conversation-access`: application-authorized access to runtime sessions and their audience-bound tools.

### Modified Capabilities

- `chat-workspaces`: consolidate host navigation in `/app` and retain one protected requester destination from intake to terminal receipt.

## Impact

Root manifests/CI, `agent/`, `apps/web/`, `lib/`, tests and new additive Supabase migrations. Existing [command](../../specs/application-commands/spec.md), [job](../../specs/durable-jobs/spec.md), [admission](../../specs/host-admission/spec.md) and [request](../../specs/meeting-requests/spec.md) contracts remain required. Runtime/provider decisions and evidence belong to [compatibility validation](../validate-provider-and-agent-compatibility/proposal.md). The [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md) retains the full release scope.
