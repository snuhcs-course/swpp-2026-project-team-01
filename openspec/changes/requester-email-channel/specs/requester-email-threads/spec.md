## ADDED Requirements

### Requirement: Authenticated sender evidence
A received message SHALL count for binding or forwarding only when the provider delivered it as a received message without an unauthenticated, spam or blocked classification and its recorded authentication results show a DMARC pass for the From domain, or a DKIM pass whose signing domain equals the From domain. The From header alone SHALL grant nothing. Messages sent from the product inbox SHALL be ignored.

#### Scenario: Spoofed sender
- **WHEN** a message claims the confirmed contact as From but carries no passing aligned DMARC or DKIM result
- **THEN** nothing is bound or forwarded and no reply is sent

### Requirement: One binding per thread and request
An email thread SHALL be bound to at most one request, and a request SHALL have at most one active thread. A binding SHALL record the keyed hash of the bound address, not the address. Only a message from the bound address in an active binding of an open request SHALL be forwarded, as an accepted input of that request's existing requester discussion, under the same redaction, admission and model limits as web input; an exact retry of the same receipt SHALL resolve to the same input.

#### Scenario: Forward a reply
- **WHEN** the bound sender replies in the thread of an open request
- **THEN** the text becomes one accepted input of the request's discussion and is visible in the web conversation

#### Scenario: Newly added recipient writes
- **WHEN** a person copied on the thread replies from another address
- **THEN** nothing is forwarded and no reply is sent

#### Scenario: Closed request
- **WHEN** the bound sender writes after the request closed
- **THEN** nothing is forwarded and the thread receives at most one closed notice for that binding

### Requirement: Link codes bind only as authored
A link code SHALL bind a thread only when it arrives in the first message of a new thread, from the request's confirmed contact, with authenticated sender evidence, before it expires and while it is the request's pending code. A code arriving any other way SHALL be voided without binding or reply. The linking message SHALL never reach the model. Binding SHALL replace the request's earlier thread.

#### Scenario: Forwarded linking message
- **WHEN** the linking message is forwarded and the copy reaches the inbox from another address
- **THEN** the code is voided, no thread is bound and no reply is sent

#### Scenario: Linking message as written
- **WHEN** the confirmed contact sends the code in a new thread before it expires
- **THEN** the thread is bound, the code is consumed, the thread receives a fixed confirmation and the model never sees the message

### Requirement: Replies in the same thread
Each forwarded message SHALL receive one reply in its thread after the turn that served it ends, containing that turn's final assistant text, or a fixed fallback when the turn produced none. Replies SHALL carry no booking link, linking code or host-private value.

#### Scenario: Turn ends
- **WHEN** the assistant finishes the turn for a forwarded message
- **THEN** one reply with that turn's final text is sent in the same thread

### Requirement: Email record retention
Receipts SHALL be deleted 30 days after receipt. Bindings and link codes SHALL stop acting when their request closes and SHALL be deleted 30 days after the request's creation. Replies in a final state SHALL hold no text or sealed secret and SHALL be deleted 30 days after creation.

#### Scenario: Retention sweep
- **WHEN** the cleanup runs after a request created 31 days earlier closed
- **THEN** its bindings, links and final replies are gone and its receipts older than 30 days are gone
