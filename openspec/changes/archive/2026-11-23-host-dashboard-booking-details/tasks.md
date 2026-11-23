# Tasks

## 1. Pending decisions on the workspace menu (#295)

- [x] 1.1 Count received requests that need a decision from `/api/host/requests` in the workspace menu, reload on focus, menu open and a request change in the tab, and keep the last count on a failed read.
- [x] 1.2 Show the round red count on the menu button and the Requests item with an accessible label; cover the count, the 9+ cap and the hidden-when-zero badge with unit tests.

## 2. Booked meeting details on the Dashboard (#298)

- [x] 2.1 Join each confirmed booking's proposal and request in the Dashboard projection and carry length, mode, join link, guest and request; share the join-link rule with the booking receipt. Cover online, requester link, in-person and unconfirmed-address cases with unit tests.
- [x] 2.2 Show When · Length · Mode · Place or Meeting link · With (and Purpose) and **Open request** in the details pane, and the guest next to the time in week blocks; cover the labels with unit tests.

## 3. Documents and acceptance

- [x] 3.1 Update DESIGN.md, the page list and the testing baseline (H03 W-1, H04 W-3).
- [x] 3.2 Regenerate the Korean mirrors of the changed documents (`ko/DESIGN.md` and the testing baseline; the page list has no Korean mirror).
- [x] 3.3 Run the Dashboard and Requests browser journeys and `tests/integration/workspace-requests.test.ts` (which now books an online and an in-person meeting and reads them back through the Dashboard) against the local stack.
  Passed on 2026-11-23: `tests/integration/workspace-requests.test.ts` 7 of 7 and `host-requests.test.ts` 11 of 11; the browser suite with `PORT=3200` (another local app held port 3100): 89 passed, 7 failed under parallel load and passed again on one worker, 1 skipped, the host review, host setup and host-as-guest journeys among the first-run passes.
- [ ] 3.4 Review with the team, then archive the change into `openspec/specs/chat-workspaces/spec.md`.
  Skipped: merged and archived without a teammate review at the repository owner's request on 2026-11-23.
