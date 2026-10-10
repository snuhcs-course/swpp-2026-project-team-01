## ADDED Requirements

### Requirement: Recovery retains model limits
Recovering a conversation SHALL retain its message, principal and service model allowances and accumulated session usage. A failed attempt SHALL remain charged. Provider configuration errors SHALL fail safely without exposing raw provider errors or creating scheduling changes; correcting configuration SHALL NOT itself authorize another model call.

#### Scenario: Corrected key after failure
- **WHEN** credentials are corrected after a model authentication failure
- **THEN** an explicitly continued authorized input can run within the original allowances, without replaying completed input or clearing failed-attempt charges

#### Scenario: Exhausted allowance during recovery
- **WHEN** a recovery or successor model attempt encounters the existing message, session, principal or service limit
- **THEN** provider execution is denied and saved history and structured controls remain available
