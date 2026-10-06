# Proposal

## Why

Hosting is invite-only, but account-free requesters must remain able to schedule. P2 needs admission enforced in shared operations and a resumable web setup journey that cannot be bypassed through direct API access.

## What Changes

- Add deduplicated public waitlist intake and operator-only seven-day invitation issuance/revocation.
- Bind single-use invitation redemption to a verified recipient account in one transaction.
- Add authenticated resumable host setup, unique stable handles, confirmed timezone/rules, and public readiness guards.
- Keep request intake and optional requester Calendar consent independent of host admission.

## Capabilities

### New Capabilities

- `host-admission`: Waitlist, operator invitations, verified redemption, resumable setup, and publishing guards.

### Modified Capabilities

None; this adds the first admission contract.

## Impact

Web authentication/setup, API admission routes, private host records, invitation/waitlist desired SQL, generated migrations, and tests. Depends on `establish-application-foundation`; calendar readiness is supplied by `connect-google-calendars`.

Basis: [PRD FR-01–FR-04 and FR-35](../../../../documentations/02_product_requirements.md), [backend architecture](../../../../documentations/technical_specification/01_backend_architecture.md), and [backend contract](../../../../scripts/backend-contract.md). Retention and broader pilot abuse policies remain P7 decisions; token expiry and operator-only issuance are resolved here.
