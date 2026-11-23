# Tasks

## 1. Pending decisions on the workspace menu (#295)

- [x] 1.1 Count received requests that need a decision from `/api/host/requests` in the workspace menu, reload on focus, menu open and a request change in the tab, and keep the last count on a failed read.
- [x] 1.2 Show the round red count on the menu button and the Requests item with an accessible label; cover the count, the 9+ cap and the hidden-when-zero badge with unit tests.

## 2. Booked meeting details on the Dashboard (#298)

- [x] 2.1 Join each confirmed booking's proposal and request in the Dashboard projection and carry length, mode, join link, guest and request; share the join-link rule with the booking receipt. Cover online, requester link, in-person and unconfirmed-address cases with unit tests.
- [x] 2.2 Show When · Length · Mode · Place or Meeting link · With (and Purpose) and **Open request** in the details pane, and the guest next to the time in week blocks; cover the labels with unit tests.

## 3. Documents and acceptance

- [x] 3.1 Update DESIGN.md, the page list and the testing baseline (H03 W-1, H04 W-3).
- [ ] 3.2 Regenerate the Korean mirrors of the changed documents.
- [ ] 3.3 Run the Dashboard and Requests browser journeys and `tests/integration/workspace-requests.test.ts` against the local stack.
- [ ] 3.4 Review with the team, then archive the change into `openspec/specs/chat-workspaces/spec.md`.
