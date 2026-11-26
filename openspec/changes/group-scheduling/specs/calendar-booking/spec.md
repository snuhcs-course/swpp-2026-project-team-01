## MODIFIED Requirements

### Requirement: Host-owned event with stable identity
The event SHALL be created with the host's own Calendar grant in the host's confirmed booking destination, with the requester as the only attendee, or for a group meeting every done participant as an attendee, Google's own invitation sent to attendees, and the destination's default reminders. Its provider event identity SHALL be fixed and stored before dispatch, so a repeated create cannot produce a second event. The organizer shown to either party SHALL be the organizer Google reports for the event. The shared description SHALL contain the meeting details and any join link and SHALL NOT contain the booking link, host notes, rules or exception reasons.

#### Scenario: Insert repeated after a lost response
- **WHEN** an event insert is repeated after the first one succeeded but its response was lost
- **THEN** Google refuses the duplicate identity, the existing event is read and confirmed, and only one event exists

#### Scenario: Online meeting with Google Meet
- **WHEN** an approved online proposal's link plan is Google Meet
- **THEN** the event is created with a Meet conference and the join link Google returns appears in the receipt and the confirmation

#### Scenario: Group meeting attendees
- **WHEN** the host books a time for a group meeting with four done participants
- **THEN** one event is created with the four participants' emails as attendees and Google's invitation is sent to each
