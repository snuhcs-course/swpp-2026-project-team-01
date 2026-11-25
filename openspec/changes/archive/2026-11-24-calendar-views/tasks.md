# Tasks

## 1. Shared grid

- [x] 1.1 Add `WeekCalendar` and its time helpers (weeks, local placement, visible hours, quarter-hour picks), with unit tests.

## 2. Host (#147, #379)

- [x] 2.1 Show the host's week beside the decision card while a time is on screen, with the proposal, suggestion, draft and open times marked over the Dashboard's events.
- [x] 2.2 Open **Request changes** with a time picked on the calendar, and mark the editor's time as it changes; cover the marks and visibility with unit tests.

## 3. Guest (#374)

- [x] 3.1 Draw **Choose a time** as a week grid (one day with a day switcher on a phone), with shared details said once and trip-dependent times dashed.
- [x] 3.1a Keep offering several times together and the guest-host notes (#426, #60) in a list under the grid, and tag ticked times on it.
- [x] 3.2 Add `GET /api/requests/{bookingId}/busy` and draw the guest's own busy times under the offered times; cover the busy rules and the times-only answer with unit tests.

## 4. Documents and acceptance

- [x] 4.1 Update DESIGN.md and the page list, and regenerate `ko/DESIGN.md`.
- [x] 4.2 Run the guest and host browser journeys (`tests/e2e/requester-intake.test.ts`, `requester-google.test.ts`, `host-review.test.ts`) against the local stack.

## Archive note

Archived on 2026-11-24 with the code on `main` (pull request #440). The unticked tasks above stay open: each needs a person (a teammate review, a real device or messenger, a console, deployment or production check, or a paid model run) or a run of the local integration and browser suites, which this archive did not do. Their issues stay open with `Part of`.

Task 4.2 was run on 2026-11-25 against the local stack (#147). `host-review.test.ts` gained a journey at 390 and 1280 px: the host's calendar shows a Google event and the proposed time, and a click at 14:00 on the proposal's day opens **Request changes** with that date and time filled in, marks it as the new time and shares nothing. `requester-google.test.ts` passes. In `requester-intake.test.ts` the **Choose a time** grid steps pass; its later composer check (two buttons in the composer after agreement) fails on `main` independently of this change.
