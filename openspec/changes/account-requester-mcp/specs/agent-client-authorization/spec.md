## MODIFIED Requirements

### Requirement: Explicit scoped client consent
The initiating protected browser SHALL display client identity and permissions and require explicit grant or deny. A grant SHALL bind one current admitted account or one currently authorized request. An account grant SHALL reach sent requests only with explicitly consented requester scopes and verified account/request associations, never contact-email matching. Read, write and decision permissions SHALL remain distinct. Account-free requester consent SHALL require no product login.

#### Scenario: Requester grants access
- **WHEN** a requester consents from a valid private request continuation
- **THEN** only that request and the chosen requester permissions are granted, with no host/private history access

#### Scenario: Client claims human approval
- **WHEN** a client presents a decision permission or model-generated approval statement
- **THEN** the service still requires separately attributable current human confirmation for the meeting decision

## ADDED Requirements

### Requirement: Account requester connection
A signed-in account with requester scopes SHALL create multiple requests for other hosts through the common MCP connection and manage its linked requests by explicit request ID. Each operation SHALL enforce scope, verified account ownership and request lifetime. Exact creation retries SHALL return the same request; changed arguments SHALL conflict. Anonymous per-host grants SHALL retain their single-request boundary.

#### Scenario: Multiple hosts and repeated meetings
- **WHEN** an account requests two hosts and another meeting with the first host using fresh retry keys
- **THEN** one common connection creates three distinct requests without another server

#### Scenario: Unauthorized request ID
- **WHEN** an account names an unlinked request, including one with the same contact email
- **THEN** the result is indistinguishable from an unknown request

#### Scenario: Existing consent
- **WHEN** a host-only token calls a requester tool
- **THEN** access requires additional consent on the same resource

#### Scenario: Fresh connection discovers the request scopes
- **WHEN** a client calls `/mcp` without a token and requests the scopes the challenge names
- **THEN** the challenge and the resource metadata name the host and request scopes, and the consent page offers all of them

#### Scenario: Meeting decisions
- **WHEN** an account agrees to a proposed time
- **THEN** the existing exact-proposal agreement and separate host approval remain required
