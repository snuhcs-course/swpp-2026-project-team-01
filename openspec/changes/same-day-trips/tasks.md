# Tasks

## 1. Engine

- [x] 1.1 Add `groupTrips` to `ConfirmedSettings` with `groupTripsOf`, and `HostRules.preferredArea`. Verify typecheck.
- [x] 1.2 Rank in-person candidates by day in `plan()` after the weekly limit, expose `tripQueries`, and add the host basis sentence. Verify with unit tests: no candidate is removed; the order with and without a nearby same-day commitment; a preferred-area day comes last; the weekly limit still wins; online meetings and missing estimates are unaffected; no basis or place reaches the requester projection.
- [x] 1.3 Estimate the trip queries before the travel check in `lib/server/evaluation.ts` under the shared deadline, falling back to no rank on a non-deadline failure. Verify typecheck and the evaluation integration suite.

## 2. Setup and review

- [x] 2.1 Make `groupTrips` a setup field with the starter default off, through the draft, confirmation, the agent's setup tools, the web review card and the iMessage settings review.
- [x] 2.2 Suggest it from calendar analysis when the scan shows in-person days far from the preferred area that could share a day (Use this, Adjust, Choose my own); it becomes policy only after the host confirms.
- [x] 2.3 Update the PRD's calendar analysis dimensions and FR-12, the host onboarding flow and the decision log, and regenerate their `ko/` mirrors. Verify `npm run check`.

## 3. Archive

- [ ] 3.1 After merge and verification on the shared deployment, archive this change into `meeting-feasibility`.
