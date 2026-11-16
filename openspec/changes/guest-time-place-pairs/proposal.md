# Proposal

## Why

A guest who wants to meet in person today has to name a place before any time is found, and the candidate times all carry that one place. When the guest names no place, candidates carry none: the host's travel legs cannot be estimated, so candidates next to a commitment stay host-private, and the guest learns where to meet only after a time is agreed. The guest cannot see that one time works at the host's office while another works near a station the host also meets at, and asking for a different area has no defined outcome. [Issue #182](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/182) tracks this change, from the Iteration 4 kickoff (2026-11-08).

## What Changes

- **Time and place pairs.** When an in-person request names no place and the host's confirmed location answer lists places (a venue and up to five areas), each candidate is a pair of a time and one of those places. Every pair goes through the existing checks with its own place as the meeting place: host and requester travel legs, buffers, allowances and the unresolved rules. A time can appear with more than one place; the guest sees each pair as its own option, with the time and the place.
- **Another area.** When the guest asks to meet somewhere else, the assistant records that place as the request's place through the existing review card, and the next evaluation offers pairs at that place only. When none is feasible, the guest is told that no time works there yet and can try another area, other days, or one of the host's places, with no reason that reveals the host's calendar, commitments, travel or rules.
- **The chosen pair stays as chosen.** Choosing a pair makes a proposal with its time and its place, unchanged. Agreement's calendar recheck and booking revalidation check that same place, and the host approves and books the place the guest chose.
- **Limits.** Pairs share the existing bounds: the 40-candidate cut before the travel check counts pairs, not times, so one evaluation needs no more route estimates than before; the shared 18-second deadline still applies. An alternate-area request changes the request's details and starts an ordinary evaluation, so the existing limit of 10 new evaluations per request in any rolling hour already covers it, together with every other way of asking for times. No new limit is added.
- The assistant no longer asks a guest to pick a place when the host lists places; it asks only when the host decides the place per meeting.

Out of scope: ranking by nearby commitments ([#103](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/103), the `same-day-trips` change), sending several options to the host in one request ([#146](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/146)), and verifying that travel time changes what the guest sees ([#186](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/186)).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-feasibility`: in-person candidates without a requested place become time and place pairs from the host's confirmed places; a guest's other area is evaluated under the same checks and limits; the chosen pair's place is the one rechecked and booked.

## Impact

`lib/server/feasibility.ts` (`RequestTerms.places`, pairs in `plan()`, pair candidate IDs, the requester order), `lib/server/evaluation.ts` (the host's places as the request's places, a `place` option for fixed-interval checks), `lib/server/request-proposals.ts` and `lib/server/bookings.ts` (pass the proposal's place to the recheck), `lib/server/request-tools.ts` and `lib/contracts/feasibility.ts` (no missing place when the host lists places, the no-match message for a requested place), `agent/instructions/requester.ts`, and the PRD, guest booking flow and decision log with their `ko/` mirrors. Settings and request details are JSON; no migration.
