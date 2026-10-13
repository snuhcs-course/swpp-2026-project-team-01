# Spec Delta

## Purpose

Let a requester delegate initial scheduling to a personal agent for one host without a product account or manual booking-page data entry, while preserving scoped authority and explicit meeting decisions.

## ADDED Requirements

### Requirement: Explicit future-request consent
The requester SHALL explicitly grant or deny one client permission to create one request for a displayed public host. Consent SHALL require no product login or manual meeting-details entry. A public URL, client registration or model assertion SHALL NOT create this authority. Before creation, the grant SHALL permit only its host-bound intake operations.

#### Scenario: Consent without an existing request
- **WHEN** a requester approves the displayed client, host and intake permissions
- **THEN** the client receives bounded intake authority without access to existing requests, host-private data or host operations

#### Scenario: Denied or unavailable host
- **WHEN** consent is denied or the host is not currently publicly ready
- **THEN** no usable intake authority or meeting request is created and the limitation is reported truthfully

### Requirement: One idempotent delegated creation
An intake grant SHALL create at most one request for its fixed host through current public-readiness checks. Exact retries SHALL recover the same authorized result; changed input under the same key SHALL conflict. Missing or ambiguous required details SHALL return actionable clarification without inventing values or creating a malformed request.

#### Scenario: Lost creation result
- **WHEN** creation commits and its response is lost
- **THEN** retry returns the same request and creates no second request, grant binding or booking work

#### Scenario: Host or input changes
- **WHEN** a caller changes the host, supplies incomplete required details or readiness changes during creation
- **THEN** creation fails without silently retargeting the grant or using stale readiness

### Requirement: Bound continuation and private browser access
After creation, the grant SHALL authorize only its bound request and consented requester permissions. Human browser continuation SHALL preserve that same request without exposing continuation credentials to model context, command arguments or normal terminal output. Grant revocation and request rotation, closure or expiry SHALL deny further agent access.

#### Scenario: Foreign request and host actions
- **WHEN** an intake client supplies another request or attempts private host access or host approval
- **THEN** access fails regardless of supplied identifiers or claimed delegation

#### Scenario: Revoke after creation
- **WHEN** the requester revokes the grant or the bound request loses continuation authority
- **THEN** reads, writes and refresh fail while permitted browser receipt behavior retains its existing limits

### Requirement: Complete agent entry surfaces
MCP and CLI SHALL expose the same host-bound intake contract and truthful machine-readable outcomes. Public host instructions SHALL enable initial delegated creation rather than require prior booking-page intake. Consent and separately required human decisions MAY use protected browser handoffs; client limitations SHALL remain explicit.

#### Scenario: Sufficient delegated context
- **WHEN** a connected requester agent has consent and sufficient authorized meeting details
- **THEN** it creates and continues one request without manual booking-page entry, and reports pending approval until a separately approved booking is confirmed

#### Scenario: Missing information or authority
- **WHEN** requested details or an option exceed the requester's supplied delegation
- **THEN** the agent asks for the missing information or decision rather than fabricating it or approving for the host
