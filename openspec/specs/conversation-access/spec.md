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
Host setup, host-private request discussion and shared requester discussion SHALL use separate authorized contexts and tool permissions. Switching the visible discussion SHALL not merge their histories or memory.

#### Scenario: Host switches to shared discussion
- **WHEN** a host selects the shared discussion after a private review
- **THEN** only shared-safe history and operations are supplied to that context

### Requirement: Recovery preserves application authority
Stream replay, runtime restart and repeated tool execution SHALL recover committed state without generating new approval or repeating committed commands. Failed model operations SHALL leave saved scheduling policy unchanged.

#### Scenario: Tool result lost after commit
- **WHEN** the runtime retries a tool after its command committed but the result was lost
- **THEN** current access is checked and the saved idempotent result is returned without another effect
