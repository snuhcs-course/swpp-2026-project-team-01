# Design

## Context

See [proposal.md](proposal.md). The feasibility engine (`lib/server/feasibility.ts`) is pure: the evaluation job reads calendars and route estimates and passes them in. Route estimates are asked for in one pass (`travelQueries`, then `estimateTravel`, then `evaluateFeasibility`), cached in `app.route_estimates` for 24 hours by endpoint hashes, mode and 15-minute departure slot. Event titles, attendees and locations never leave the module.

## Decisions

### 1. The policy and the preferred area

`ConfirmedSettings.groupTrips` is an optional boolean; `groupTripsOf(settings)` reads an absent key as `false`, like `weeklyLimitCountsOf`. The preferred area is the host's confirmed location answer: the first named area, or else the venue. Without a places answer, the policy does nothing. The evaluation passes it to the engine as `HostRules.preferredArea` (text and keyed hash), or `null` when the policy is off.

### 2. Far, near and the day rank

The rank applies only when the meeting is in person with a known place, the host's travel mode is driving, transit or walking, and the place is not the preferred area itself. With the meeting place M and preferred area A, and the host's timed in-person commitments (a place and no conference link) on each candidate's local day in the host timezone:

- M is **far** when the estimate from A to M exceeds `TRIP_FAR_MINUTES` (30). Otherwise, or when that estimate is missing, no day is ranked.
- A day is **already out that way** (rank first) when one of its commitments is within `TRIP_NEAR_MINUTES` (15) of M.
- A day is **in the preferred area** (rank last) when it has commitments and every one is within `TRIP_NEAR_MINUTES` of A.
- Every other day, and any day whose estimates are missing, keeps the middle rank.

Each commitment is estimated to M and to A departing at its end; A to M departs at the first free candidate's start. These are the departures the travel check already uses for a commitment before the meeting, so many estimates are shared. At most `TRIP_COMMITMENT_LIMIT` (16) commitments, earliest first, are estimated, which bounds the extra Routes calls; days past them keep the middle rank.

Rejected: straight-line distance | it disagrees with the travel check across rivers, ridges and transit gaps, and needs coordinates the module never stores. Rejected: a model-ranking signal | ranking never sees locations, by design.

### 3. Where the key sits

The ordering is weekly limit, then trip rank, then the guest's preference score, then (over the default range) the day spread, then start. In the weighted sort this is `20 × belowLimit + 6 × tripScore + score`, with `tripScore` in {1, 0, −1} and the guest score in [−3, 2], so each level strictly outweighs the next. Keeping a few non-preferred alternatives replaces an entry only within the same weekly-limit and trip level. The key is applied before the 40-candidate cut, so the favoured days are the ones kept and checked for travel. Like the weekly limit, the host's trip preference comes before the guest's softer signals.

### 4. Two Routes passes

`tripQueries(input)` returns the trip estimates the rank needs. The evaluation estimates them first, then runs `travelQueries` with those estimates in hand (so the cut is made on the ranked order), estimates what is still missing, and evaluates with both. Both passes run under the shared deadline. A failure in the trip pass other than the deadline leaves the order unranked rather than failing the evaluation.

### 5. Explanations

The host's basis gains one sentence when the rank applies, naming minutes only, never an event or a place. Requester projections carry no basis, so nothing reaches the requester.
