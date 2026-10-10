# Design

## Context

See proposal.md for the restored behavior. `weeklyWindow` currently requires start < end, and both `fmat.validate_setup_patch` and the review-completeness validator `fmat.validate_rules` repeat that condition in SQL. `evaluateIntervals` expands only dates within each requested interval, so merely relaxing validation would omit the previous day's overnight tail. Setup guidance prints unqualified start/end clocks. Current validators admit only same-day windows; inspect existing stored rules before rollout rather than assuming historical rows share that invariant.

## Goals / Non-Goals

**Goals:** restore one weekly window spanning at most one local midnight consistently across setup, persisted rules, time filtering and host review.

**Non-Goals:** full-day equal-clock shorthand, multiple-day windows, changes to the busy/focus buffer policy, sampling alignment, online travel, or legacy physical-context APIs.

## Decisions

- Preserve `{days,start,end}`. An earlier end means next local date; an equal end rejects. This restores the old convention without adding a second representation or rewriting existing data. An explicit end-day field would require wider protocol and stored-shape migration for no additional bounded behavior.
- Expand each requested date plus its preceding local date, deduplicated, and intersect afterward. Only the starting weekday owns the window, including Saturday/Sunday rollover. Do not expand the entire span between far-apart request windows.
- Construct start and next-day end in the host timezone independently with the existing rejecting local-time converter. Never add 24 elapsed hours: DST can change the duration. Existing ambiguity handling returns clarification instead of a guessed boundary.
- Keep buffer expansion around busy/focus commitments, and preserve exact elapsed duration and half-open intersections. Do not reinterpret unrelated legacy differences as part of this restoration.
- Use one shared display convention for end < start: `22:00–02:00 (+1 day)`. Apply it to exact-value editors, draft/final reviews and weekly previews. An editor should explain that earlier end clocks mean the next day; equal clocks show an actionable validation error.
- Test both positive overnight persistence and unchanged-state rejection through real setup operations. A pure helper test cannot prove the SQL or confirmation path accepts the contract.

## Risks / Trade-offs

- [Previous-day expansion adds irrelevant ambiguous boundaries] → Only consider weekly windows that can intersect the requested local date span; verify unrelated-day ambiguity does not suppress available windows.
- [Mixed application/schema rollout] → Deploy the additive SQL validator first, then the application; old code continues accepting only its known same-day subset until promotion.
- [Rollback after saving overnight rules] → Do not revert SQL validation or redeploy a parser that rejects already saved overnight settings. Prefer a forward fix; preserve saved host choices.
- [Dense windows or widely separated dates] → Keep current per-window bounds and deduplication; add distant-window coverage and compare full interval results.

## Migration Plan

Edit the declarative validator, generate and review a new pg-delta migration with pinned CLI, rebuild the disposable local chain, then run SQL and real setup/evaluator/browser tests. Review a selected-production dry run before applying the additive validator. Deploy a scanned clean committed archive, verify the exact alias and HTTP guards, and use rollback-only production SQL evidence for overnight acceptance. Sync/archive only after all tasks pass.
