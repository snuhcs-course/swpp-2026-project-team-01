## ADDED Requirements

### Requirement: Inbound-first guest linking
A guest SHALL link iMessage to a request only by sending a request-owned one-time link code from their own iMessage to the service's line and then confirming the arrived masked sender on that request's booking page. The service SHALL NOT send the first message to a guest. A code SHALL be valid for 15 minutes, stored only as a keyed hash and a sealed copy, limited to 5 per request per hour, and replaced by a newer code; nothing SHALL be bound before **Confirm and link**.

#### Scenario: Link from the booking page
- **WHEN** the guest presses **Get updates in iMessage**, sends the prefilled message, and presses **Confirm and link** on the masked sender
- **THEN** the request has one active guest binding and the line replies once in that conversation

#### Scenario: Forwarded code
- **WHEN** a code arrives from a sender and nobody confirms it before it expires
- **THEN** no binding exists and the sender receives no request data

#### Scenario: No outbound first message
- **WHEN** a guest has never written to the line
- **THEN** no iMessage is sent to them for any notice

### Requirement: Guest bindings are request-scoped
A guest binding SHALL belong to one request and SHALL record the sender only as a keyed hash and sealed values. A request SHALL have at most one active guest binding; a sender MAY hold active bindings on several requests. A binding SHALL end on **Unlink iMessage**, when the request is booked or withdrawn, and when the booking link's receipt window ends, and SHALL move to a revised request created from it.

#### Scenario: Unlink
- **WHEN** the guest presses **Unlink iMessage**
- **THEN** later messages from that sender reach no requester discussion of that request and no further notice is sent there

### Requirement: Guest inbound routing
After link codes, an inbound message SHALL route to the conversation of the last message the line sent to that sender: a guest notice's request, or the host path after a host notice or reply. A sender with no earlier message from the line SHALL route to their host binding, else to their only or most recently created guest binding, and a sender with no binding SHALL receive the existing unlinked reply. The sender MAY switch to another of their conversations. Routed guest text SHALL become one accepted input of the request's requester discussion under the same redaction, admission and model limits as web input, and an exact retry of the same receipt SHALL resolve to the same input.

#### Scenario: Two hosts, one guest
- **WHEN** a sender holds guest bindings on requests to two hosts and was last notified about the second
- **THEN** a plain message reaches the second request's discussion

#### Scenario: Host who is also a guest
- **WHEN** a sender with a host binding and a guest binding last received a decline notice for the guest request
- **THEN** their next plain message reaches that request's requester discussion, and after a later host notice the next one reaches the host path

#### Scenario: Replayed receipt
- **WHEN** the same Photon message is delivered twice
- **THEN** the discussion holds one input and one reply is sent at most

### Requirement: Replies and notices without credentials
The assistant's final text for a routed message SHALL be sent back in the same conversation through the frozen outbox, and a send that began without a confirmed result SHALL be recorded uncertain and never repeated. Guest notices and replies SHALL NOT contain the booking link, link codes, host notes, host rules, exception reasons or calendar contents.

#### Scenario: Guest asks to book
- **WHEN** a linked guest writes "book it"
- **THEN** nothing is recorded and the reply names the card on the booking page
