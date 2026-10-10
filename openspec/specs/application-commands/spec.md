# application-commands Specification

## Purpose

Provide consistent authorization, safe diagnostics, and retry outcomes for scheduling operations regardless of the invoking interface.

## Requirements

### Requirement: Verified authority
The service SHALL derive actor identity and resource permissions from verified credentials and reject unverified actor claims before reading or mutating private state.

#### Scenario: Client supplies another actor
- **WHEN** a caller supplies an actor identifier without credentials authorizing that actor
- **THEN** the protected operation is rejected and no private resource data is returned

#### Scenario: Direct database bypass
- **WHEN** a public or ordinary authenticated database client invokes the privileged command boundary
- **THEN** execution is denied

### Requirement: Stable retry semantics
Mutations SHALL bind retry keys to actor, operation, resource, and normalized input. Identical authorized retries SHALL return their saved outcome; changed input with the same key SHALL be rejected.

#### Scenario: Identical retry
- **WHEN** the same authorized mutation and key are repeated
- **THEN** the saved result is returned without repeating the mutation or its jobs

#### Scenario: Conflicting retry key
- **WHEN** a retry key is reused with changed input
- **THEN** a stable conflict error is returned without changing state

### Requirement: Audience-safe diagnostics
Responses and logs SHALL expose stable error categories and correlation identifiers while omitting secrets, private calendar content, and fields outside the caller's audience.

#### Scenario: Provider authentication fails
- **WHEN** a provider rejects credentials during a protected operation
- **THEN** the caller sees a safe recovery error and diagnostics omit tokens and private transcripts

### Requirement: Honest configuration status
The service SHALL distinguish application reachability from provider readiness and reject dependent operations when required configuration is absent.

#### Scenario: Missing provider secret
- **WHEN** an operation requires a provider secret that is not configured
- **THEN** the operation reports unavailable configuration without substituting test results or fabricated success
