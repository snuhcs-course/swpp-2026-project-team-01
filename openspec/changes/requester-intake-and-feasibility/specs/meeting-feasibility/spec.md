## ADDED Requirements

### Requirement: Route estimates, geography and freshness
Travel legs SHALL be estimated with Google Routes for the host's confirmed travel mode and the leg's departure time, wherever the provider returns a route; no country list SHALL limit evaluation. A leg SHALL be checked against the nearest host commitment before or after the candidate on the same local day, whatever the gap; a candidate in an overnight window belongs to the window's starting day through the window's end. An adjacent commitment with no location, only a conference link, or both a place and a conference link SHALL leave its leg unresolved. An estimate MAY be reused for 24 hours for the same endpoints, mode and 15-minute departure slot. Cleartext event locations SHALL NOT be stored with cached estimates.

#### Scenario: Mode without routes in a region
- **WHEN** the provider returns no route for the host's mode between two places
- **THEN** the leg is unresolved and the candidate is not offered to the requester

#### Scenario: Previous meeting was online
- **WHEN** the commitment before an in-person candidate has only a conference link
- **THEN** the inbound leg is unresolved rather than assumed to start at home or the office

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
A manual travel allowance SHALL cover one leg of one candidate: the party whose trip it is, the candidate's interval, the direction, the origin and destination and the travel mode, in 5-minute steps from 5 to 240 minutes. The host SHALL confirm allowances for host legs and the requester for their own legs. An allowance SHALL be applied together with that party's buffers, SHALL be void when the candidate's interval, either endpoint or the mode changes, SHALL NOT waive busy intervals or other hard constraints, and a host allowance SHALL NOT appear in requester output.

#### Scenario: Allowance resolves one leg
- **WHEN** the host confirms 40 minutes for the inbound trip of one candidate
- **THEN** that leg uses 40 minutes plus the buffers, and the same trip for another candidate stays unresolved

#### Scenario: Endpoint changes
- **WHEN** the adjacent event's location changes after an allowance was confirmed
- **THEN** the allowance no longer applies and the leg is unresolved again

### Requirement: Requester travel legs
When the requester connected Google Calendar and the meeting is in person, feasibility SHALL also check the requester's trip from their previous event and to their next event on the same local day in the requester's timezone, using the travel mode the requester chose, with the same unresolved rules as host legs and no host buffer. A requester leg that does not fit SHALL exclude the candidate. An unresolved requester leg SHALL keep the candidate from being offered until the requester confirms an allowance for it. Requester event details SHALL NOT appear in host or agent output.

#### Scenario: Requester cannot get there
- **WHEN** the requester's previous event ends at 14:00 at a place 50 minutes by public transit from the meeting, and a candidate starts at 14:30
- **THEN** the candidate is excluded and the host sees no reason that mentions the requester's event

#### Scenario: Requester leg unresolved
- **WHEN** the requester's next event has no location
- **THEN** the candidate is held back and the requester can allow minutes for that trip to have it offered

#### Scenario: No requester calendar
- **WHEN** the requester gave availability windows without connecting Google Calendar
- **THEN** no requester leg is checked

### Requirement: Bounded evaluations per request
Asking for times again while an evaluation of the same request and settings revisions is still running SHALL return that evaluation instead of starting another, whether the assistant or the **Find times** card asks. A request SHALL start at most 10 new evaluations in any rolling hour; past that, the service SHALL start none and SHALL return temporary-limit feedback.

#### Scenario: Eleventh evaluation in an hour
- **WHEN** a request that started 10 evaluations in the last hour asks for times again
- **THEN** no evaluation starts, no calendar or route is read, and the requester is told to try again later
