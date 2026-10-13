# Spec Delta

## ADDED Requirements

### Requirement: Bounded requester contact verification
A currently authorized requester SHALL explicitly request and enter a code sent to the request's current email before that address is trusted for attendee use. Codes SHALL expire, permit at most five failed guesses, and be invalidated by a new code, contact change, credential rotation or closure. Sending SHALL enforce a resend cooldown and per-request hourly limit.

#### Scenario: Correct current code
- **WHEN** the requester submits a current unexpired code for the same request, credential and contact
- **THEN** only that contact becomes verified, with no login session, replacement request credential, agreement, host approval or booking

#### Scenario: Attempts exhausted
- **WHEN** five distinct invalid confirmation commands are submitted for a code
- **THEN** further confirmation is denied, including a later correct guess, until an allowed new challenge is issued

#### Scenario: Changed contact or authority
- **WHEN** the contact, request credential or lifecycle changes after a code is issued
- **THEN** the old code cannot verify the new contact or regain authority

### Requirement: Recoverable contact verification commands
Repeated verification commands SHALL preserve their logical identity across lost responses. Duplicate code requests SHALL create no second challenge or email, and repeated confirmation commands SHALL not consume another attempt or repeat successful state changes. Browser reload SHALL recover current status without exposing the code or private delivery content.

#### Scenario: Response lost after commit
- **WHEN** a request or confirmation commits but the response is lost
- **THEN** retrying the same command recovers its saved result without another email or state change

### Requirement: Honest verification delivery
Verification SHALL use durable Cloudflare delivery with frozen sender/content and recipient rechecks. Possible dispatch SHALL prevent automatic resending, and failed or uncertain delivery SHALL remain distinct from successful contact verification. The requester SHALL have labeled keyboard-operable controls and truthful queued, failed, uncertain, expired and verified states.

#### Scenario: Uncertain email
- **WHEN** the send response is lost after possible provider acceptance
- **THEN** verification remains unproven, the saved send is not repeated, and the requester can explicitly request a new code after the cooldown
