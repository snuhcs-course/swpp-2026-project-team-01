# Tasks

## 1. Contract and interval evaluation

- [x] 1.1 Allow start/end inequality in the shared weekly contract and expand overnight hours with previous-day ownership. Add failing-then-passing tests for overnight tails, weekday/week rollover, host/requester timezone differences, midnight ends, equal-clock rejection, overlaps, distant windows, both DST transitions and unrelated ambiguous dates. Preserve same-day and full-interval/buffer controls; update architecture/test documentation, run focused tests and typechecks, and commit.

## 2. Durable setup and host display

- [x] 2.1 Update declarative setup validation, generate/review the migration with pinned pg-delta, rebuild the disposable local chain, and test overnight persistence plus equal-clock unchanged-state denial through SQL and actual setup draft/confirmation. Update schema evidence/setup documentation and commit after post-fixture SQL passes.
- [x] 2.2 Label next-day ends in weekly editors, guidance, draft/final reviews and previews. Verify the built browser can edit, reload, review and explicitly confirm overnight hours without interpreting equal clocks as all-day; inspect mobile/keyboard rendering. Update UX/test documentation and commit.

## 3. Production completion

- [x] 3.1 Run full application checks, both builds, runtime and relevant setup/evaluator/browser integrations sequentially; verify existing saved-rule compatibility, selected-production migration dry run, additive rollout and rollback-only overnight SQL acceptance. Record exact migration/function evidence and commit.
- [ ] 3.2 Deploy a scanned clean committed archive, verify Ready health, promotion, exact release alias and production HTTP guards, then update the implementation plan, reconcile the legacy overnight assertion, sync and archive only the verified requirements. Keep wider legacy/provider/client gates explicit and commit the evidence.
