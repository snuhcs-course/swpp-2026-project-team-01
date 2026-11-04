## MODIFIED Requirements

### Requirement: Role-bound permission scopes
Host resources SHALL accept only `host:read`, `host:write` and `host:decide`; requester resources SHALL accept only `request:read`, `request:write` and `request:decide`. `host:decide` SHALL permit approving the current agreed proposal and declining a request when the host asks in their own words; a host grant without it SHALL NOT list or call the decision tools. `request:decide` SHALL permit agreeing to the current proposal and withdrawing the request. Refresh SHALL NOT widen scopes.

#### Scenario: Scope of another role
- **WHEN** an authorization request for `/mcp` asks for `request:write`
- **THEN** it fails with `invalid_scope` and no transaction is recorded

#### Scenario: Agent approves for the host
- **WHEN** a host's agent with `host:decide` approves the current agreed proposal version with the host's words
- **THEN** the approval is recorded against that version and the booking starts

#### Scenario: Agent without the decision permission
- **WHEN** a host's agent whose grant lacks `host:decide` calls `approve_proposal`
- **THEN** the call is refused for insufficient scope naming `host:decide`, and nothing is approved

#### Scenario: Requester agent agrees within delegation
- **WHEN** a requester's agent with `request:decide` agrees to the current proposal version
- **THEN** the agreement is recorded against that version and the request waits for the host's approval
