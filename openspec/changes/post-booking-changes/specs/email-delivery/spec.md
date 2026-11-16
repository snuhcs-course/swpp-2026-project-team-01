## MODIFIED Requirements

### Requirement: Requester status notifications
The service SHALL email the requester's verified contact when a new proposal version awaits their agreement, when the host declines, when the request expires, when a booking stays pending beyond the reconciliation window and when the host cancels a booked meeting. Each notification SHALL carry the current status and the booking link, SHALL be generated from domain records, and SHALL NOT change request state. Requesters who entered through email SHALL receive the same notices in their existing conversational thread.

#### Scenario: Host requests changes
- **WHEN** the host shares revised details that create a new proposal version
- **THEN** the requester's verified contact receives an action-needed email with the changed details and the booking link, and no agreement is recorded

#### Scenario: Notification delivery fails
- **WHEN** a status email is rejected or uncertain
- **THEN** the delivery job retries or records uncertainty without changing the request or booking state

#### Scenario: Host cancels a booked meeting
- **WHEN** the host cancels a booked meeting
- **THEN** the requester receives a cancellation notice naming the meeting's time, in their thread when they have one

## ADDED Requirements

### Requirement: Host cancellation notice
The service SHALL email the host when the requester cancels a booked meeting, naming the requester and the meeting's time in the host's timezone and linking to the request in the workspace. The email SHALL be sent only while the request is still cancelled.

#### Scenario: Guest cancels
- **WHEN** the requester cancels a booked meeting
- **THEN** the host's Google address receives one cancellation email with a link to the request
