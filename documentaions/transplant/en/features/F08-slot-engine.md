# F08 — Slot engine: when two people can actually meet (incl. travel time)

## Intent
- Calendly-style tools show the host's free time only; the client then reconciles their own schedule and **travel between places** mentally. Here both calendars, both rule sets and travel time are computed together, deterministically. `[doc one_pager §1–2]`
- "Available" means "able to *be at* the meeting": rule edges get no travel buffer; travel is measured to the nearest *offline* neighbouring event. `[doc one_pager §4.1, §4.3]` `[code]`

## Rules (verified, `core/slots.ts`, `core/travel.ts`, `core/availability.ts`)
- Grid: every 30 min from today 00:00 KST for 60 days; skip starts earlier than now + lead (2 h default, 0 h for accept re-validation); meeting end must be ≤ horizon end.
- For every (start, meeting type, place) both host and client must pass `personSlack`:
  1. **Whole meeting inside the union of that weekday's enabled windows** (`fitsRules`; same day only).
  2. **No overlap** with any busy interval (online events included).
  3. **Travel before/after**: nearest offline anchor ending ≤ start and starting ≥ end; gap − travel ≥ 0. Online events and all-day events are never anchors.
- **Travel minutes** (`travelMinutes(event, place, role)`), symmetric before/after:

  | | meeting at 회사 근처 (`office_near`) | meeting at 특정 장소 (`special`) | 온라인 |
  |---|---|---|---|
  | host, neighbour at office | 30 | 60 | 0 |
  | host, neighbour elsewhere / unknown | 60 | 30 | 0 |
  | client, any offline neighbour | 60 | 60 | 0 |
  | same place (placeRef = place id or name) | 0 | 0 | – |

  Unknown location (`none`) counts as "elsewhere". Example from the design: office until 12:50 → online 12:50–13:00 → 13:00 special-place meeting is impossible (office → special = 60 min). `[doc]`
- **Slack** (for the "앞뒤 여유" preference): min over both people of the spare time after travel to offline neighbours and the raw gap to any neighbour (online included), capped at 120 min; stored as exact ms.
- Inputs per person (`Person`): `busyIntervals` and `travelAnchors` from F02 normalisation, `rules` from the confirmed profile's meeting windows (F05) or legacy rules. Accepted meetings are app events (`source='booking'`), so they block time automatically; pending requests do **not** block.
- Complexity: sorted arrays + prefix max + binary search per check; 2 people × 60 days well under the 1 s target `[doc NFR-1]` (not re-measured here).

## Data / API
Pure functions: `computeSlots({host, client, places, meetingTypes, nowMs, minLeadHours?}) → Slot[]` where `Slot = {startMs, endMs, placeId, meetingTypeId, slackMin, slackMs}`; `sameSlot(a,b)`. Server wrapper `services/schedule.ts computeBookable(db, clientId, hostId, nowMs, minLeadHours?)`.

## Code map
`core/slots.ts`, `core/travel.ts`, `core/availability.ts`, `core/time.ts`, `core/types.ts`, `server/services/schedule.ts`. Tests: `tests/core/{slots,travel}.test.ts` (every travel-table cell is unit-tested `[doc FR-14]`).

## Depends on / used by
Inputs from F02 (busy, anchors), F05 (windows), F06 (places, types). Used by F09 and F10.

## Transplant unit
The most portable piece: zero I/O, ~300 lines across `slots/travel/availability/time`. Replace the travel table if the target has different place kinds or a routing API; keep the "offline neighbour only" and "symmetric before/after" rules.
