# Proposal

## Why

The user removed the previous implementation and requested a fresh plan without starting code. The first future slice must establish protected, recoverable conversation execution before the team rebuilds scheduling capabilities on it.

## What Changes

- On a new explicit implementation request, rebuild only the minimum npm/Next.js/eve foundation and documented separate build/deployment boundaries.
- Reimplement existing conversation authorization, audience isolation, protected input/retry behavior, bounded model work and durable reconnect/restart/terminal recovery guarantees with synthetic non-scheduling state.
- Pin a freshly tested runtime/dependency/model set and record persistence, worker/dispatcher placement and failure policy.
- Investigate resource-bound OAuth and Photon transport compatibility early; retain controlled live acceptance as later gates.
- Add foundation-only build/check commands, meaningful fixture tests, no-send CI and fresh architecture/setup evidence.

This is S1 in the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md). Admission, Calendar, preferences, proposals, actual booking, email/iMessage product journeys, full MCP/CLI and named-client acceptance remain later bounded changes. The reset itself is already local cleanup; these tasks describe future work only.

## Capabilities

### New Capabilities

None. Do not invent a new behavior merely to name the source reconstruction.

### Modified Capabilities

None. Existing [conversation access](../../specs/conversation-access/spec.md), [chat workspaces](../../specs/chat-workspaces/spec.md), [model execution](../../specs/model-execution/spec.md), [application commands](../../specs/application-commands/spec.md) and [durable jobs](../../specs/durable-jobs/spec.md) remain authoritative. `skip_specs: true` is intentional because this slice changes implementation, not their agreed behavioral contract. Any discovered need to change those requirements must first receive an explicit reviewed delta.

## Impact

Future source: root `agent/`, `apps/web/`, `lib/contracts/`, `lib/server/`, focused tests and npm/build/CI configuration. Minimal durable synthetic fixtures require an isolated disposable baseline; no migration generation or database activation is performed in this planning request. Follow the [database baseline decision](../../../documentations/technical_specification/03_provider_setup.md#selected-rebuild-supabase-project) and preserve applied history for any existing target.

Owning product direction: [PRD](../../../documentations/02_product_requirements.md), [design principles](../../../documentations/04_design_principles.md), [frontend architecture](../../../documentations/technical_specification/02_frontend_architecture.md) and [backend architecture](../../../documentations/technical_specification/01_backend_architecture.md). Model ID/entitlement, version pins, runtime persistence/placement, OAuth/client fit and native/receiver Photon boundary remain fresh technical decisions. Existing numerical admission/model limits remain settled contracts unless explicitly changed.

Planning does not authorize dependency installation, scaffolding, SQL, provider messages, paid/live probes or deployment. All implementation tasks remain unchecked until a new implementation request.
