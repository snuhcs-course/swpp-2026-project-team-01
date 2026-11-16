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

### 6. The setup field

`groupTrips` is a setup field like `weeklyLimitCounts`: a boolean in `SETUP_FIELD_SCHEMAS`, starter default `false`, drafted by `draft_settings`, accepted on its card and saved on confirmation. It is part of the proposal only for an in-person or either mode (`IN_PERSON_OPTIONAL_FIELDS`), and a confirmed online-only policy reads as having none, so an online host never sees a pending change from it. A policy confirmed before the field existed reads as off, labeled starter default. The web shows it as its own step, **Group trips by day**, after the travel buffer and only when the location is not decided per meeting, since without a preferred area the policy does nothing. The review card shows it under the same condition and the linked-chat settings review whenever the mode is in person or either. The chat setup does not ask about it: like the other settings it keeps its suggestion unless the host brings it up.

Rejected: an `IN_PERSON_FIELDS` member | those are required answers, and this one is optional. Rejected: saving it only when the location has places | a host who later names places would find it silently off.

### 7. The suggestion

Calendar analysis adds a `trips` dimension with counts only: the local days with a busy, timed in-person event (a location and no conference link), and the days with such an event at a place other than the most frequent one where that place also holds an in-person event on another day. A place is the event's area (the text after the first comma), or its venue when there is none, compared without case. With at least two such days the suggestion is on, labeled inferred, with the in-person days as its sample size and a reason that names no place; otherwise it is the starter default off. It is policy only once the host accepts it and confirms.

Place text stands in for distance because the scan asks no route estimates and the preferred area is a host answer the scan does not know yet; with the policy on, feasibility decides far and near from route estimates (decision 2). The most frequent place stands in for the preferred area for the same reason.

Rejected: route estimates during the scan | Routes calls for every scanned trip, before the host has named a preferred area. Rejected: comparing with the host's answered location | the suggestion is computed from the scan alone, like every other one, and would change when the location answer changes.
