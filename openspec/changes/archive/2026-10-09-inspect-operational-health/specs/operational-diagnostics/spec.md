# Operational diagnostics delta

## Purpose

Give authorized operators a redacted, read-only view of persisted work and uncertain outcomes without granting recovery or meeting-decision authority.

## ADDED Requirements

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
