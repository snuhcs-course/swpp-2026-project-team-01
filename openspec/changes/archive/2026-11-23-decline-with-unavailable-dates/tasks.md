# Tasks

## Command

- [x] Add `lib/contracts/declined-dates.ts` (real dates, whole days in a zone, appending once and leaving out ended days) with unit tests.
- [x] Accept `excludedDates` in `request.decline` and store the days on the closed request's `details.excludedTimes`; nothing for a decline that keeps a booked meeting. Integration test in `tests/integration/bookings.test.ts`.

## Surfaces

- [x] The date field beside **Decline request** on the proposal review card.
- [x] `decline <ref> YYYY-MM-DD …` in the host's linked conversation, its reply in English and Korean, and the help example; parser unit tests.
- [x] `excludedDates` on the host review `decline_request` tool and the agent-access MCP tool, with the host-imessage instructions; schema unit tests and the appended host review story case RV-D01.

## Documents and review

- [x] Record RV-D01 in the story path evaluation's appended cases.
- [x] Run the integration tests, the browser tests and the host review story eval (RV-D01) against the local stack.
  Passed on 2026-11-23: `tests/integration/bookings.test.ts` 21 of 21; the browser suite with `PORT=3200` (another local app held port 3100): 89 passed, 7 failed under parallel load and passed again on one worker, 1 skipped; RV-D01 3 of 3 runs in the host review story set (documentation 13, Release runs).
- [ ] Review with the team, then archive the change into `openspec/specs/meeting-requests/spec.md` and close #58.
  Skipped: merged and archived without a teammate review at the repository owner's request on 2026-11-23.
