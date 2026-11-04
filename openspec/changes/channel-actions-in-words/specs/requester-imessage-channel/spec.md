## MODIFIED Requirements

### Requirement: Guest inbound routing
After link codes, a sender with one active binding SHALL route to it; a sender with no binding SHALL receive the existing unlinked reply. A sender with multiple active bindings SHALL select a conversation before free text is forwarded, and select again after an outbound message in another conversation or a new guest binding. A message that names exactly one of the sender's conversations in words (the host's own account, or a guest request by its host or reference) SHALL select it and be forwarded there; otherwise the sender SHALL be asked, in the message's language and in words, which conversation it is for. Routed guest text SHALL become one accepted input of the request's requester discussion under the same redaction, admission and model limits as web input, and an exact retry of the same receipt SHALL resolve to the same input.

#### Scenario: Two hosts, one guest
- **WHEN** a sender holds guest bindings on requests to two hosts, has not selected one, and writes a message that names neither
- **THEN** the message is not forwarded and the sender is asked which conversation it is for, naming each host

#### Scenario: Message names a host
- **WHEN** the same sender writes "Grace, is Friday possible?" and only one of the hosts is Grace
- **THEN** the message is forwarded to that request and its conversation stays selected

#### Scenario: Host who is also a guest
- **WHEN** a sender with a host binding and a guest binding, with neither selected, writes "호스트인데 나"
- **THEN** the message reaches the host's own conversation, with a Korean reply saying so

#### Scenario: Host notice after a guest selection
- **WHEN** a sender with a host binding and a guest binding selects the guest request, and a later host notice is created
- **THEN** their next plain message that names neither conversation is not forwarded until they select one again

#### Scenario: Replayed receipt
- **WHEN** the same Photon message is delivered twice
- **THEN** the discussion holds one input and one reply is sent at most
