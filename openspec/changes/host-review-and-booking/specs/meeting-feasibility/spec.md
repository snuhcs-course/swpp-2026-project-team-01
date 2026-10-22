## ADDED Requirements

### Requirement: Host exception and allowance controls
The host's private rule and travel review SHALL offer a manual allowance for an unresolved host trip of a specific candidate, in 5-minute steps from 5 to 240 minutes, and a waiver of the weekly meeting limit for one request; it SHALL offer no control that bypasses busy time, the host's hours or a trip that does not fit. A waiver SHALL be bound to the request's details and the host's rules revision and SHALL lapse when either changes. Both SHALL stay host-private and SHALL NOT replace final approval.

#### Scenario: Host confirms a trip allowance
- **WHEN** the host allows 30 minutes for an unresolved inbound trip of one candidate
- **THEN** a new evaluation applies those 30 minutes plus the host's buffers to that leg, and the requester sees the candidate without any travel detail

#### Scenario: Waiver lapses
- **WHEN** the requester changes the meeting's duration after the host waived the weekly limit
- **THEN** the waiver no longer applies and the next evaluation holds full weeks back again

### Requirement: Booking revalidation reads fresh evidence
Revalidation before a booking's dispatch SHALL evaluate exactly the approved interval with fresh Calendar reads under its own shared deadline, SHALL refetch route estimates older than one hour, and SHALL count the host's other in-flight and confirmed bookings as busy. It SHALL NOT rank and SHALL NOT publish candidates.

#### Scenario: Stale route estimate at booking
- **WHEN** the approved candidate's trip was estimated three hours earlier
- **THEN** revalidation requests a new estimate before deciding whether the trip still fits
