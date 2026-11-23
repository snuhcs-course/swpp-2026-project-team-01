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

### Requirement: Registered receiver route
Each AgentMail webhook SHALL deliver to `/agentmail/webhooks/{receiverId}` on the agent service. A receiver SHALL accept an event only while its registration is enabled, names the configured inbox and records the fingerprint of the configured signing secret. The signature SHALL be verified over the raw body with a timestamp no more than five minutes from the server's time before the payload is read. Registering a receiver for an inbox SHALL disable the inbox's earlier receiver in the same audited operator action.

#### Scenario: Signing secret replaced
- **WHEN** a validly signed event reaches a receiver whose recorded fingerprint differs from the configured secret
- **THEN** it is refused with no receipt or job

#### Scenario: Stale signature
- **WHEN** an event carries a valid signature whose timestamp is more than five minutes old
- **THEN** it is refused before its payload is parsed

#### Scenario: Unsupported event acknowledged
- **WHEN** a validly signed event of a type other than a received message arrives
- **THEN** it is acknowledged without a receipt or job

### Requirement: Minimized receipt identity
A receipt SHALL hold the receiver, the provider event ID, the delivery ID, the event type, the inbox, thread and message IDs, the payload's SHA-256 and the receipt time, and nothing else from the message. The provider event ID SHALL identify the receipt across retries and subscriptions.

#### Scenario: Same event through a second delivery
- **WHEN** the same event ID arrives with identical evidence after its response was lost
- **THEN** the existing receipt and job are acknowledged and nothing new is written
