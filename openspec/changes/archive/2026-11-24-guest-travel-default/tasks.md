# Tasks

## Feasibility

- [x] Add the default requester travel mode (public transit) to the request contract and use it for requester legs when the guest named none.
- [x] Cover the default, a named mode, and unchanged host legs in the feasibility unit tests.

## Guest screen

- [x] Remove the travel question from the meeting details card; keep showing a mode the guest named in the review rows.
- [x] Cover the card without the question in a component test.

## Documents and review

- [x] Update the product requirements' travel-time checks and the guest booking flow, and regenerate their Korean mirrors.
- [ ] Review with the team, then archive the change into `openspec/specs/meeting-feasibility/spec.md` and close #199.

## Archive note

Archived on 2026-11-24 with the code on `main` (pull request #440). The unticked tasks above stay open: each needs a person (a teammate review, a real device or messenger, a console, deployment or production check, or a paid model run) or a run of the local integration and browser suites, which this archive did not do. Their issues stay open with `Part of`.
