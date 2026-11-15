# Tasks

## 1. Mandatory message handoff

- [ ] 1.1 Gate incomplete hosts at `/app` behind channel selection, sender verification and a visible retry state; verify TypeScript typecheck and the link flow test.
- [x] 1.2 Update English and Korean UI copy and the post-link app action; verify the three configured channel paths and that no web setup bypass is offered.
- [x] 1.3 Update link-flow browser tests for the choice-first experience and required handoff; verify the focused test run or document any environment blocker.

## 2. Product documentation

- [x] 2.1 Update the English host onboarding flow and PRD to state that Google sign-in leads to required messaging link and message-led setup; verify `npm run check:docs`.
- [ ] 2.2 Update the required Korean documentation mirrors from the English changes and verify `npm run check:docs`.

## 3. Integration

- [x] 3.1 Run lint, typecheck and OpenSpec validation; fix regressions and record any external provider validation still pending.
