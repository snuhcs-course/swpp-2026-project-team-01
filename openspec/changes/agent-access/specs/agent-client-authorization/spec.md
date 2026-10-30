## MODIFIED Requirements

### Requirement: Explicit scoped client consent
The initiating protected browser SHALL display client identity, the redirect host and the requested permissions, SHALL let the person narrow the permissions, and SHALL require explicit grant or deny. A grant SHALL bind one current admitted host, one currently authorized request, or one future request for the displayed host. Read, write and decision permissions SHALL remain distinct. Host consent SHALL require a signed-in eligible host and SHALL survive the sign-in it needs without losing the authorization transaction. Account-free requester consent SHALL require no product login. The decision SHALL be accepted only from the browser that opened the transaction, from the application's own origin, while the transaction is live and undecided.

#### Scenario: Requester grants access
- **WHEN** a requester consents from a valid private request continuation
- **THEN** only that request and the chosen requester permissions are granted, with no host/private history access

#### Scenario: Client claims human approval
- **WHEN** a client presents a decision permission or model-generated approval statement
- **THEN** the service still requires separately attributable current human confirmation for the meeting decision

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

### Requirement: Current grant enforcement and revocation
Every protected operation and refresh SHALL check active client/grant state and current underlying host or request authority. Grant revocation, client disablement, host authority loss, requester rotation, closure or expiry SHALL deny further access even if a signed token has not expired. After a request closes, its grants SHALL permit only reading the request's closed status and receipt, and refreshing for that, until the booking link's closed-access lifetime ends.

#### Scenario: Closed requester grant
- **WHEN** a request closes after an agent token was issued
- **THEN** that token cannot read the conversation or mutate the request, and it and its refresh can read only the closed status and receipt until the booking link's closed-access lifetime ends

#### Scenario: Agent reports the confirmed booking
- **WHEN** the host approves and the booking is confirmed, closing the request, and the requester's agent reads the request afterwards
- **THEN** it sees the confirmed status and the receipt, and any mutation is refused

#### Scenario: Host suspended
- **WHEN** an operator suspends a host after the host connected an agent
- **THEN** the agent's calls and refreshes are refused until the host is restored

## ADDED Requirements

### Requirement: Discoverable resource-bound authorization
Each MCP endpoint SHALL be a protected resource whose identifier is its exact URL: `{origin}/mcp` for hosts and `{origin}/{handle}/mcp` for the requesters of one ready host. The service SHALL publish protected-resource metadata for each resource, authorization-server metadata for each served origin, and a key set with only public verification keys. Unauthenticated or invalid calls SHALL answer `401` with a challenge naming the resource metadata and the role's scopes; insufficient permissions SHALL answer `403` with `insufficient_scope` and the permissions the operation needs. Authorization responses SHALL carry the issuer.

#### Scenario: Client discovers the server
- **WHEN** a client calls `/mcp` without a token
- **THEN** the challenge names the host resource metadata, whose authorization server metadata lists S256 PKCE, the token, registration and revocation endpoints and metadata-document support

#### Scenario: Unknown host resource
- **WHEN** a client asks for the resource metadata of `/{handle}/mcp` for an unknown, unready or suspended handle
- **THEN** the answer is a neutral not-found that reveals no reason

### Requirement: Bounded client registration
The service SHALL accept clients identified by a client ID metadata document, clients registered dynamically and its own pre-registered command-line client. Metadata documents SHALL be fetched only from `https` URLs with a path on public addresses, without redirects, within fixed time and size limits, and SHALL be accepted only when their `client_id` equals the URL. Redirect URIs SHALL be `https` or loopback `http`, matched exactly except that a loopback redirect's port, on `127.0.0.1`, `[::1]` or `localhost`, may differ. Registration SHALL be rate-limited and SHALL grant no application authority.

#### Scenario: Metadata document names another client
- **WHEN** the fetched document's `client_id` differs from its URL or it lists no redirect URIs
- **THEN** the authorization request fails with an error page and no redirect

#### Scenario: Unregistered callback
- **WHEN** an authorization request names a redirect URI its client did not register
- **THEN** the service shows an error page and never redirects to that URI

#### Scenario: Native client on a free loopback port
- **WHEN** a client that registered `http://localhost/callback` asks to return to `http://localhost:54545/callback`
- **THEN** the redirect is accepted, while a different host or path on that port is refused

#### Scenario: Registration flood
- **WHEN** one source registers more clients than the hourly bound
- **THEN** further registrations are refused with a retry time and no client is created

### Requirement: Role-bound permission scopes
Host resources SHALL accept only `host:read`, `host:write` and `host:decide`; requester resources SHALL accept only `request:read`, `request:write` and `request:decide`. `host:decide` SHALL only prepare an approval or decline of the current proposal for the host's own confirmation in the browser. `request:decide` SHALL permit agreeing to the current proposal and withdrawing the request. Refresh SHALL NOT widen scopes.

#### Scenario: Scope of another role
- **WHEN** an authorization request for `/mcp` asks for `request:write`
- **THEN** it fails with `invalid_scope` and no transaction is recorded

#### Scenario: Agent prepares an approval
- **WHEN** a host's agent with `host:decide` asks to approve the current proposal version
- **THEN** nothing is approved, and the agent receives the request's review link in `/app`, where the host's own **Approve this proposal** decides

#### Scenario: Requester agent agrees within delegation
- **WHEN** a requester's agent with `request:decide` agrees to the current proposal version
- **THEN** the agreement is recorded against that version and the request waits for the host's approval

### Requirement: One future request grant
A requester resource's consent SHALL offer a grant for one future request with the displayed host, without an account. Until it creates a request the grant SHALL permit only reading the host's public profile and creating one request, and SHALL expire after 24 hours. Creation SHALL bind the grant to the new request permanently: an exact retry with the same retry key SHALL return the same request, and any other creation SHALL be refused. Creation SHALL count toward the request creation bounds of the consenting browser's source, SHALL send the creation email with the booking link to the requester's address and SHALL NOT return the booking link to the client. Creation SHALL grant no agreement, host approval, contact confirmation or Calendar consent. Consent SHALL also accept the person's booking link to connect an open request of the same host instead.

#### Scenario: Agent creates the request
- **WHEN** a requester's agent with a new grant creates a request with the requester's name, email, timezone and meeting details
- **THEN** one request exists for the displayed host, the requester's inbox receives the booking link, and the agent's grant now reaches only that request

#### Scenario: Lost creation response
- **WHEN** the agent repeats the creation with the same retry key after losing the response
- **THEN** it receives the same request and no second request or email is created

#### Scenario: Second request
- **WHEN** the agent tries to create another request with a different retry key
- **THEN** it is refused as already created and the bound request is unchanged

#### Scenario: Host no longer available
- **WHEN** the displayed host becomes unready or suspended before the agent creates the request
- **THEN** creation answers unavailable without naming the reason or choosing another host

#### Scenario: Booking link of another host
- **WHEN** a person pastes a booking link of another host's request on a requester consent page
- **THEN** the page answers that the link does not match this host and no grant is created

### Requirement: Connected agent management
A host SHALL be able to list its agent grants in `/app`, with the client name, redirect host, permissions, connection and last-use times, and revoke each. A requester SHALL be able to list and revoke the grants on its request from the booking page. Revocation SHALL take effect on the next call or refresh.

#### Scenario: Host revokes a client
- **WHEN** a host revokes a connected client in **Connected agents**
- **THEN** the client's next call and refresh are refused, and the host can still review requests on the web

#### Scenario: Requester revokes an agent
- **WHEN** a requester revokes their agent from the booking page
- **THEN** the agent loses access to the request and the request continues on the web
