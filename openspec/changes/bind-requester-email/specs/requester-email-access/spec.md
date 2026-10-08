# Spec Delta

## Purpose

Bind a requester's authenticated email messages to exactly one currently authorized scheduling request without deriving authority from addresses or provider thread grouping.

## ADDED Requirements

### Requirement: Protected enrollment
Only a current requester with verified contact SHALL initiate email linking. Enrollment SHALL use a short-lived, one-time proof bound to the current request credential, verified contact and configured receiver. Retries SHALL recover the original pending proof without creating additional links. Proofs SHALL stay outside conversation/model history.

#### Scenario: Lost enrollment response
- **WHEN** enrollment commits but its response is lost
- **THEN** the same operation recovers the existing proof and expiry without issuing a new link

#### Scenario: Unverified contact
- **WHEN** a caller has a private request link but has not verified the current contact
- **THEN** email enrollment is denied

### Requirement: Authenticated binding
Binding SHALL require a received message with matching one-time proof and independently verified signed author, identity and full content. The resulting request, contact, inbox, receiver generation and thread association SHALL be immutable. A different or previously bound thread SHALL not be reassigned through a replay.

#### Scenario: Forwarded linking message
- **WHEN** a different sender forwards or copies a valid linking message
- **THEN** it cannot bind or reveal the request

#### Scenario: Replayed enrollment
- **WHEN** the same receipt is retried after successful binding
- **THEN** the existing binding is recovered without duplicating authority or effects

### Requirement: Current per-message authority
Every email operation SHALL recheck current receiver, verified contact, request credential, expiry and lifecycle. Revocation, contact change, credential rotation or closure SHALL invalidate existing links. Receipts received before binding SHALL not acquire authority retroactively. Domain authentication alone SHALL not grant request access, agreement or host approval.

#### Scenario: Delayed pre-binding message
- **WHEN** an older receipt is processed after a thread is linked
- **THEN** it cannot use that new binding

#### Scenario: Contact changes away and back
- **WHEN** the requester changes contact and later restores the former address
- **THEN** the former email link remains revoked and requires new enrollment

### Requirement: Protected linking controls
The protected booking page SHALL expose current link state, explicit enrollment, pending-message instructions and revocation. It SHALL preserve operation identity across uncertain responses, remove sensitive linking content after completion and direct unavailable verification to protected browser continuation.

#### Scenario: Channel unavailable
- **WHEN** the receiver or verification is unavailable
- **THEN** the page does not claim email is linked and the requester can continue through the protected web conversation
