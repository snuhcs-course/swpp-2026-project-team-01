## ADDED Requirements

### Requirement: Host review audience
A host-private request discussion SHALL be its own discussion and runtime session per host and request, authorized only for that request's active host, with `read_request` and `evaluate_candidates` returning the host projection, plus `list_host_requests`, `propose_shared_changes` and `read_booking_status`, and no setup or requester tool. Approval, decline, sharing changes and exceptions SHALL NOT be tools in any audience.

#### Scenario: Host asks the assistant to approve
- **WHEN** the host writes "approve it" in the private discussion
- **THEN** no tool can approve, nothing is recorded, and the assistant points to **Approve this proposal**

#### Scenario: Host review session of another request
- **WHEN** a host-review session's tool names a request other than the session's own
- **THEN** the call is denied without revealing whether that request exists

## MODIFIED Requirements

### Requirement: Separate discussion audiences
Host setup, host-private request discussion and the requester discussion SHALL use separate authorized contexts. A tool that an audience must not use SHALL NOT be registered in that audience's context, so that instructions are never the only barrier; a shared tool SHALL derive the actor from the verified session and return only that audience's projection. The requester discussion's history SHALL be readable only by that request's requester: no host route, view or tool SHALL read it. Separate discussions SHALL not merge their histories or memory.

#### Scenario: Host switches to shared discussion
- **WHEN** a host, or the assistant in a host-review session, asks for the requester's conversation with the assistant
- **THEN** no route, view or tool returns it, and the host sees only the host projection of the request

#### Scenario: Requester asks for host data
- **WHEN** a requester session asks the assistant for the host's calendar contents, rules or exception reasons
- **THEN** no tool able to read them exists in that context, nothing is read, and the assistant answers within the requester projection
