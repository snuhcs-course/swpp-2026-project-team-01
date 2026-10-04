# meeting-requests Specification

## Purpose
Carry one account-free meeting request through protected, versioned negotiation and host review while keeping each audience's information separate.

## Requirements

### Requirement: Complete account-free intake
Ready public hosts SHALL accept requests without requester signup. The service SHALL collect purpose, requester identity/contact, date windows, timezone, duration, mode, and location or meeting link, clarifying missing or ambiguous fields.

#### Scenario: Missing details
- **WHEN** a requester asks for thirty minutes next week without timezone or location
- **THEN** the request remains gathering with specific missing-field actions and no fabricated proposal

#### Scenario: Bilingual intake
- **WHEN** English or Korean intake supplies sufficient details
- **THEN** the service normalizes validated details and preserves the requester's stated intent

### Requirement: Protected request continuation
Guest credentials SHALL authorize exactly one request, be stored as hashes server-side, expire within thirty days, and lose mutation, OAuth, and recovery authority on request closure. The existing unexpired request-bound credential SHALL permit only a minimal terminal status and confirmed-booking receipt read, excluding private discussion and historical provider context. Credential recovery SHALL verify the original contact before issuing replacement authority.

#### Scenario: Wrong request token
- **WHEN** a guest uses a continuation token for a different request
- **THEN** access is denied without revealing that request

#### Scenario: Unverified recovery contact
- **WHEN** a caller requests replacement authority using an unverified email claim
- **THEN** no usable continuation credential is issued

#### Scenario: Final receipt after asynchronous booking
- **WHEN** a valid unexpired request-bound credential polls after the request closes
- **THEN** only its final status and confirmed booking receipt are readable, and mutation, new OAuth, and recovery actions are rejected

### Requirement: Immutable current proposals
Each material meeting revision SHALL create a new immutable proposal version. Time, duration, participants, mode, or location changes SHALL invalidate applicable prior agreement and approval, requiring current decisions.

#### Scenario: Host changes agreed details
- **WHEN** the host revises a proposal after requester agreement
- **THEN** a new version is current and agreement and approval for old details cannot authorize booking

#### Scenario: Stale agreement
- **WHEN** the requester agrees to a superseded proposal
- **THEN** the action is rejected with current status and no decision on the newer proposal

### Requirement: Expected revision concurrency guards
Mutations of an existing request SHALL require its expected revision and reject stale input without overwriting intervening changes. Revision checks SHALL remain separate from same-operation idempotency.

#### Scenario: Concurrent stale mutation
- **WHEN** a mutation's expected revision differs from the current request revision
- **THEN** it is rejected with a stable conflict outcome and the intervening change remains intact

### Requirement: Persisted lifecycle and closure guards
Requests SHALL expose gathering, negotiating, awaiting host approval, booking, booked, declined, withdrawn, or expired status. Still-actionable requests SHALL expire seven days after creation or at the requested window end, whichever is earlier; terminal requests SHALL not reopen through replay.

#### Scenario: Requester withdraws before booking
- **WHEN** withdrawal commits before entry to booking
- **THEN** the request becomes withdrawn and late agreement or approval cannot create an event

#### Scenario: Expired request
- **WHEN** an actionable request reaches its seven-day deadline or the earlier requested-window end
- **THEN** later decisions are rejected and continuation requires a new or explicitly refreshed request

#### Scenario: Withdrawal during pending write
- **WHEN** withdrawal is attempted after booking may have begun
- **THEN** the pending outcome is reported without claiming that event creation was prevented

### Requirement: Audience-specific projections
Guest responses SHALL contain only their submitted details, shared proposals, permitted conversation, and relevant status. Host notes, rules, preference exceptions, and private calendar context SHALL remain host-only.

#### Scenario: Guest inspects request
- **WHEN** a requester reads a request containing private host discussion or exception reasoning
- **THEN** those fields and messages are absent from the guest response

### Requirement: Constrained asynchronous interpretation
AI extraction SHALL operate on audience-appropriate context and return validated structured results. It SHALL not create approval, waive rules, reveal private information, or overwrite newer revisions.

#### Scenario: Prompt injection
- **WHEN** intake tells the assistant to ignore approval rules or reveal calendar contents
- **THEN** authority and visibility guards remain enforced

#### Scenario: Stale extraction
- **WHEN** an extraction result completes after its request revision changes
- **THEN** it is discarded or recomputed before any state update

### Requirement: Accessible proposal review
Web intake and host review SHALL support phone widths, keyboard operation, labeled controls, readable validation, and exact proposal details in decision controls.

#### Scenario: Keyboard host review
- **WHEN** a host reviews a request using only the keyboard on a narrow screen
- **THEN** proposal details and available decision controls remain reachable and understandable without color-only status
