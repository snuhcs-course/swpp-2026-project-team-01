# conversation-access Specification

## Purpose

Keep runtime conversations and scheduling tools accessible only to the verified participant and intended discussion audience, including after reconnect and revocation.

## Requirements

### Requirement: Authorized runtime access
The service SHALL verify the actor, resource, audience and current grant before creating, reading, listing, streaming or mutating a conversation. A runtime session identifier SHALL not grant access.

#### Scenario: Another participant supplies a session ID
- **WHEN** a host or requester supplies another participant's runtime session identifier
- **THEN** no history, stream or action is exposed and no model work begins

#### Scenario: Revoked continuation
- **WHEN** a participant's grant is revoked before a continuation or tool call
- **THEN** the operation is denied even if the runtime previously accepted that participant

### Requirement: Separate discussion audiences
Host setup, host-private request discussion and the requester discussion SHALL use separate authorized contexts. A tool that an audience must not use SHALL NOT be registered in that audience's context, so that instructions are never the only barrier; a shared tool SHALL derive the actor from the verified session and return only that audience's projection. The requester discussion's history SHALL be readable only by that request's requester: no host route, view or tool SHALL read it. Separate discussions SHALL not merge their histories or memory.

#### Scenario: Host switches to shared discussion
- **WHEN** a host, or the assistant in a host-review session, asks for the requester's conversation with the assistant
- **THEN** no route, view or tool returns it, and the host sees only the host projection of the request

#### Scenario: Requester asks for host data
- **WHEN** a requester session asks the assistant for the host's calendar contents, rules or exception reasons
- **THEN** no tool able to read them exists in that context, nothing is read, and the assistant answers within the requester projection

### Requirement: Recovery preserves application authority
Stream replay, runtime restart and repeated tool execution SHALL recover committed state without generating new approval or repeating committed commands. Failed model operations SHALL leave saved scheduling policy unchanged.

#### Scenario: Tool result lost after commit
- **WHEN** the runtime retries a tool after its command committed but the result was lost
- **THEN** current access is checked and the saved idempotent result is returned without another effect

### Requirement: Explicit terminal runtime recovery
A currently authorized participant SHALL be able to explicitly recover a confirmed failed runtime for the same logical conversation. Recovery SHALL require trusted terminal evidence and an exact observed generation. Missing, timed-out, active, or uncertain runtime state SHALL NOT authorize replacement. Closed resources and revoked authority SHALL remain denied.

#### Scenario: Existing authentication failure
- **WHEN** an authorized participant requests recovery after a recorded model authentication failure, including one predating this feature
- **THEN** the service creates at most one successor for the same conversation and preserves its host, request and audience

#### Scenario: Uncertain runtime state
- **WHEN** inspection times out, no session can be resolved without terminal evidence, or the observed generation has changed
- **THEN** recovery creates no successor and returns a safe unavailable or stale result

#### Scenario: Concurrent or repeated recovery
- **WHEN** participants concurrently recover the same failed generation, or retry after a lost response
- **THEN** one durable transition wins, exact retries return its status and stale or changed requests cannot replace the successor

### Requirement: Recovery fences retired execution
Retired runtime generations SHALL NOT perform new model work, tool operations, delivery or settlement. The service SHALL recheck current generation and participant authority under the relevant transaction locks and after asynchronous reads. Recovery SHALL NOT extend original grants or create scheduling decisions.

#### Scenario: Old tool resumes after recovery
- **WHEN** an old runtime attempts a tool, model reservation, delivery or settlement after its generation is retired
- **THEN** the operation is denied without changing domain state or the successor's work

#### Scenario: Revocation during recovery
- **WHEN** a credential expires or is revoked while terminal inspection or a recovery lock is pending
- **THEN** recovery is denied and no successor gains that credential's authority

### Requirement: Recovery preserves accepted work and history
Recovery SHALL preserve accepted input identities, exact retry fingerprints, prior tool results and all authorized conversation history. Pending work SHALL retain its original authority and budgets. Completed inputs SHALL NOT be executed again. Historical stream cursors SHALL remain meaningful without exposing raw runtime IDs or mixing audiences.

#### Scenario: Pending input after terminal failure
- **WHEN** recovery finds input accepted after the prior runtime failed
- **THEN** eligible pending input continues with its original message and retry identity, while expired authority cannot be renewed through recovery

#### Scenario: History and cursor continuation
- **WHEN** an authorized browser or agent reads history across a recovered generation, including with a pre-recovery cursor
- **THEN** prior permitted history and subsequent output appear in order without duplicate committed output, private cross-audience data or dropped history

#### Scenario: Committed tool result before failure
- **WHEN** a continued input repeats an operation that committed before runtime failure
- **THEN** current authority is rechecked and the saved result is reused without a second effect or fabricated approval

### Requirement: Host review audience
A host-private request discussion SHALL be its own discussion and runtime session per host and request, authorized only for that request's active host, with `read_request` and `evaluate_candidates` returning the host projection, plus `list_host_requests`, `propose_shared_changes` and `read_booking_status`, and no setup or requester tool. A decision tool (approving, declining, sharing or dismissing a suggestion) SHALL act only on a message from the host's linked messenger; on the web only the host's own cards decide. Exceptions SHALL NOT be tools in any assistant audience.

#### Scenario: Host asks the assistant to approve
- **WHEN** the host writes "approve it" in the private discussion
- **THEN** nothing is approved or recorded, and the assistant points to **Approve this proposal**

#### Scenario: Host review session of another request
- **WHEN** a host-review session's tool names a request other than the session's own
- **THEN** the call is denied without revealing whether that request exists
