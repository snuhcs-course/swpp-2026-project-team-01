## MODIFIED Requirements

### Requirement: Requester status notifications
The service SHALL email the requester's verified contact when a new proposal version awaits their agreement, when the host declines, when the request expires and when a booking stays pending beyond the reconciliation window. Each notification SHALL carry the current status and the booking link, SHALL be generated from domain records, and SHALL NOT change request state. Requesters who entered through email SHALL receive the same notices in their existing conversational thread. A requester with an active iMessage binding, or a host profile with the iMessage item, SHALL also receive each notice and the booking confirmation in that iMessage conversation, without the booking link, while email remains the channel that carries it.

#### Scenario: Host requests changes
- **WHEN** the host shares revised details that create a new proposal version
- **THEN** the requester's verified contact receives an action-needed email with the changed details and the booking link, and no agreement is recorded

#### Scenario: Notification delivery fails
- **WHEN** a status email is rejected or uncertain
- **THEN** the delivery job retries or records uncertainty without changing the request or booking state

#### Scenario: Linked guest is declined
- **WHEN** the host declines a request whose guest linked iMessage
- **THEN** the guest receives the decline email with the booking link and an iMessage notice without it, and neither changes request state
