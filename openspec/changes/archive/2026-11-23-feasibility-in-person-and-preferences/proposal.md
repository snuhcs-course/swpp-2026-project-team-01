# Proposal

Tracking issues: #324 (in-person requests find no times, and **Allow N minutes for my trip** fails) and #60 (order candidates by the guest-host's weekly windows and weekly limit).

## Why

On 2026-11-20 a guest asked host `haisung-choi6` for an in-person meeting near 서울대, inside the host's area 관악구, on Monday to Thursday. Every day came back "No times found yet", although the host had many free hours (#324). Only Friday offered times: its adjacent commitment was a booking with a place. On the other days the host's commitments had no location, and the engine left every travel leg next to such a commitment unresolved. An unresolved host leg keeps a time from the guest, and the leg is checked against the nearest commitment that day whatever the gap, so one class or lunch without a location hid the whole day.

In the same session a signed-in host booked another host with their own host calendars. Each time depended on a trip to the guest's next event, which had no location. **Allow 30 minutes for my trip** answered "This cannot be done with the current details": an allowance names both endpoints by their keyed hash, and an event without a place had none, so `request.allow_trip` rejected every such leg. The host's own **Allow N minutes for this trip** had the same gap. The allowance was never usable for the most common unresolved trip.

A guest who is a host can use their host settings for a request (guest-flow-completion design 6). Their weekly windows and weekly limit were meant to order the times as soft preferences (design 7, tasks 7.1 and 7.2), which moved to #60 because the request's host sees the same order.

## What Changes

- A host commitment with no location at all (no place and no conference link) is taken to happen at the host's usual place: the first named area, else the venue, when the host has one. Its trip is estimated from or to that place with the host's travel mode and the usual buffers; the same place needs no trip. A commitment with only a conference link, or with both a place and a link, stays unresolved, and so does every no-location commitment of a host without a usual place. The host's basis says the usual area stood in.
- A leg next to a commitment without a usable place names that endpoint by why it has none (`unknown:no_location`, `unknown:conference_only`, `unknown:place_and_link`). The requester's **Allow N minutes for my trip** and the host's **Allow N minutes for this trip** then work for these legs; the allowance is void once the event gains a place, because its key changes.
- For a guest who is a host and chose **Calendars** on **Use your host settings for this request**, the times are ordered after the host's own keys and the request's stated preferences: inside the guest-host's own weekly windows first, then weeks below their own weekly limit first. Their limit counts their Find Me a Time bookings, and their other meetings too when they count every meeting, in their own timezone. Nothing is removed. Each offered time carries guest-only sentences that explain the order; the host's record and projection never carry them. The model ranking is skipped for such a request, as it is for a request with stated preferences, so it cannot undo the order.

## Capabilities

### Modified Capabilities

- `meeting-feasibility`: no-location host commitments are taken to be at the host's usual place, allowances cover legs whose commitment has no place, and a guest-host's weekly windows and weekly limit order candidates.

## Impact

`lib/server/feasibility.ts` (`HostRules.usualPlace`, `RequesterPreferences`, the leg endpoint keys, `requesterNotes`), `lib/server/evaluation.ts` (`usualPlace`, `guestHostPreferences`, the guest-host's bookings, the ranking skip, the projection notes), `lib/server/requester-host-profiles.ts` (the guest-host's preferences), `lib/contracts/request.ts` (`RequesterCandidate.notes`), `apps/web/app/_components/requester/request-cards.tsx` and `cards.tsx`, and the [guest booking flow](../../../../documentations/user_experience/06_guest_booking_flow.md). No schema change: allowance keys are text, and the preferences ride on the **Calendars** item.
