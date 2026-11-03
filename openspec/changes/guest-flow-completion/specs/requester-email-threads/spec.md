## MODIFIED Requirements

### Requirement: One binding per thread and request
An email thread SHALL be bound to at most one request, and a request SHALL have at most one active thread. A binding SHALL record the keyed hash of the bound address, not the address. Only a message from the bound address in an active binding of an open request SHALL be forwarded, as an accepted input of that request's existing requester discussion, under the same redaction, admission and model limits as web input; an exact retry of the same receipt SHALL resolve to the same input. A message from the bound address after the request closed as declined, expired or withdrawn SHALL follow the revised request requirement of `meeting-requests` instead; after a booking it SHALL reach the request's discussion, where the assistant answers questions about the confirmed meeting and records nothing.

#### Scenario: Forward a reply
- **WHEN** the bound sender replies in the thread of an open request
- **THEN** the text becomes one accepted input of the request's discussion and is visible in the web conversation

#### Scenario: Newly added recipient writes
- **WHEN** a person copied on the thread replies from another address
- **THEN** nothing is forwarded and no reply is sent

#### Scenario: Booked request
- **WHEN** the bound sender writes after the request was booked
- **THEN** the message reaches the request's discussion, the assistant answers from the booking's receipt, and nothing is recorded

#### Scenario: Declined, expired or withdrawn request
- **WHEN** the bound sender writes after the request was declined, expired or withdrawn
- **THEN** no closed notice is sent, and the message creates or reaches the revised request as `meeting-requests` requires
