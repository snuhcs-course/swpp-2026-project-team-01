## MODIFIED Requirements

### Requirement: Travel uncertainty requires resolution
Unknown locations, unsupported routes, provider failures, and stale travel context SHALL remain unresolved until clarified or replaced by a specific confirmed manual allowance: the host's for a host leg, the requester's for their own. A host commitment with no location at all SHALL be taken to happen at the host's usual place when the host has one, which makes its trip an estimate like any other. Missing estimates SHALL never be zero travel.

#### Scenario: Routes returns no route
- **WHEN** the provider returns no route for the requested geography and mode
- **THEN** the candidate requires clarification or explicit manual allowance and is not automatically feasible

#### Scenario: Manual allowance confirmed
- **WHEN** the host explicitly confirms an allowance for the relevant leg and context
- **THEN** feasibility applies that allowance plus current buffers without exposing its private reasoning

### Requirement: Route estimates, geography and freshness
Travel legs SHALL be estimated with Google Routes for the host's confirmed travel mode and the leg's departure time, wherever the provider returns a route; no country list SHALL limit evaluation. A leg SHALL be checked against the nearest host commitment before or after the candidate on the same local day, whatever the gap; a candidate in an overnight window belongs to the window's starting day through the window's end. An adjacent host commitment with no location and no conference link SHALL be taken to happen at the host's usual place, the first named area, else the venue, so its trip is estimated from or to that place with the usual buffers, and no trip is needed when the meeting is at that place; without a usual place its leg SHALL stay unresolved. An adjacent commitment with only a conference link, or both a place and a conference link, SHALL leave its leg unresolved. An estimate MAY be reused for 24 hours for the same endpoints, mode and 15-minute departure slot. Cleartext event locations SHALL NOT be stored with cached estimates.

#### Scenario: Mode without routes in a region
- **WHEN** the provider returns no route for the host's mode between two places
- **THEN** the leg is unresolved and the candidate is not offered to the requester

#### Scenario: Previous meeting was online
- **WHEN** the commitment before an in-person candidate has only a conference link
- **THEN** the inbound leg is unresolved rather than assumed to start at home or the office

#### Scenario: Previous commitment has no location
- **WHEN** the host's areas start with 관악구, the commitment before an in-person candidate near 서울대 has no location, and the trip from 관악구 plus the buffers fits the gap
- **THEN** the candidate is offered, and the host's basis says the trip was taken from their usual area

#### Scenario: No usual place
- **WHEN** the host decides the place per meeting and the commitment before an in-person candidate has no location
- **THEN** the inbound leg is unresolved

#### Scenario: Cached estimate
- **WHEN** two evaluations within 24 hours need the same endpoints, mode and departure slot
- **THEN** the second uses the saved estimate, and a changed event location requires a new estimate

#### Scenario: Overnight candidate
- **WHEN** an in-person candidate at 01:00 in a window that started at 22:00 follows a host commitment that ended at 23:30
- **THEN** the inbound leg from that commitment is checked

#### Scenario: Distant commitment
- **WHEN** the nearest earlier commitment that day ended five hours before an in-person candidate
- **THEN** the inbound leg from that commitment is still checked

### Requirement: Manual travel allowance scope
A manual travel allowance SHALL cover one leg of one candidate: the party whose trip it is, the candidate's interval, the direction, the origin and destination and the travel mode, in 5-minute steps from 5 to 240 minutes. An adjacent commitment without a usable place SHALL be named by why it has none (no location, only a conference link, or both a place and a link), so its leg can take an allowance. The host SHALL confirm allowances for host legs and the requester for their own legs. An allowance SHALL be applied together with that party's buffers, SHALL be void when the candidate's interval, either endpoint or the mode changes, including when a commitment without a place gains one, SHALL NOT waive busy intervals or other hard constraints, and a host allowance SHALL NOT appear in requester output.

#### Scenario: Allowance resolves one leg
- **WHEN** the host confirms 40 minutes for the inbound trip of one candidate
- **THEN** that leg uses 40 minutes plus the buffers, and the same trip for another candidate stays unresolved

#### Scenario: Endpoint changes
- **WHEN** the adjacent event's location changes after an allowance was confirmed
- **THEN** the allowance no longer applies and the leg is unresolved again

#### Scenario: Trip to an event without a location
- **WHEN** a candidate is held back because the requester's next event has no location, and the requester chooses **Allow 30 minutes for my trip**
- **THEN** the allowance is recorded and the candidate is offered once the 30 minutes fit the gap

#### Scenario: The event gains a place
- **WHEN** that event later gets a location
- **THEN** the allowance no longer applies and the leg is estimated or unresolved again

## ADDED Requirements

### Requirement: A guest-host's own preferences order candidates
When the requester is a host who uses their host calendars for the request, feasibility SHALL order the candidates by that guest-host's own weekly windows and weekly limit as soft preferences: after the host's weekly-limit and trip preferences and the request's stated preferences, times inside the guest-host's weekly windows first, then times in weeks below the guest-host's weekly limit first. The guest-host's limit SHALL count their Find Me a Time bookings, and their other meetings when they count every meeting, by week in their own timezone. Their own events with no location SHALL be taken to happen at their usual place, as for the host. These preferences SHALL NOT remove a candidate or change the host's own weekly-limit order. Each time shown to the guest MAY carry sentences explaining these preferences; they SHALL NOT appear in the host's record, the host's view or the host's model context.

#### Scenario: Inside the guest-host's hours
- **WHEN** a guest-host whose Monday hours are 12:00 to 13:00 asks for Monday 10:00 to 13:00
- **THEN** 12:00, 12:15 and 12:30 come first, and the morning times are still offered after them

#### Scenario: A full week for the guest-host
- **WHEN** the guest-host's weekly limit is 2 and this week already has 2 of their bookings
- **THEN** next week's times come first and this week's are still offered

#### Scenario: The host's limit comes first
- **WHEN** next week is at the host's weekly limit and this week is at the guest-host's
- **THEN** this week's times still come first

#### Scenario: Explaining the order to the guest only
- **WHEN** a time is inside the guest-host's usual Monday hours
- **THEN** the guest sees "Inside your usual Monday hours 12:00–13:00." under it, and the host's basis for that time does not mention it
