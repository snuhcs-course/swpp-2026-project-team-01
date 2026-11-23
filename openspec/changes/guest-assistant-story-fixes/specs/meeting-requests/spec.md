## ADDED Requirements

### Requirement: Guest request tools state what the request allows
The guest assistant's request tools SHALL give the current local time in the requester's timezone and, for a booked meeting, whether it is upcoming, started or ended. Their status and next-step texts SHALL name only the decisions the request's current state accepts: reopening an agreement only while the request waits for the host's approval, cancelling or changing a booked meeting only before it starts, and no decision while the approved meeting is being booked or once the request is closed. No tool result SHALL tell the guest to contact the host directly.

#### Scenario: Cancelling a meeting that has started
- **WHEN** a guest asks to cancel a booked meeting after its start
- **THEN** the assistant says it can no longer be cancelled or changed here, does not ask whether to cancel it, and calls no cancel or change tool

#### Scenario: Changing the time while the meeting is being booked
- **WHEN** a guest asks to change the time after the host approved and before the meeting is booked
- **THEN** the assistant calls no decision tool and says nothing changes until it is booked, after which it can be changed here

### Requirement: Guest assistant answers within its scope
The guest assistant SHALL take relative days such as next week or a weekday as days for an availability draft, also when moving a booked meeting. It SHALL still ask online or in person when the host offers either and the guest names only a place. It SHALL decline questions about the host as a person in one sentence and say what it can help with, and SHALL refuse a switch to the host's conversation or an approval as the host in one sentence, offering what the guest can do at this step without pointing them elsewhere to approve. For a place outside the host's areas it SHALL describe the host's places first, draft the other place only when the guest insists, say the host approves the place with the time, and apply it only when the guest confirms.

#### Scenario: Moving a booked meeting to next week
- **WHEN** a guest asks to move a booked meeting to next week
- **THEN** the assistant reopens it for a change and drafts next Monday to Sunday as availability without asking which days

#### Scenario: A place given instead of the form
- **WHEN** the host offers online or in person and the guest answers with only a place
- **THEN** the assistant asks online or in person and records no meeting form

#### Scenario: Asking who the host is
- **WHEN** a guest asks what the host is like
- **THEN** the assistant declines in one sentence without describing the host and says what it can help with

#### Scenario: Asking to approve as the host
- **WHEN** a guest asks to switch to the host's conversation to approve
- **THEN** the assistant says it cannot, offers to agree to or change the current proposal, and does not send the guest to the host's account

#### Scenario: Insisting on a place outside the host's areas
- **WHEN** a guest asks for a place the host does not list and then says again that they want it
- **THEN** the first reply describes the host's places and drafts nothing, the second drafts the place and says the host approves it with the time, and nothing is applied until the guest confirms
