# Design

## 1. The host's usual place

`HostRules.usualPlace` is the first named area, else the venue, of a host whose location is a list of places; a host who decides the place per meeting has none. It is the same place the same-day trip rank measures from, but it does not depend on **Group trips by day**.

`planLeg` takes a host commitment whose endpoint is `unknown` with reason `no_location` to be at the usual place, so the leg becomes an ordinary route query from or to it, with the host's mode, before and after buffers and travel buffer. The same place as the meeting gives `same_place`, zero minutes plus the buffers. The leg carries `usualPlace: true` and the basis says "which has no location, so from your usual area". The usual place's text never enters the stored legs, only its keyed hash.

All-day events and the times a host excluded are all-day intervals and never anchor a trip, so nothing changes for them. A commitment with a conference link keeps its leg unresolved: the meeting-feasibility scenario "Previous meeting was online" still holds, because the host may be anywhere. A requester has no usual place, so their legs keep the earlier rule and resolve through an allowance (section 2).

Rejected: treating an unresolved leg as fitting when the host's travel buffer covers it. Missing estimates never count as zero travel, and a route from the usual place is a real estimate.

Rejected: offering host-unresolved times to the guest. The host's trip has to be known or allowed before a time is offered.

Not decided here: whether Google Routes returns driving or walking routes in South Korea. If it does not, a host who drives still gets `no_route` for every trip there; server logs for 2026-11-20 would show it, and the host can allow minutes for those trips.

## 2. Allowances for an endpoint without a place

`legEndpointKey` names a place by its keyed hash and an unknown endpoint as `unknown:<reason>`. `CandidateLeg.originKey` and `destinationKey` use it, and `matchingAllowance` compares the same keys, so `request.allow_trip` and `request.allow_host_trip` accept these legs (they still need a travel mode and a meeting place). An allowance remains bound to one leg of one candidate. When the event gains a place its key becomes the place's hash and the allowance no longer matches, which is the "void when either endpoint changes" rule. A different event without a place at the same position takes the same key; it is the same unknown trip for the same candidate.

The keys are not route queries: `legQuery` returns none for an unresolved leg, so the Routes cache never sees them.

## 3. A guest-host's preferences

`FeasibilityInput.requesterPreferences` holds the guest-host's timezone, weekly windows, weekly limit and `weekCounts`, the meetings already in each of their weeks keyed by the Monday that starts it in their timezone. `evaluate` fills it when `readGuestHostSource` returns the guest-host (they chose **Calendars**), counting their live bookings for other requests and, when they count every meeting, the meetings on their conflict calendars, as the host's own limit counts.

`plan()` adds the guest-host's keys to the guest score: 0.5 inside their weekly windows and 0.25 in a week below their limit. The request's stated preferences move the score in whole steps, so they come first; the host's keys (20 for the weekly limit, 6 for the trip rank) still outweigh every guest signal, since the score stays within [-3, 2.75]. The spread then works within each tier as before, and the retention of non-preferred alternatives covers the new keys. No candidate is removed.

The guest-only sentences ("Inside your usual Monday hours 12:00–13:00.", "That week has 1 of your 3 weekly meetings.") are returned as `FeasibilityResult.requesterNotes` by candidate ID and go only into the requester projection's `RequesterCandidate.notes`, which the times card shows under each time. They are not in the candidate's basis or anywhere in the host's record, consistent with guest-flow-completion design 6 ("Nothing about the guest-host reaches the request's host"); the host sees only the order.

The model ranking is skipped when the preferences are present, as for stated preferences, so it cannot lift a time outside the guest-host's hours over one inside them. The nearest-open-times search leaves the preferences out, as it leaves out the stated ones.

The preferences ride on the **Calendars** item rather than a new **Preferences** item: the week counts come from those calendars, and a new item would need a schema change to `requester_host_profiles.items`. The card's Calendars line says the times in their usual hours and lighter weeks come first.

## 4. Tests

Unit tests in `lib/server/feasibility.test.ts` reproduce #324 (they fail on the earlier engine): a no-location commitment is estimated from the usual place, needs no trip at the usual place itself, still gets the buffers, a conference link stays unresolved, and requester and host allowances resolve legs to commitments without a place and are void once the event gains one. #60's tests cover a preference never removing a candidate, the order inside hours and below the limit, hours ahead of the limit, the host's limit ahead of both, stated preferences ahead of standing ones, and the guest-only notes. `lib/server/evaluation.test.ts` covers the usual place and the guest-host's week counts.
