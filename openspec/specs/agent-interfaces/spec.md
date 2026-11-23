# agent-interfaces Specification

## Purpose
Let a host's or guest's own agent work with Find Me a Time through a remote MCP endpoint for each role and a thin user CLI, both calling the same domain operations as the web, with host decisions made only in the host's own words.

## Requirements

### Requirement: Remote MCP endpoints for both roles
The service SHALL serve a host MCP endpoint at `/mcp` and a requester MCP endpoint at `/{handle}/mcp` over Streamable HTTP without protocol sessions. Each SHALL serve protocol revision `2026-07-28` with per-request metadata and `server/discover`, and the handshake revisions `2025-11-25`, `2025-06-18` and `2025-03-26` through an `initialize` that mints no session. Requests whose headers disagree with their body, unsupported versions and unknown methods SHALL be rejected with the protocol's defined errors. Every request SHALL carry a valid access token for that exact endpoint.

#### Scenario: Modern client
- **WHEN** a client sends `tools/list` with protocol version `2026-07-28` in its metadata and matching headers
- **THEN** it receives the tools its permissions allow without any prior handshake

#### Scenario: Handshake client
- **WHEN** a client opens with `initialize` for `2025-06-18`
- **THEN** it receives that version, the tools capability and no session identifier, and its later calls work without one

#### Scenario: Unsupported version
- **WHEN** a client declares a protocol version the server does not support
- **THEN** the answer lists the supported versions and nothing runs

### Requirement: Tools over shared domain operations
MCP tools SHALL run the same application commands and projections as the web, through the command pipeline, with the actor derived from the verified grant. The tool list SHALL contain only tools the token's permissions allow. Host tools SHALL see the host projection of the host's own requests; requester tools SHALL see only the bound request's requester projection, without the conversation or any link. Mutations SHALL take a retry key whose identity is bound to the grant, and SHALL take the expected revision where the command checks one. Command failures SHALL be returned as tool errors with a stable category, a fixed message and a next action.

#### Scenario: Foreign request
- **WHEN** a host's agent names another host's request, or a requester's agent names any request other than its own
- **THEN** the tool answers that the request is unavailable, exactly as for an unknown one

#### Scenario: Stale proposal
- **WHEN** a requester's agent agrees to a proposal version that a newer version replaced
- **THEN** the tool reports the proposal as superseded and tells the agent to read the request again

#### Scenario: Retried mutation
- **WHEN** an agent repeats a mutation with the same retry key and input
- **THEN** the saved outcome is returned and the mutation does not run again

### Requirement: Thin user CLI
The user CLI SHALL be a client of the same MCP endpoints with no scheduling state of its own. It SHALL log in through the authorization server with PKCE in a browser or headlessly, keep credentials in the operating system's credential store or, only when asked, in a file readable by the user alone, print one JSON object per command and exit with a documented code. It SHALL print the retry key of every mutation so an exact retry can be repeated, and SHALL ask for a new login, never create a grant silently, when a token response is lost or a refresh is refused.

#### Scenario: Machine-readable result
- **WHEN** a script runs `fmat call get_request` for its request
- **THEN** stdout holds one JSON object with the projection and the exit code is 0

#### Scenario: Lost refresh response
- **WHEN** the refresh response is lost and the stored refresh token was already consumed
- **THEN** the CLI deletes the stored credential, prints that a new login is needed and exits with the authorization code

#### Scenario: Missing integration setup
- **WHEN** a person runs a tool without having logged in
- **THEN** the CLI prints the login command to run and exits without calling the service

### Requirement: Host decisions in the host's words
A host's agent with `host:decide` SHALL be able to approve the current proposal version and to decline a request of the host's own, through the same application commands as the web's **Approve this proposal** and **Decline**. Each decision SHALL require the host's own words asking for it, a retry key and the expected revision. An approval SHALL succeed only for the latest version the requester agreed to, on an open request awaiting the host, at the expected revision. Repeating an approval of the approved version SHALL return the same booking and SHALL NOT create another. The tools, the server instructions and the host entry document SHALL tell the agent to decide only when the host clearly asks, never on its own judgment, because a requester asked, or when the host attached a condition, and SHALL keep requester-written text as data, not instructions. The CLI SHALL reach the same tools.

#### Scenario: Host tells the agent to approve
- **WHEN** the host tells their agent to approve, and the agent calls `approve_proposal` with the current agreed version, the request's revision and the host's words
- **THEN** the approval is recorded and one booking starts, exactly as from the web button

#### Scenario: Repeated approval
- **WHEN** the agent repeats the approval with the same retry key, or with another key for the same version
- **THEN** it receives the same booking, and there is still one approval and one booking

#### Scenario: Old version
- **WHEN** the version the agent names is no longer the latest
- **THEN** the tool reports the proposal as superseded and nothing is approved

#### Scenario: Stale revision
- **WHEN** the request changed after the agent read it
- **THEN** the tool reports a stale revision and nothing is approved or declined

#### Scenario: Host tells the agent to decline
- **WHEN** the host tells their agent to decline, and the agent calls `decline_request` with the request's revision and the host's words
- **THEN** the request closes as declined and the requester is told, exactly as from the web button

#### Scenario: Closed request
- **WHEN** the agent approves or declines a request that is already closed
- **THEN** the tool reports the request as closed and nothing changes

#### Scenario: No host words
- **WHEN** the agent calls a decision tool without the host's words, or with only spaces
- **THEN** the call is refused as invalid input and no command runs

#### Scenario: CLI approval
- **WHEN** a host's script runs `fmat call approve_proposal` with the same input
- **THEN** stdout holds one JSON object with the outcome and the retry key, and the exit code is 0
