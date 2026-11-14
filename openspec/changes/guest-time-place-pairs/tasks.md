# Tasks

## 1. Engine

- [x] 1.1 Add `RequestTerms.places`, pair free times with each place in `plan()` (legs per pair's place, order by start then place, the cut counting pairs), give pairs `-p<index>` IDs and their place as `location`, and list each time's first offered pair first in `requesterProjection`. Verify with unit tests: two places give two pairs per time; travel decides which pair is offered; a requested place keeps its IDs and order; the cut counts pairs; the projection shows distinct times first.

## 2. Evaluation, proposals and booking

- [x] 2.1 Pass the host's confirmed places as `request.places` in `lib/server/evaluation.ts` when the request names no place, and add `EvaluateOptions.place` for fixed-interval checks. Verify typecheck and the evaluation integration suite.
- [x] 2.2 Pass the proposal's place to agreement's recheck (`lib/server/request-proposals.ts`) and booking revalidation (`lib/server/bookings.ts`). Verify with an integration test that choosing, agreeing to and booking a pair keeps its time and place.

## 3. Guest conversation

- [x] 3.1 Stop listing the place as missing when the host lists places, and give the no-match message for a requested place outside the host's places (`lib/server/request-tools.ts`, `lib/contracts/feasibility.ts`). Verify with unit tests.
- [x] 3.2 Update `agent/instructions/requester.ts`: times come with the host's places, another area is drafted as the request's place, and no unlisted place is called approved.

## 4. Documents

- [x] 4.1 Update the PRD's place sentences and FR-12, the guest booking flow (G3 and the times card) and the decision log, and regenerate their `ko/` mirrors. Verify `npm run check`.

## 5. Archive

- [ ] 5.1 After merge and verification on the shared deployment, archive this change into `meeting-feasibility` with `Closes #182`.
