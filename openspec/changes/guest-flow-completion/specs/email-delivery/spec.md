## MODIFIED Requirements

### Requirement: Requester status notifications
The service SHALL email the requester's verified contact when a new proposal version awaits their agreement, when the host declines, when the request expires and when a booking stays pending beyond the reconciliation window. Each notification SHALL carry the current status, SHALL be generated from domain records, and SHALL NOT change request state. It SHALL be sent from the product inbox so the requester can answer it by replying: in the request's active email thread, or, when the request has none, as the first message of a new thread that SHALL then be bound to the request and the contact address. A notification from the product inbox SHALL NOT carry the booking link; where no product inbox is configured, the notification SHALL be the no-reply email that carries the booking link. A requester with an active iMessage binding, or a host profile with the iMessage item, SHALL also receive each notice and the booking confirmation in that iMessage conversation, without the booking link.

#### Scenario: Host requests changes
- **WHEN** the host shares revised details that create a new proposal version
- **THEN** the requester's verified contact receives an action-needed email with the changed details that they can answer by replying, and no agreement is recorded

#### Scenario: Requester with no thread
- **WHEN** the host declines a request that started on the web and has no email thread
- **THEN** the decline notice starts a new thread from the product inbox without the booking link, the thread is bound to the request, and the requester's reply reaches it

#### Scenario: Notification delivery fails
- **WHEN** a status email is rejected or uncertain
- **THEN** the delivery job retries or records uncertainty without changing the request or booking state

#### Scenario: Linked guest is declined
- **WHEN** the host declines a request whose guest linked iMessage
- **THEN** the guest receives the decline email and an iMessage notice, neither with the booking link, and neither changes request state
