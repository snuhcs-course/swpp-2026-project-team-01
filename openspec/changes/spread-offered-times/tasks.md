# Tasks

## Feasibility

- [x] Add `spreadOrder` and use it in `plan()` for every search; remove the default search's `spreadDays` input.
- [x] Spread the ranked times in `applyRanking` in the requester's zone.
- [x] Cover a week, one day, the weekly-limit tier, place pairs and a clustered ranking in the feasibility unit tests; update the tests that read the order as time order.

## Applying a review

- [x] Return `findTimes` from `request.apply_review` with `readyForTimes`, and use the same rule in `apply_request_review`.
- [x] Find times on the review card from `findTimes`; cover the helper and the rule in unit tests and the apply result in the request reviews integration test.

## Documents and review

- [x] Update the guest booking flow (G3 and G6).
- [ ] Regenerate the Korean mirror of the guest booking flow.
- [ ] Review with the team, then archive the change into `openspec/specs/meeting-feasibility/spec.md` and close #241 and #242.
