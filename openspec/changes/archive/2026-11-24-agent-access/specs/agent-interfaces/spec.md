## ADDED Requirements

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

### Requirement: Human confirmation of host decisions
No agent interface SHALL approve or decline a request. A host decision tool SHALL check that the named version is the current proposal awaiting the host and SHALL return the request's review in `/app`, where only the host's own action decides.

#### Scenario: Agent asks to approve
- **WHEN** a host's agent asks to approve the current version
- **THEN** no approval or booking exists until the host chooses **Approve this proposal** in `/app`

#### Scenario: Agent names an old version
- **WHEN** the version the agent names is no longer current
- **THEN** the tool reports it as superseded and returns no review link

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
