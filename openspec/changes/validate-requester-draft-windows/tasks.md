# Tasks

## 1. Authoritative review validation

- [x] 1.1 Add review-scoped future-start and known-duration validation at proposal and new-apply boundaries; preserve exact replay and dismissal. Add SQL tests for merged/changed/missing duration, invalid replacement preservation and expired apply; update owning architecture and test documentation.
- [x] 1.2 Generate and review the pg-delta migration using Supabase 2.119.0. Verify full local migration rebuild, SQL assertions, permissions and unchanged generic normalization; record evidence and commit schema/migration together.

## 2. Integrated acceptance

- [x] 2.1 Extend real request-review integration with past/short windows, valid partial patches, concurrent retries and expiry while waiting for locks. Verify no pending-review supersession or request mutation on denial, replay after expiry and clean post-fixture SQL; run application checks/builds and update the implementation plan.

## 3. Production verification

- [ ] 3.1 Identify the selected Supabase project, review pending migration dry run, apply and verify migration history, function definitions/privileges and rollback-only acceptance. Deploy a scanned clean application archive if needed; verify release health/authorization and record source/environment identity.
- [ ] 3.2 Verify all task evidence, sync the settled meeting-request requirements, archive this bounded change and update the plan; retain other requester-model and live-provider gaps explicitly.
