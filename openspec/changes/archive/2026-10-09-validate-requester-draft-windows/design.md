# Design

## Context

See [proposal](proposal.md). `fmat.propose_request_details` locks and authorizes the request, resolves an existing retry, checks revision and calls `normalize_details` before superseding a pending review. Normalization rejects ended windows but permits an ongoing interval and does not compare duration. `fmat_request_detail_review` locks the request/review and resolves recorded decisions before applying through `fmat_command`.

## Goals / Non-Goals

**Goals:** restore the lost extractor guards at the authoritative review boundary, preserve atomic denial and retries, and verify both merged duration and elapsed time after locks.

**Non-Goals:** alter manual intake/availability normalization, infer a missing duration, rewrite existing reviews, or solve model prose/status narration. No provider or model call is needed.

## Decisions

1. Add a private, explicitly revoked validator for normalized review details, or equivalent bounded inline validation if pg-delta review favors that form. It checks every start against `clock_timestamp()` and every interval against a known duration. A transaction-start `now()` is insufficient after lock waits. Preserve existing parsing/offset/order normalization first.
2. Invoke validation after exact-retry lookup and merged normalization, before superseding/inserting a review. A duration-only patch validates retained windows against its new duration. This preserves partial patches and does not require a duplicate client context read.
3. Invoke the same validation only for a new apply decision, after locks and before domain mutation. Exact committed apply/dismiss and proposal retries preserve their recorded outcome. Dismissal stays available for stale time windows.
4. Do not backfill or delete existing pending reviews. Apply-time validation safely fences them. Existing authorization, revision, contact invalidation and idempotency behavior remain authoritative.
5. Model clarification/status prose and requester context privacy are independent audit obligations; stronger window validation cannot close them.

## Risks / Trade-offs

- A previously displayed review can expire before apply → retain the pending review for dismissal/replacement and return the existing safe invalid-input error.
- Known duration may come from current details rather than patch → test inherited, changed and absent durations separately.
- A denied replacement could accidentally supersede the previous review → assert the complete previous review and request snapshot are unchanged.
- Test lock waits can be flaky → coordinate lock acquisition explicitly and use bounded waits; do not weaken the wall-clock assertion.

## Migration Plan

Use pinned Supabase 2.119.0 pg-delta to generate a reviewed migration from declarative SQL. Rebuild the disposable local stack, run SQL plus real RPC/concurrency acceptance and post-fixture SQL without reset, application checks and builds. Review the selected remote project's pending migration dry run before applying. Verify function definitions/privileges and rollback-only remote acceptance, then deploy a scanned clean archive if application changes require it. Record exact production evidence before syncing and archiving. Rollback requires a new reviewed migration; never rewrite history or reset remote state.
