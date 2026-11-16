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

#### Scenario: Cancelled during a change
- **WHEN** either side cancels while a change to the booked meeting is open
- **THEN** the booked meeting is cancelled as above and any change reserved for booking is cancelled with it

#### Scenario: Cancelled twice
- **WHEN** a cancellation is replayed or the other side cancels the same meeting afterwards
- **THEN** the saved outcome is returned or the request is reported as already cancelled, and no second notice is sent

### Requirement: Changing a booked meeting
The requester and the host SHALL each be able to reopen a booked meeting for a change of time, place or meeting type until it starts. The change SHALL go through the usual proposal version, requester agreement and host approval, while the booked meeting stays booked. The meeting's own calendar event SHALL NOT count as busy time for its change. On approval, the booking SHALL update the existing Google Calendar event in place with updates sent to attendees, and only then replace the booked meeting. A change that is withdrawn, declined or expires SHALL leave the booked meeting as it was and tell the requester when the host declined or time ran out.

#### Scenario: Guest moves a booked meeting
- **WHEN** the guest asks to move a booked meeting, agrees to a new time and the host approves it
- **THEN** the same Google event moves to the new time with updates sent, the earlier booking is replaced, and both parties get a confirmation saying the meeting changed

#### Scenario: The booked meeting stands during a change
- **WHEN** a change is open, agreed or approved but not yet written to the calendar
- **THEN** both parties still see the booked meeting, and its time is offered again if it remains free

#### Scenario: Change dropped
- **WHEN** the guest withdraws the change, the host declines it, or it reaches its deadline (seven days or the meeting's start, whichever is earlier)
- **THEN** the request is booked again with the meeting as it was, and for a decline or a deadline the guest is told

#### Scenario: Change fails in the calendar
- **WHEN** Google refuses the update or the event is gone
- **THEN** the booked meeting stays as it was and the host sees the failure and can approve again

#### Scenario: Meeting already started
- **WHEN** either side asks to change a meeting after its start
- **THEN** nothing reopens and they are told it has started
