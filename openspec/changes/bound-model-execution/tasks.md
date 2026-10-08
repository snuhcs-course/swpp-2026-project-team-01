# Tasks

## 1. Provider boundary

- [x] 1.1 Implement the shared bounded model wrapper and verify actual provider request limits, input rejection, retries, cancellation and stalled streams with deterministic tests; document its policy and integration status.

## 2. Durable accounting

- [x] 2.1 Add private work/principal/service counters and authorized conversation/ranking reservation RPCs; generate/review the migration and verify limits, retries, expiry, privileges and rollback using SQL and concurrent integration tests; document window and reservation semantics.
- [x] 2.2 Wire the production conversation and ranking paths to durable reservations, including compaction; verify real Eve execution/restart, failed-turn settlement, cached ranking reuse and structured browser recovery; update runtime documentation.

## 3. Release acceptance

- [ ] 3.1 Pass the full relevant local checks and both service builds; deploy committed database/application changes to the identified production targets, verify matching migrations/definitions, rollback-only quota acceptance and public HTTP guards, and record evidence in the implementation plan before syncing/archive.
