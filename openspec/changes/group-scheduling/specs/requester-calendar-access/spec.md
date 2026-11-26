## MODIFIED Requirements

### Requirement: Private read-only Calendar access
A requester Calendar grant SHALL request only calendar-list and read-only event access and SHALL be used only for its own request, on the calendars the requester selected: by that request's evaluations, to derive busy intervals under the same rules as host calendars and the places of the requester's events adjacent to in-person candidates, and to show the requester their own busy times beside that request's offered times. The busy times shown SHALL carry only their start, end and whether they last all day, and SHALL NOT be stored, except that a group participant's unavailable times SHALL be stored, with their start, end, whether they last all day and the event's place, when the participant confirms them in the group review. Event titles, attendees and descriptions, and any other event's location, SHALL NOT be stored, logged, placed in a tool result or model context, or shown to the host or any agent; requester-facing text SHALL refer to an adjacent event only generically.

#### Scenario: Busy requester interval
- **WHEN** a selected requester calendar is busy during an otherwise feasible candidate
- **THEN** the candidate is excluded and neither the host nor the requester's agent sees the requester's event

#### Scenario: Declined requester event
- **WHEN** the requester declined an invitation during an otherwise feasible candidate
- **THEN** that event does not block the candidate

#### Scenario: Grant used for another request
- **WHEN** an operation for a different request would read the requester's calendar
- **THEN** that request's own grants are the only ones consulted and the first request's grant is never read

#### Scenario: Busy times beside the offered times
- **WHEN** a requester with a connected calendar opens the times card for their request
- **THEN** their busy times for the shown week come back with only start, end and all-day, no title, place or attendee, and nothing is stored

#### Scenario: Group participant confirms their unavailable times
- **WHEN** a group participant confirms the review of the times they cannot meet
- **THEN** the confirmed intervals are stored with start, end, all-day and their event's place, no title or attendee is stored, and the host sees none of them
