# Tasks

## 1. Bounded collection and inspection

- [x] 1.1 Add strict rejection contracts, private hourly counters and service-only record/read RPCs; generate/review the migration, rebuild locally, verify permissions, concurrent increments, window pruning, saturation, redaction and read-only inspection, and document the storage/coverage boundaries.
- [x] 1.2 Add opt-in bounded database-adapter collection and the explicit `diagnostics --rejections` mode; verify exact recognized categories, no success/unknown/disabled logging, no private content, timeout/failure/non-recursion, preserved original results and actual CLI target/credential checks; update operator/setup documentation.

## 2. Integrated release verification

- [ ] 2.1 Run application/type/build, database/integration and restore regressions; review and deploy the additive schema and application with production activation to the selected release target, then verify protected collection, operator counts, unchanged domain state and production guards with sanitized evidence.
- [ ] 2.2 Update the implementation plan and evidence ledger, run strict OpenSpec validation, and sync/archive the change only after every bounded requirement above is verified; keep broader Phase 9 and pre-database coverage gaps explicit.
