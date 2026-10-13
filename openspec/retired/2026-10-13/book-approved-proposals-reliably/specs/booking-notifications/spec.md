# Spec Delta

## Purpose

Expose confirmed booking outcomes to the correct participants and recover delivery independently without repeating calendar creation or leaking private context.

## ADDED Requirements

### Requirement: Separate audience-safe confirmations
Confirmed booking SHALL atomically create participant-appropriate confirmation records. Requester records SHALL exclude host-private notes, preferences, exception reasons, and calendar context.

#### Scenario: Guest confirmation content
- **WHEN** a request with private host notes becomes booked
- **THEN** the requester sees shared meeting details and confirmed status without private host fields

### Requirement: Delivery does not change booking outcome
Delivery failures and uncertain sends SHALL retain their own status/retry identity. A confirmed request SHALL remain booked and delivery retries SHALL never trigger event creation.

#### Scenario: Delivery fails after booking
- **WHEN** Calendar creation is confirmed but notification delivery fails
- **THEN** status remains booked and recovery targets only the delivery record

#### Scenario: Repeated delivery job
- **WHEN** a confirmation job is delivered again
- **THEN** it reuses its delivery identity and creates no Calendar event

### Requirement: Recheck recipients and obsolete content
Dispatch SHALL validate recipient authority and current permitted content. Obsolete pending summaries SHALL be suppressed; unavailable channel adapters SHALL report actual pending or unsupported delivery.

#### Scenario: Recipient access revoked
- **WHEN** a pending delivery's recipient is no longer authorized
- **THEN** private content is not dispatched to that recipient

#### Scenario: Messaging adapter not deployed
- **WHEN** a confirmation requires an unavailable external channel
- **THEN** saved web status remains confirmed and external delivery is not labeled sent
