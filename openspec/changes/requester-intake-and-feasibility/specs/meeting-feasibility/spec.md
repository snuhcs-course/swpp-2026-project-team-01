## ADDED Requirements

### Requirement: Route estimates, geography and freshness
Travel legs SHALL be estimated with Google Routes for the host's confirmed travel mode and the leg's departure time, wherever the provider returns a route; no country list SHALL limit evaluation. A leg SHALL be checked only against the nearest host commitment on the same local day within three hours of the candidate. An adjacent commitment without a physical location SHALL leave its leg unresolved. An estimate MAY be reused for 24 hours for the same endpoints, mode and 15-minute departure slot. Cleartext event locations SHALL NOT be stored with cached estimates.

#### Scenario: Mode without routes in a region
- **WHEN** the provider returns no route for the host's mode between two places
- **THEN** the leg is unresolved and the candidate is not offered to the requester

#### Scenario: Previous meeting was online
- **WHEN** the commitment before an in-person candidate has only a conference link
- **THEN** the inbound leg is unresolved rather than assumed to start at home or the office

#### Scenario: Cached estimate
- **WHEN** two evaluations within 24 hours need the same endpoints, mode and departure slot
- **THEN** the second uses the saved estimate, and a changed event location requires a new estimate

#### Scenario: Distant commitment
- **WHEN** the nearest earlier commitment ended more than three hours before an in-person candidate
- **THEN** no inbound leg is checked for that candidate

### Requirement: Manual travel allowance scope
A manual travel allowance SHALL be confirmed by the host for one request, one direction, one origin and destination pair and one travel mode, in 5-minute steps from 5 to 240 minutes. It SHALL resolve every candidate leg with the same binding, SHALL be applied together with the host's buffers, and SHALL be invalidated when either endpoint, the mode or the request's meeting location changes. It SHALL NOT waive busy intervals or other hard constraints.

#### Scenario: Allowance resolves matching legs
- **WHEN** the host confirms 40 minutes for the inbound trip from one venue to the meeting location and two candidates follow commitments at that venue
- **THEN** both inbound legs use 40 minutes plus the buffers, and other legs stay as they were

#### Scenario: Meeting location changes
- **WHEN** the request's meeting location changes after an allowance was confirmed
- **THEN** the allowance no longer applies and the affected legs are unresolved again
