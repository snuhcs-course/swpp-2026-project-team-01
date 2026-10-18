# requester-email-ingress Specification

## Purpose

Preserve authenticated requester email events durably and exactly once without treating transport delivery as verified contact or permission to access a conversation.

## Requirements

### Requirement: Fenced authenticated receiver
The email receiver SHALL require valid bounded provider signatures and a currently enabled operator-owned inbox/receiver registration. An absent, disabled or replaced receiver SHALL not accept an event. Unsupported delivery classes SHALL not create conversation work.

#### Scenario: Former consumer delivers
- **WHEN** a validly signed event reaches a receiver whose registration is disabled or replaced
- **THEN** no receipt or job is created and the delivery is not acknowledged as accepted

### Requirement: Durable deduplicated receipt
Accepted received-message events SHALL atomically store minimized provider locators, immutable signed-payload evidence and one recoverable job before acknowledgment. Concurrent identical retries SHALL reuse the same receipt/job. Reused event, message or delivery identities with conflicting evidence SHALL fail without changing the stored event.

#### Scenario: Concurrent retries and lost response
- **WHEN** identical deliveries arrive concurrently or after the commit response was lost
- **THEN** all successful retries resolve to one receipt and one job

#### Scenario: Changed retry
- **WHEN** a provider identity is reused with a changed payload, thread, message or event
- **THEN** the conflict is rejected and no additional job or altered receipt is committed

### Requirement: Receipt is not request authority
Receipts and receiver configuration SHALL be inaccessible to browser/database client roles. Ingress SHALL persist no mail body, sender claim, arbitrary header or attachment content and SHALL not create request access, verified contact, agreement, approval or outbound mail. Jobs SHALL carry only a receipt reference.

#### Scenario: Inspect ingress effects
- **WHEN** an authenticated message is durably received
- **THEN** only transport evidence and its job exist, with no conversation access or scheduling decision granted
