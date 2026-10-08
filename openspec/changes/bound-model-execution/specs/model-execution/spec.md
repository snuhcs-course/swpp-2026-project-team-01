# Model execution delta

## Purpose

Bound the provider work and reserved model allowance consumed by authorized scheduling conversations and candidate ranking, including failures and recovery.

## ADDED Requirements

### Requirement: Bounded provider invocation
Each model attempt SHALL reject serialized input exceeding 128 KiB, accept only text/function-tool work, request at most 4,096 output tokens (2,048 for ranking), and stop waiting after 30 seconds. Provider storage SHALL be disabled and standard service pricing selected. Limits SHALL cover streaming, compaction and retries.

#### Scenario: Invalid or oversized input
- **WHEN** a call includes an attachment, a provider-executed tool or input above the byte limit
- **THEN** it is rejected before reservation or provider execution

#### Scenario: Stalled provider
- **WHEN** generation or an opened stream stalls
- **THEN** the call is aborted at its deadline, including when no next stream chunk arrives

#### Scenario: Caller tries to relax limits
- **WHEN** an internal caller supplies a larger output limit or a different service tier
- **THEN** the enforced limits and standard tier remain in effect

### Requirement: Durable model allowance
The service SHALL reserve USD 0.60 of model allowance before each actual provider attempt, at most eight attempts per accepted conversation input and two per ranking check. It SHALL allow at most USD 30 per host account or requester request and USD 300 service-wide in independent fixed 24-hour windows. Failed or uncertain attempts SHALL retain reservations; restarting, switching channels or replacing credentials SHALL not reset allowance.

#### Scenario: Retry after process failure
- **WHEN** execution restarts after reserving an attempt, even without a recorded provider response
- **THEN** another actual provider call requires another reservation against the same work and principal limits

#### Scenario: Concurrent work
- **WHEN** concurrent authorized work exceeds remaining principal or service capacity
- **THEN** only the remaining capacity is reserved and all other provider calls are denied

#### Scenario: Saved result
- **WHEN** an exact authorized retry reads a saved ranking without invoking the provider
- **THEN** it consumes no additional allowance

### Requirement: Authorized limit recovery
Reservations SHALL require current work authority and canonical runtime identity where applicable, rechecked after contended locks. A limit failure SHALL settle through the existing failure path with safe feedback and accessible structured controls. It SHALL not create a scheduling decision, publish a partial ranking or undo earlier committed authorized commands.

#### Scenario: Expiry while waiting
- **WHEN** authority or evidence expires while a reservation waits for capacity locks
- **THEN** no reservation or provider execution is authorized

#### Scenario: Exhausted work
- **WHEN** a conversation or ranking reaches its attempt limit
- **THEN** further model work stops, existing confirmed state remains readable and structured controls remain available
