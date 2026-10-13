# Proposal

## Why

The rebuild supports invitation redemption but has no operator issuance/revocation CLI or durable invitation delivery. Hosts cannot complete the agreed admission journey through supported tooling.

## What Changes

- Add service-credential operator commands with explicit project and audit identity, idempotent issuance/status/revocation and seven-day invitation validity.
- Deliver remote invitations through Cloudflare by default, with explicit manual delivery and local no-send behavior. Keep readable codes out of URLs, logs and normal JSON output.
- Persist delivery intent before dispatch, preserve exact retries and expose uncertain acceptance without automatic resend or reissuance.
- Verify authorization, concurrency, interruption/retry and redemption using local fixtures before selected-production deployment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-admission`: Operator target binding, retry-safe invitation lifecycle and recoverable private delivery.

## Impact

Extends retained `fmat.invitations` and service-only command boundaries with a declarative schema/migration, server adapter, operator CLI and Cloudflare worker. Reuses browser redemption and the existing Cloudflare transport. Owning references: [host admission](../../specs/host-admission/spec.md), [email delivery](../../specs/email-delivery/spec.md), [operator setup](../../../documentations/technical_specification/03_provider_setup.md#host-invitation-operations), and [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md). No pending product decision is promoted; this implements the existing admission scope. Live recipient delivery needs an explicitly authorized controlled recipient; implementation authorization alone does not authorize mailing arbitrary people.
