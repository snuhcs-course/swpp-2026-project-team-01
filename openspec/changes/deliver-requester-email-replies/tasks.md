# Tasks

## 1. Durable capture and authority

- [x] 1.1 Implement the private reply ledger and atomic settlement capture with immutable replay, suppression and no historical backfill. Verify transaction/replay/current-authority behavior with real database tests and update backend documentation.
- [ ] 1.2 Implement fenced claims, final dispatch authorization, stable first-attempt deadline, acceptance persistence and ordered recovery. Verify concurrent claims, stale leases, changed outcome identities and expired horizons with database tests.
- [ ] 1.3 Centralize parent evidence checks and accept only current-link accepted outgoing parents. Reconcile the pending binding specification and test valid continuation plus wrong-link/thread/receiver, unsent, uncertain and pre-dispatch parents.

## 2. Delivery integration

- [ ] 2.1 Connect the existing transport through a typed worker, secret-protected route and scheduler. Verify exact-payload restart recovery, no send on denied authority, HTTP guards and provider tests; update provider setup instructions.
- [ ] 2.2 Rebuild the full local migration chain, run relevant regressions and both builds, deploy reviewed migration/code, and verify production receiver fencing and private HTTP boundaries. Record dated evidence and implementation-plan checkboxes.
- [ ] 2.3 Verify controlled live same-thread reply and outgoing-parent continuation, including uncertain acknowledgment and revocation cases; record provider acceptance separately from actual recipient delivery, then sync/archive only verified requirements.
