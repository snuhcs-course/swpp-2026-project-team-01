# Proposal

## Why

Protected personal-agent access is required by the [implementation plan](../../../../documentations/technical_specification/04_implementation_plan.md), but the pinned Supabase OAuth probe fails resource isolation. The app needs explicit client/resource grants without turning Google identity, a request link, or model prose into broader authority.

## What Changes

- Implement application-owned authorization-code/refresh handling, S256 PKCE, exact resource binding, public-client registration, discovery and asymmetric access tokens.
- Add durable bounded authorization/grant/code/refresh state with current host admission or single-request authority checks, revocation and rotation/replay defenses.
- Provide explicit grant/deny and revocation through protected browser flows at `/connect/authorize`, retaining Google-only host login and account-free requester consent.
- Supply an internal verified-agent boundary for subsequent MCP/CLI adapters. Token permissions remain separate from attributable human meeting decisions.

## Capabilities

### New Capabilities

- `agent-client-authorization`: Resource-bound client consent, token lifecycle and current application-grant enforcement for host and account-free requester agents.

### Modified Capabilities

None. Preserve [verified commands](../../../specs/application-commands/spec.md), [host admission](../../../specs/host-admission/spec.md) and [request scope](../../../specs/meeting-requests/spec.md).

## Impact

Shared OAuth modules and JOSE dependency, private Supabase schema/migrations, public protocol routes, protected consent UI, identity adapter, and protocol/database/browser tests. Update backend, provider setup and the implementation plan. MCP tool coverage, CLI credential storage and named-client acceptance remain subsequent full-plan requirements; this change must not advertise them as implemented. Exact operational limits/key handling are selected in the design and verified before activation. No Google or Supabase tokens are issued to agent clients by this service.
