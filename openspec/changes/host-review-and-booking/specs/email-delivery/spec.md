## MODIFIED Requirements

### Requirement: Requester status notifications
The service SHALL email the requester's current contact address, whether or not the requester confirmed it, when a new proposal version awaits their agreement, when the host declines, when the request expires and when a booking stays unconfirmed 15 minutes after its first dispatch. Each notification SHALL carry the current status and the booking link, SHALL be generated from domain records, SHALL be suppressed at dispatch when its condition no longer holds, and SHALL NOT change request state. Requesters who entered through email SHALL receive the same notices in their existing conversational thread.

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

### Requirement: Booking confirmation message
A booking confirmation email SHALL be generated from the confirmed event details for each recipient, in that recipient's language and timezone. Its From header SHALL carry the host's display name on `no-reply@findmeatime.com`. Its Reply-To SHALL be the other party: the host's Google-verified email on the requester's copy, and the requester's contact address, confirmed or not, on the host's copy. The subject SHALL follow `{title} between {host} and {guest}` in the recipient's language. The message SHALL be HTML with a plain-text alternative and SHALL contain the confirmed status, the what/when/who/where blocks with the timezone named, the **View booking** link (the booking link for the requester, the request in `/app` for the host) and, for online meetings, the join link, and SHALL contain no host-private notes, rules or credentials beyond the requester's own booking link. A `text/calendar` attachment with `METHOD:REQUEST` SHALL be included only when its `UID` equals the created calendar event's `iCalUID`.

#### Scenario: Requester receives the confirmation
- **WHEN** an event is confirmed for a Korean-speaking requester in `Asia/Seoul`
- **THEN** the subject, labels and times are rendered in Korean and in `Asia/Seoul` with the zone named, and **View booking** opens that request's booking page

#### Scenario: Reply to the confirmation
- **WHEN** the requester replies to the confirmation email
- **THEN** the reply is addressed to the host's verified email, not to the product sender

#### Scenario: Calendar part cannot match the event
- **WHEN** the created calendar event's `iCalUID` is unavailable when the email is prepared
- **THEN** the email is sent without a calendar part and the calendar-native invitation remains the only calendar entry

#### Scenario: Host's copy
- **WHEN** a booking is confirmed
- **THEN** the host receives their own copy in their timezone whose **View booking** opens the request in `/app` and which carries no booking link

## ADDED Requirements

### Requirement: Reminders deferred
The first release SHALL NOT send reminder or follow-up emails for confirmed bookings. Created events SHALL keep the destination calendar's default reminders.

#### Scenario: Meeting approaches
- **WHEN** a confirmed meeting is a day away
- **THEN** the service sends no email about it, and any reminder comes from the participants' own calendars
