## MODIFIED Requirements

### Requirement: Role-bound permission scopes
Host resources SHALL accept `host:read`, `host:write` and `host:decide` and, for the account's own requester tools, `request:read`, `request:write` and `request:decide`; requester resources SHALL accept only the request scopes. `host:decide` SHALL permit approving the current agreed proposal and declining a request when the host asks in their own words; a host grant without it SHALL NOT list or call the decision tools. `request:decide` SHALL permit agreeing to the current proposal and withdrawing the request. Refresh SHALL NOT widen scopes.

#### Scenario: Scope of another role
- **WHEN** an authorization request for a requester resource asks for `host:write`
- **THEN** it fails with `invalid_scope` and no transaction is recorded

#### Scenario: Agent approves for the host
- **WHEN** a host's agent with `host:decide` approves the current agreed proposal version with the host's words
- **THEN** the approval is recorded against that version and the booking starts

#### Scenario: Agent without the decision permission
- **WHEN** a host's agent whose grant lacks `host:decide` calls `approve_proposal`
- **THEN** the call is refused for insufficient scope naming `host:decide`, and nothing is approved

#### Scenario: Agent prepares an approval
- **WHEN** a host's agent with `host:decide` asks to approve the current proposal version without the host's words
- **THEN** the call is refused as invalid input and nothing is approved; the agent asks the host, or gives them the request's review link in `/app`

#### Scenario: Requester agent agrees within delegation
- **WHEN** a requester's agent with `request:decide` agrees to the current proposal version
- **THEN** the agreement is recorded against that version and the request waits for the host's approval

### Requirement: Explicit scoped client consent
The initiating protected browser SHALL display client identity, the redirect host and the requested permissions, SHALL let the person narrow the permissions, and SHALL require explicit grant or deny. A grant SHALL bind one current admitted account, one currently authorized request, or one future request for the displayed host. An account grant SHALL reach sent requests only with explicitly consented requester scopes and verified account/request associations, never contact-email matching. Read, write and decision permissions SHALL remain distinct. Host consent SHALL require a signed-in eligible host and SHALL survive the sign-in it needs without losing the authorization transaction. Account-free requester consent SHALL require no product login. The decision SHALL be accepted only from the browser that opened the transaction, from the application's own origin, while the transaction is live and undecided.

#### Scenario: Requester grants access
- **WHEN** a requester consents from a valid private request continuation
- **THEN** only that request and the chosen requester permissions are granted, with no host/private history access

#### Scenario: Client claims human approval
- **WHEN** a client presents a decision permission or model-generated approval statement
- **THEN** the claim decides nothing: a host decision still needs the host's own words passed with the call or the host's own action in the browser

#### Scenario: Host signs in during consent
- **WHEN** a signed-out host follows a client's authorization request, signs in with Google and returns
- **THEN** the consent page shows the same transaction and client, and no grant exists until the host chooses **Allow**

#### Scenario: Consent narrowed
- **WHEN** a host unchecks `host:write` before choosing **Allow**
- **THEN** the grant and every token from it carry only the remaining permissions and the write tools are absent from the client's tool list

#### Scenario: Consent denied
- **WHEN** the person chooses **Deny**
- **THEN** the client receives `access_denied`, no grant or code exists and the transaction cannot be decided again

#### Scenario: Decision from another browser
- **WHEN** a consent decision arrives without the browser binding of the browser that opened the transaction
- **THEN** it is refused and the transaction stays undecided

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
