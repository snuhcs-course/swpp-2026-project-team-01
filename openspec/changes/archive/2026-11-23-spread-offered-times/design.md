# Design

## 1. The spread

`spreadOrder` takes a list already in preference order and a tier for each entry (the weighted host and guest preference in `plan()`). It never moves an entry across a tier. Within each run of equal tier it works in rounds: walking the remaining entries in order, a day takes the entry when it has taken nothing yet in this round and the entry starts at least `SPREAD_MINUTES` (120) from every time that day already took. An entry at a time already taken (the same time paired with another place) follows it at once. When a round takes nothing, the rest keep their order at the end of the run.

Days are the guest's local days (`request.timezone`), as the default search's day spread used. Over a week with hours 10:00 to 17:00 the order is each weekday's 10:00, then each weekday's 12:00, 14:00 and 16:00, then the remaining quarter hours in time order, so the first three offered times fall on three days and **Find other times** keeps moving across the week.

The spread runs before the cut to `CANDIDATE_LIMIT`, so the times kept for the travel check cover the range rather than its first day. It replaces the default search's `spreadDays` rank, which did the first part (each day's first start before any day's second) for the default range only.

Rejected: spreading only ranges longer than a day. A one-day window ("Monday, any time") clusters the same way, and the gap spreads it across the day.

Rejected: offering a fixed number of times per day. The tiers already carry the host's preferences, and a count would cut times the guest could take.

## 2. Ranking

The ranking model may still reorder the first `RANKING_LIMIT` valid times. `applyRanking` with the requester's zone spreads the ranked times as one tier, the ranking's order breaking ties, then appends the rest in their deterministic order as before. The ranking instructions are unchanged, so no eval needs updating; the spread is deterministic and covered by unit tests.

## 3. Applying a review

`request.apply_review` returns `findTimes`: `readyForTimes(state, details)` over the state and details it wrote, the rule `apply_request_review` already used (not a draft, with a length and a form). The review card calls `request.evaluate` when it is true. The card no longer reads its own view after the apply, which the apply's refresh has already replaced, and no longer requires a purpose the server does not.
