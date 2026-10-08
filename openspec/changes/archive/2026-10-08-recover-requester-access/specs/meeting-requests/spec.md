## ADDED Requirements

### Requirement: Private bounded recovery requests
Recovery SHALL accept a known request identifier and email without disclosing request existence, verified-contact state or delivery outcome. Only an active request's previously verified current contact SHALL receive a recovery link. Issuance SHALL permit at most one link per minute and five per hour per request, with a fifteen-minute lifetime bounded by request expiry. Exact retries SHALL create no extra delivery.

#### Scenario: Unknown or unverified contact
- **WHEN** a caller supplies a missing request, wrong email, unverified contact or closed request
- **THEN** the same generic acceptance is returned without sending recovery email or issuing authority

#### Scenario: Repeated issuance
- **WHEN** concurrent or retried issuance uses the same logical identity
- **THEN** at most one challenge and delivery are created, and changed input cannot replace that challenge

### Requirement: Atomic recovery credential replacement
A valid recovery proof SHALL atomically replace only its bound request credential. Old credentials, pending contact proofs and linked channels SHALL lose authority. Changed contact, revocation, supersession, closure or expiry SHALL invalidate the proof permanently. Recovery SHALL not create login, proposal agreement, host approval or booking.

#### Scenario: Lost redemption response
- **WHEN** a valid recovery redemption commits but its response is lost
- **THEN** the exact redemption can recover the same replacement credential while it remains current, without a second rotation

#### Scenario: Earlier proof after later change
- **WHEN** the contact changes and changes back, or another credential replaces the recovered credential
- **THEN** an earlier proof or successful replay cannot restore access

### Requirement: Accessible private recovery continuation
The booking destination SHALL offer recovery with labeled keyboard-operable controls and generic issuance feedback. Recovery links SHALL contain secrets only in a fragment, remove them immediately and exchange them for request-specific HttpOnly cookies. Delivery SHALL use durable frozen Cloudflare messages, suppress stale recipients and avoid blind resend after possible acceptance.

#### Scenario: Recover in a browser without prior access
- **WHEN** the verified recipient explicitly redeems an unexpired recovery link
- **THEN** the browser resumes only that request without placing the credential in query strings, browser storage or model context

#### Scenario: Uncertain delivery
- **WHEN** delivery may have succeeded but its acknowledgment is lost
- **THEN** the same message is not automatically resent and the caller sees no private delivery information

### Requirement: Aggregate recovery issuance limits
Recovery issuance SHALL allow at most five links per verified recipient per hour across requests and at most 120 links across the service per minute. A fixed-size budget SHALL bound accepted issuance attempts to 600 per minute without storing caller IPs or unknown email claims. Budget exhaustion SHALL preserve generic acceptance and issue no proof or email.

#### Scenario: Same recipient across requests
- **WHEN** five recovery links have been issued to a verified address within an hour
- **THEN** another request using that address receives generic acceptance without another recovery link

#### Scenario: Shared budget exhaustion
- **WHEN** either service-wide minute budget is exhausted
- **THEN** additional issuance produces no proof or delivery and normal issuance resumes in the next budget window
