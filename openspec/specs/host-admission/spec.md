# host-admission Specification

## Purpose
Control access to calendar hosting through verified single-use invitations while preserving public waitlist and account-free requester journeys.

## Requirements

### Requirement: Public deduplicated waitlist
The service SHALL accept a validated email and optional name without host admission and deduplicate repeated enrollment without exposing other applicants.

#### Scenario: Repeated enrollment
- **WHEN** the same normalized email joins the waitlist repeatedly
- **THEN** one pending entry exists and the public response reveals no other applicants

### Requirement: Operator-controlled invitations
Only an authorized operator SHALL issue or revoke host invitations. Invitations SHALL target one verified email, expire seven days after issuance, and remain unusable after revocation.

#### Scenario: Readable invitation code
- **WHEN** an operator issues a host invitation
- **THEN** the recipient receives a sixteen-character, 80-bit random invitation code in four groups, separate from the setup URL; only its hash is persisted, and code possession without the matching verified account does not grant admission

#### Scenario: Unauthorized issuance
- **WHEN** a requester or ordinary host attempts to issue an invitation
- **THEN** the service rejects issuance without creating an invitation

#### Scenario: Expired or revoked invitation
- **WHEN** redemption presents an invitation after expiry or revocation
- **THEN** no admission is granted

### Requirement: Atomic bound redemption
Redemption SHALL atomically consume an unused invitation and admit its verified recipient account. Same-account retries SHALL preserve that admission; another account SHALL not consume or reuse it.

#### Scenario: Recipient mismatch
- **WHEN** the authenticated verified email differs from the invitation recipient
- **THEN** redemption is rejected and the invitation remains unconsumed

#### Scenario: Concurrent redemption
- **WHEN** two accounts concurrently redeem the same token
- **THEN** only the bound verified recipient can receive admission and at most one consumption occurs

#### Scenario: Same-account retry
- **WHEN** the admitted recipient repeats the successful redemption
- **THEN** the service returns saved setup status without duplicate admission

### Requirement: Shared admission and readiness guards
Host setup, host calendar connection, and hosting operations SHALL require admission. Public booking profiles SHALL require admitted hosts with confirmed rules, timezone, unique handle, and a valid writable booking destination.

#### Scenario: Direct setup bypass
- **WHEN** a signed-in uninvited account calls host setup or host calendar connection directly
- **THEN** the operation is rejected with the next admission action

#### Scenario: Incomplete setup
- **WHEN** an admitted host has not selected a writable booking calendar or confirmed required settings
- **THEN** setup remains resumable and the host is not available for public requests

### Requirement: Stable public identity
Assigned host handles SHALL uniquely identify one stable host. An old public handle SHALL not silently resolve to a different host.

#### Scenario: Handle collision
- **WHEN** another host attempts to claim an assigned handle
- **THEN** setup rejects the collision without changing either identity

### Requirement: Requesters remain admission-independent
Public requests and request-scoped requester Calendar consent SHALL remain available without host admission or a product account.

#### Scenario: Uninvited requester
- **WHEN** an uninvited requester visits a ready host and starts intake or optional requester consent
- **THEN** neither operation requires a host invitation or product signup
