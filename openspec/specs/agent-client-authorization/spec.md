# agent-client-authorization Specification

## Purpose

Let hosts and account-free requesters explicitly grant bounded personal-agent access without sharing their login, request-continuation or provider credentials.

## Requirements

### Requirement: Resource-bound authorization protocol
Authorization and code exchange SHALL require the exact configured resource. Refresh SHALL keep the resource its token is bound to: a refresh that omits the resource SHALL use that resource, and one that names a different resource SHALL be refused. The service SHALL support authorization codes with S256 PKCE and registered exact callbacks, rejecting duplicate parameters, malformed input, unsupported grants and missing or unknown scopes. Registration SHALL grant no application authority.

#### Scenario: Changed resource
- **WHEN** code exchange requests a different or omitted resource, or refresh requests a different resource
- **THEN** no usable token is issued even with otherwise valid credentials

#### Scenario: Refresh without a resource
- **WHEN** a client refreshes with a valid refresh token and no resource
- **THEN** the new access token is bound to the resource of the original grant

#### Scenario: Wrong verifier or callback
- **WHEN** a caller changes the registered callback or lacks the S256 verifier
- **THEN** code redemption fails without authorizing that caller

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

### Requirement: Signed bounded access tokens
Access tokens SHALL have a verified asymmetric signature, configured issuer, exact resource audience, access-token type, bounded expiry and client/grant/actor/permission binding. Tokens SHALL exclude login, continuation and provider secrets. Token-supplied keys, generic Auth tokens and Google credentials SHALL NOT establish agent authority.

#### Scenario: Foreign or altered token
- **WHEN** an access token has a wrong key, issuer, audience, type, expiry or modified claims
- **THEN** protected access is denied without returning private state

### Requirement: Durable single-use token lifecycle
Code consumption and refresh rotation SHALL be atomic. Code reuse SHALL NOT issue another token family. Refresh SHALL preserve or narrow the existing resource, client, actor, permission and expiry boundary. Reuse of a consumed refresh credential SHALL revoke its family, except that the same client presenting it again within a short grace window after its rotation, before any credential issued since has been used or revoked, SHALL receive another bounded credential pair in the same family. Retries beyond that bound SHALL be refused without revocation. Lost code-exchange responses SHALL require safe reauthorization rather than a new implicit grant.

#### Scenario: Concurrent code redemption
- **WHEN** two callers redeem the same code concurrently
- **THEN** at most one receives a usable token family

#### Scenario: Refresh replay
- **WHEN** an already-consumed refresh credential is reused after the grace window, by another client, or after its successor was used
- **THEN** no new access is issued and the affected family loses authority

#### Scenario: Refresh retried after a lost response
- **WHEN** the same client presents the refresh credential it just rotated again within the grace window, or sends two refreshes of it concurrently
- **THEN** each answer carries a usable pair in the same family with the same expiry, and the grant stays live

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

### Requirement: Bounded private protocol operation
Protocol endpoints SHALL enforce documented input/rate limits and return sanitized no-store errors. Only public verification keys SHALL be published. Private keys, codes, refresh credentials and underlying browser/provider credentials SHALL remain outside client metadata, logs and model context.

#### Scenario: Missing signing configuration
- **WHEN** signing material is absent or malformed
- **THEN** token issuance is unavailable without generating an ad hoc key or substituting provider credentials

### Requirement: Account requester identity
A request created through an account connection SHALL be identified with the account itself: its host display name and the Google address it signed in with, stored as the confirmed contact, and its host timezone unless the request names another; an account without a host timezone SHALL name one. The account connection SHALL NOT accept a typed requester name or email. The account's host conflict calendars SHALL count as the requester's busy time from creation, without a calendar question, and the creation result SHALL name those calendars. When the account's Calendar grant cannot be read, those calendars SHALL still count and finding times SHALL pause until the account reconnects Calendar, never treating the requester as free. An account without conflict calendars SHALL be linked with no host calendars. Nothing about the account's settings or calendars SHALL reach the other host.

#### Scenario: Account requests a meeting
- **WHEN** an account with request scopes calls `create_request` with only a host handle, meeting details and a retry key
- **THEN** the request carries the account's name and verified Google address as a confirmed contact and the account's host timezone, and the result names the account's conflict calendars

#### Scenario: Typed identity
- **WHEN** an account connection passes a name or email to `create_request`
- **THEN** the input is refused and no request is created

#### Scenario: Host calendars count
- **WHEN** times are found for a request created through an account connection whose account has confirmed host settings
- **THEN** the account's host conflict calendars count as the requester's busy time, and a failed host grant keeps them and pauses each search until Calendar is reconnected, instead of assuming free time

#### Scenario: Account without settings
- **WHEN** an account without confirmed host settings creates a request and names a timezone
- **THEN** the request is linked to the account with no host calendars, and without a timezone it is refused as invalid input

### Requirement: Requester agent agreement changes and honest decision results
A requester grant with `request:decide` SHALL be able to reopen its request's agreement while the request awaits the host's approval, through the same command as the booking page's **Change**, returning the request to choosing a time at a new revision so the earlier agreement can no longer be approved. After reopening, the grant's detail, time-finding and choosing tools SHALL work as before agreement. While the request awaits approval those tools SHALL refuse and name the reopening tool as the next step. The results of choosing and agreeing SHALL state what was recorded, so that only a recorded agreement tells the agent the host must now approve.

#### Scenario: Agent reopens a pending agreement
- **WHEN** a requester grant with `request:decide` reopens its request while it awaits the host's approval
- **THEN** the request returns to negotiating at a new revision, the host can no longer approve the earlier version, and the agent can change details, find times, choose and agree again

#### Scenario: Agent changes details without reopening
- **WHEN** a requester agent changes details, finds times or chooses a time while the request awaits the host's approval
- **THEN** the request is unchanged and the refusal names the reopening tool as the next step

#### Scenario: Nothing to reopen
- **WHEN** a requester agent reopens a request that no longer awaits the host's approval
- **THEN** nothing changes and the refusal says there is nothing to reopen, pointing a booked meeting to the booked-meeting change

#### Scenario: Chosen time is not an agreement
- **WHEN** a requester agent chooses a candidate time
- **THEN** the result says the chosen version is not yet agreed and the host has not been asked, and names the version to agree to once the person accepts it

#### Scenario: Agreement not recorded
- **WHEN** agreeing finds the host's time no longer free
- **THEN** the result says nothing was agreed and the host was not asked, and the request is not shown to the host as awaiting approval

### Requirement: Discoverable resource-bound authorization
Each MCP endpoint SHALL be a protected resource whose identifier is its exact URL: `{origin}/mcp` for hosts and `{origin}/{handle}/mcp` for the requesters of one ready host. The service SHALL publish protected-resource metadata for each resource, authorization-server metadata for each served origin, and a key set with only public verification keys. Unauthenticated or invalid calls SHALL answer `401` with a challenge naming the resource metadata and every scope the endpoint's tools need; insufficient permissions SHALL answer `403` with `insufficient_scope` and the permissions the operation needs. Authorization responses SHALL carry the issuer.

#### Scenario: Client discovers the server
- **WHEN** a client calls `/mcp` without a token
- **THEN** the challenge names the host resource metadata, whose authorization server metadata lists S256 PKCE, the token, registration and revocation endpoints and metadata-document support

#### Scenario: Unknown host resource
- **WHEN** a client asks for the resource metadata of `/{handle}/mcp` for an unknown, unready or suspended handle
- **THEN** the answer is a neutral not-found that reveals no reason

### Requirement: Bounded client registration
The service SHALL accept clients identified by a client ID metadata document, clients registered dynamically and its own pre-registered command-line client. Metadata documents SHALL be fetched only from `https` URLs with a path on public addresses, without redirects, within fixed time and size limits, and SHALL be accepted only when their `client_id` equals the URL. Redirect URIs SHALL be `https` or loopback `http`, matched exactly except that a loopback redirect's port, on `127.0.0.1`, `[::1]` or `localhost`, may differ. Registration SHALL be rate-limited and SHALL grant no application authority. Token requests SHALL be rate-limited per presented code or refresh token and per source, not per client ID, because one metadata document client ID is shared by everyone who uses that client.

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

#### Scenario: Many people on one hosted client
- **WHEN** more people than one client's former per-minute bound redeem or refresh their own credentials under the same metadata document client ID from a shared egress address
- **THEN** each request is admitted, while repeated requests with one credential are still refused with a retry time

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
