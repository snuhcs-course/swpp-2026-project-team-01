# Proposal

## Why

Hosts who meet people in person lose time to trips across town. Today the feasibility engine orders candidates by the host's weekly limit, then (over the default search range) spreads them across days, then by start time. It never asks whether the host is already out that way on a given day. A meeting far from the host's usual area can be offered on a day the host would otherwise spend near home, while a day that already has a trip out is not favoured. [Issue #103](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/103) tracks this change.

## What Changes

- A new host policy, **group trips by day** (`groupTrips`, off by default and on every policy confirmed before it existed). It is a preference, never a filter.
- With it on, for an in-person meeting whose place is far from the host's preferred area, the engine offers first the days that already hold an in-person commitment near the meeting place, and last the days the host spends in the preferred area. "Far" and "near" come from the same Google Routes estimates as the travel check, with the host's travel mode, and reuse the 24-hour estimate cache.
- The new key comes right after the weekly-limit key: the weekly limit still wins, the key never removes a candidate, and spreading across days applies only among days of equal rank. Online meetings, unknown meeting places, a travel mode of Depends on the trip, and estimates that are missing or failed leave the order as it is.
- The host's private basis explains the rank (for example, that they are already near the meeting place that day). The requester sees only the times (FR-14).
- Setup asks it as its own step, **Group trips by day**, for in-person hosts with places, and suggests it on when calendar analysis shows trips to one place away from the usual one on separate days (Use this, Adjust, Choose my own). The web review, the agent's setup tools and the linked-chat settings review show it. It becomes policy only after the host confirms.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-feasibility`: a same-day trip preference orders in-person candidates after the weekly limit.
- `host-setup`: the trip preference is a setup field with an evidence-based suggestion.

## Impact

`lib/server/feasibility.ts` (a trip rank in `plan()`, `tripQueries`, basis sentences), `lib/server/evaluation.ts` (a first Routes pass for the trip queries under the same deadline, before the travel check), `lib/contracts/setup.ts` (`groupTrips` on `ConfirmedSettings` and `groupTripsOf`), `lib/server/analysis.ts` (the `trips` evidence and suggestion), the setup field through `lib/server/setup.ts`, `setup-commands.ts`, `setup-tools.ts` and `imessage-commands.ts`, the web setup step and review, and the PRD, onboarding flow and decision log. Settings are JSON, so no migration. An evaluation with the policy on can spend a few more Routes calls; most of them are the same trips the travel check asks for.
