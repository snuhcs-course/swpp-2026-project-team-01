## ADDED Requirements

### Requirement: Host review audience
A host-private request discussion SHALL be its own discussion and runtime session per host and request, authorized only for that request's active host, with `read_request` and `evaluate_candidates` returning the host projection, plus `list_host_requests`, `propose_shared_changes` and `read_booking_status`, and no setup or requester tool. Approval, decline, sharing changes and exceptions SHALL NOT be tools in any audience.

#### Scenario: Host asks the assistant to approve
- **WHEN** the host writes "approve it" in the private discussion
- **THEN** no tool can approve, nothing is recorded, and the assistant points to **Approve this proposal**

#### Scenario: Host review session of another request
- **WHEN** a host-review session's tool names a request other than the session's own
- **THEN** the call is denied without revealing whether that request exists
