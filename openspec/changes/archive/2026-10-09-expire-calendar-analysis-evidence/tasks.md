# Tasks

## 1. Bounded database maintenance

- [x] 1.1 Add the expiry index, restricted bounded cleanup and named minute scheduler; generate/review the migration, rebuild locally, verify permissions, cutoff, batching, decision preservation and concurrent lock handling, and document inspection/disablement.

## 2. Integrated release acceptance

- [x] 2.1 Run full database, integration and isolated restore regressions with clean security advisors; review selected-production dry run, deploy and verify definitions/privileges, one active schedule and actual scheduled synthetic cleanup without domain/provider effects.
- [x] 2.2 Record verified implementation-plan/evidence updates, validate strictly and sync/archive the completed change while preserving general retention, backup and release gaps.
