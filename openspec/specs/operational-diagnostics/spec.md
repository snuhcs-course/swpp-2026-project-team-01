# operational-diagnostics Specification

## Purpose

Give authorized operators a redacted, read-only view of persisted work and uncertain outcomes without granting recovery or meeting-decision authority.

## Requirements

### Requirement: Explicit operator target
Inspection SHALL require a server credential and an explicit selected environment that matches its database origin. Ordinary authenticated, anonymous and agent callers SHALL NOT access the operational snapshot.

#### Scenario: Wrong environment or credential
- **WHEN** a caller selects a different project from the configured database or uses an ordinary client credential
- **THEN** inspection fails without returning diagnostic state

#### Scenario: Authorized operator
- **WHEN** a server-authorized operator selects the matching project
- **THEN** the operator receives a versioned snapshot with its database observation time

### Requirement: Redacted bounded snapshot
Inspection SHALL return only fixed signal categories, counts, oldest timestamps and at most twenty opaque identifiers per category. It SHALL exclude credentials, recipient identities, provider references, payloads, calendar data, transcripts and raw failure text, including from errors.

#### Scenario: Many unhealthy records
- **WHEN** a category contains more records than the requested sample limit
- **THEN** its count includes all matching records while its oldest-first sample remains bounded and deterministic

#### Scenario: Sensitive error or stored content
- **WHEN** stored data or an upstream failure contains private text
- **THEN** that text is absent from command output and errors

### Requirement: Read-only interpretation
Inspection SHALL preserve all jobs, leases, approvals, requests, reservations and provider outcomes. It SHALL identify telemetry that is not measured and SHALL NOT treat an empty snapshot or an expired lease as proof of provider readiness, failed delivery or release readiness.

#### Scenario: Uncertain write and held reservation
- **WHEN** a possibly dispatched booking holds a reservation
- **THEN** inspection reports the saved uncertainty and reservation without clearing either or issuing another provider write

#### Scenario: Missing event instrumentation
- **WHEN** authorization-denial or rejected-stale-action rates are not durably recorded
- **THEN** the snapshot labels that coverage unavailable instead of reporting zero events or a healthy status

### Requirement: Bounded rejection observations
Explicitly enabled server collection SHALL record only fixed authorization-denial and stale-action categories for recognized rejected database RPC attempts. It SHALL exclude caller/resource identities, input, credentials, raw errors and provider content. Counts SHALL use at most 24 hourly buckets per category and disclose saturation.

#### Scenario: Recognized rejection with private input
- **WHEN** a database RPC rejects an attempt in a recognized category
- **THEN** collection sends only the category and the stored observation contains no request or error content

#### Scenario: Concurrent or aged counters
- **WHEN** concurrent observations arrive or an observation follows expired buckets
- **THEN** accepted increments are atomic, out-of-window buckets are pruned on write, and counts remain bounded with saturation visible

### Requirement: Rejection collection preserves outcomes
Collection SHALL have an independent bounded wait, no retry and no recursion. Disabled collection, storage failure, timeout and unrecognized errors SHALL NOT change the original database result, error or domain state. Successful actions SHALL NOT be recorded as rejections.

#### Scenario: Telemetry unavailable
- **WHEN** collection fails or its deadline elapses after a rejected RPC
- **THEN** the caller receives the same original rejection without waiting indefinitely or performing another domain action

#### Scenario: Disabled or unrelated result
- **WHEN** collection is disabled or the RPC returns success or an unrecognized error
- **THEN** no rejection observation is sent

### Requirement: Truthful rejection inspection
An explicitly targeted server-authorized operator SHALL be able to inspect counts for the current and preceding 23 UTC hourly buckets without mutation. The result SHALL identify its best-effort database-only scope, missing pre-database/uncategorized coverage and partial current bucket. Empty or saturated counts SHALL NOT be presented as complete event rates, collection health or release readiness.

#### Scenario: Unauthorized or wrong-target inspection
- **WHEN** a browser/anonymous caller requests counts or the operator selects a mismatched project
- **THEN** inspection fails without revealing counters

#### Scenario: Partial observed activity
- **WHEN** the operator requests the rejection snapshot
- **THEN** fixed categories, bounded counts, observation/window timestamps and coverage limits are returned without changing counters or domain work
