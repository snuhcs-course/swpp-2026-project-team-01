## MODIFIED Requirements

### Requirement: Requester status notifications
The service SHALL email the requester's current contact address, whether or not the requester confirmed it, when a new proposal version awaits their agreement, when the host declines, when the request expires, when a booking stays unconfirmed 15 minutes after its first dispatch, when the host cancels a booked meeting, and when a change to a booked meeting is declined or expires. Each notification SHALL carry the current status and the booking link, SHALL be generated from domain records, SHALL be suppressed at dispatch when its condition no longer holds, and SHALL NOT change request state. Requesters who entered through email SHALL receive the same notices in their existing conversational thread.

#### Scenario: Host requests changes
- **WHEN** the host shares revised details that create a new proposal version
- **THEN** the requester's contact address receives an action-needed email with the changed details and the booking link, and no agreement is recorded

#### Scenario: Notification delivery fails
- **WHEN** a status email is rejected or uncertain
- **THEN** the delivery job retries or records uncertainty without changing the request or booking state

#### Scenario: Booking still pending
- **WHEN** a booking is still unconfirmed 15 minutes after its first dispatch
- **THEN** the requester receives one email saying the booking is in progress, with the booking link and no claim that the meeting is booked

#### Scenario: Notice no longer current
- **WHEN** a new-version email reaches dispatch after the requester agreed or a newer version replaced it
- **THEN** it is suppressed and not sent

#### Scenario: Host cancels a booked meeting
- **WHEN** the host cancels a booked meeting
- **THEN** the requester receives a cancellation notice naming the meeting's time, in their thread when they have one

#### Scenario: A change to a booked meeting is dropped
- **WHEN** the host declines a change to a booked meeting, or the change expires
- **THEN** the requester receives a notice that the meeting stays at its booked time

## ADDED Requirements

### Requirement: Host cancellation notice
The service SHALL email the host when the requester cancels a booked meeting, naming the requester and the meeting's time in the host's timezone and linking to the request in the workspace. The email SHALL be sent only while the request is still cancelled.

#### Scenario: Guest cancels
- **WHEN** the requester cancels a booked meeting
- **THEN** the host's Google address receives one cancellation email with a link to the request

### Requirement: Changed meeting confirmation
When a change to a booked meeting is booked, both parties SHALL receive the booking confirmation saying the meeting changed, with the new details and without a calendar attachment, since the calendar provider's update carries the invitation.

#### Scenario: Meeting moved
- **WHEN** the booking job updates the event for an approved change
- **THEN** the requester and the host each receive one confirmation with the new time and no `invite.ics`
