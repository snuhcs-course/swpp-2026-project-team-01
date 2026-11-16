## MODIFIED Requirements

### Requirement: Persisted lifecycle and closure guards
Requests SHALL expose gathering, negotiating, awaiting host approval, booking, booked, declined, withdrawn, expired, or cancelled status. Still-actionable requests SHALL expire seven days after creation or at the requested window end, whichever is earlier; terminal requests SHALL not reopen through replay.

#### Scenario: Requester withdraws before booking
- **WHEN** withdrawal commits before entry to booking
- **THEN** the request becomes withdrawn and late agreement or approval cannot create an event

#### Scenario: Expired request
- **WHEN** an actionable request reaches its seven-day deadline or the earlier requested-window end
- **THEN** later decisions are rejected and continuation requires a new or explicitly refreshed request

#### Scenario: Withdrawal during pending write
- **WHEN** withdrawal is attempted after booking may have begun
- **THEN** the pending outcome is reported without claiming that event creation was prevented

## ADDED Requirements

### Requirement: Cancelling a booked meeting
The requester and the host SHALL each be able to cancel a booked meeting until its start time, each only through their own authority and only after a clear confirmation. Cancellation SHALL move the request to cancelled and its booking to cancelled with who cancelled it, SHALL delete the host's Google Calendar event with updates sent to attendees, and SHALL tell the side that did not cancel through their usual channels. A refused or impossible deletion SHALL leave the request cancelled and tell the host to remove the event themselves. Cancellation SHALL be refused once the meeting has started, while the booking's event write is still pending, and for a request that was never booked.

#### Scenario: Guest cancels
- **WHEN** the guest confirms they want to cancel a booked meeting that has not started
- **THEN** the request becomes cancelled, the Google event is deleted with updates sent, and the host is told by email and in their linked chat

#### Scenario: Host cancels
- **WHEN** the host presses **Cancel meeting** and confirms, or clearly tells their linked chat or agent to cancel
- **THEN** the request becomes cancelled, the Google event is deleted with updates sent, and the guest is told by email and in their linked chat

#### Scenario: Meeting already started
- **WHEN** either side asks to cancel after the meeting's start time
- **THEN** nothing changes and they are told the meeting has already started

#### Scenario: Event cannot be deleted
- **WHEN** Google refuses the deletion or the host's Calendar access is gone
- **THEN** the request stays cancelled and the host is told to remove the event from their calendar

#### Scenario: Cancelled twice
- **WHEN** a cancellation is replayed or the other side cancels the same meeting afterwards
- **THEN** the saved outcome is returned or the request is reported as already cancelled, and no second notice is sent
