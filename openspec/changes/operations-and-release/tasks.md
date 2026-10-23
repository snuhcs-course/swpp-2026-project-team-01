# Tasks

Group 1 records the decisions and is serial. Groups 2 to 5 are the plan's Lanes A to D and are independent of one another. Group 6 is the join, and group 7 the release, which is blocked on the user.

Before each group, read the [Phase 8 reference repository files](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase) and name the files and revisions followed in the pull request. Evidence goes to the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md) with command, date, revision and environment.

## 1. Decisions (serial, first)

- [x] 1.1 Record D1–D14 from the [proposal](proposal.md#decisions) in the proposal, the design, the delta specs and the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-8--operations-and-release). Verify `openspec validate operations-and-release --strict` and `npm run check` pass.
- [x] 1.2 Update the owning documents (PRD sections 2, 8 and 10, provider setup, the page list) and regenerate their Korean mirrors.

## 2. Diagnostics and recovery (Lane A)

- [x] 2.1 Add `rejection_observations`, `app.operator_diagnostics_snapshot`, `app.record_rejection` and `app.operator_rejection_snapshot` ([design 4](design.md#4-the-snapshot), [5](design.md#5-rejection-observations)), generate the migration, and verify `supabase db reset --local` and the grant tests.
- [x] 2.2 Add `diagnostics snapshot` and `diagnostics rejections` to the administrator CLI and rejection collection to the command pipeline. Verify unit tests for parsing and categorization and integration tests for every category, bounded deterministic samples, redaction, concurrent increments, saturation, pruning, and disabled, failing and slow collection.
- [x] 2.3 Add `operator_operations`, `app.operator_requeue_job`, `app.operator_reconcile_booking` and the `recover job` and `recover booking` commands ([design 6](design.md#6-recovery)). Verify integration tests for a requeued job that completes, a stale claim fenced out, a refused non-exhausted job, a reconciled booking after a lost response, a refused booking with a live job, confirmation and audit rows.

## 3. Data stewardship (Lane B)

- [x] 3.1 Add `scripts/restore-drill.ts` and its synthetic fixture ([design 7](design.md#7-backup-restoration)) and the runbook. Verify one drill run on the local stack and record its summary.
- [x] 3.2 Add `app.cleanup_retained_records` and its hourly schedule ([design 8](design.md#8-retention)), `app.operator_delete_host`, `app.operator_delete_request` and their commands ([design 9](design.md#9-deletion-on-request)). Verify integration tests per retention rule, the open-request guard, host deletion with the handle tombstone and the Auth user, a refused restore and a deleted request.
- [x] 3.3 Add `/privacy` in English and Korean and its links ([design 11](design.md#11-disclosures)). Verify a Playwright check of both languages and the links at 390 and 1280 pixels.

## 4. Environments and domain (Lane C)

- [x] 4.1 Add the staging messaging denial ([design 12](design.md#12-environments)). Verify unit tests for staging, release and unset origins.
- [ ] 4.2 Add `.github/workflows/deploy-release.yml` and `scripts/perf-check.ts` ([design 3](design.md#3-performance-targets)). Verify the workflow with `actionlint` when available and the statistics with unit tests.
- [ ] 4.3 Verify the root domain read-only (`vercel domains inspect`, `cf dns records list`, DNS lookup, HTTPS on both origins) and run `npm run perf:check` against production; record both.

## 5. Acceptance record (Lane D)

- [ ] 5.1 Add the release summary of AC-01 to AC-28 to the acceptance record: where each scenario's evidence is, its kind, and what is pending.

## 6. Join

- [ ] 6.1 Run `npm run check`, build, lint, typecheck, unit, integration and browser tests and `supabase test db`; record the runs.

## 7. Release (blocked on the user)

- [ ] 7.1 The release checklist in the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-8--operations-and-release), in order: empty and link the release project, set its secrets, run the release workflow, configure providers, deploy, and run the production acceptance checks.
- [ ] 7.2 Teammate review of D1–D14, then `openspec archive operations-and-release`.
