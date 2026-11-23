# Tasks

## 1. Tool

- [x] 1.1 Add `splitStatedPatch` to `lib/server/request-reviews.ts`: stated fields apply, inferred time or mode, conflicting values, windows under a held length and contact fields are held. Verify with unit tests.
- [x] 1.2 In `draftRequestReviewForTool`, validate the whole draft, apply the stated part at once, leave the held part as the one pending review, return `appliedFields`, and find times only when nothing is held; add the `inferredMode` input. Verify typecheck.
- [x] 1.3 Update the request-tools and request-reviews integration tests for explicit, inferred and conflicting details.

## 2. Instructions and descriptions

- [x] 2.1 Update the `draft_request_review` description and the requester fragment: say in one line what was applied and that the guest can change it in words; set `inferredMode` for in person taken from a place.
- [x] 2.2 Update the requester MCP's `update_request_details` description to pass what the person stated and confirm inferred values first.

## 3. Documentation and evaluation

- [x] 3.1 Update the testing baseline (W-6, W-6.1, W-7, W-8.4), the guest booking flow (G3), the page list and the agent configuration.
- [x] 3.2 Change the guest story cases that expected a review card for stated details, append cases for explicit, inferred and conflicting details, and record them in documentation 13.
- [ ] 3.3 Run the request-tools and request-reviews integration suites and the requester browser test against a local Supabase stack. Not run in this pull request: the laptop's local stack is shared by other sessions; the owner runs them on `main` after the batch merges.
- [ ] 3.4 Run the guest story set three times for the changed and appended cases. Needs a paid model run.

## 4. Archive

- [x] 4.1 Archive this change into `meeting-requests`.
- [ ] 4.2 Teammate review.
