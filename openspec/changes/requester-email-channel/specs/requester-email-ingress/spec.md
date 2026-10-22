## ADDED Requirements

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
