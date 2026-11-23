# Tasks

## Feasibility

- [x] Add `HostRules.usualPlace` and estimate a no-location host commitment's trip from or to it; keep conference links unresolved.
- [x] Key legs to commitments without a usable place as `unknown:<reason>` so requester and host allowances match them.
- [x] Add `requesterPreferences` to `FeasibilityInput`, order inside the guest-host's weekly windows and then below their weekly limit after the host's keys and the stated preferences, and return guest-only `requesterNotes`.
- [x] Cover #324 and #60 in the feasibility and evaluation unit tests.

## Evaluation and screens

- [x] Fill `usualPlace` and the guest-host's preferences and week counts in `evaluate`; skip the model ranking with them; leave them out of the nearest-open-times search.
- [x] Carry the notes in the requester projection and show them on the times card; say on the Calendars item that usual hours and lighter weeks come first.

## Documents

- [x] Update the guest booking flow (G4a and G6); it has no Korean mirror to regenerate.
- [x] Mark guest-flow-completion tasks 7.1 and 7.2 done here.
