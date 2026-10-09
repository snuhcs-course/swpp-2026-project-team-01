## ADDED Requirements

### Requirement: Shared evaluation deadline
A scheduling evaluation SHALL share one 18-second elapsed-time budget across credential refresh, Calendar reads, travel and optional ranking. Pagination, additional candidates and parties SHALL NOT reset it. On expiry the service SHALL stop waiting, cancel active provider work and prevent new provider requests or publication from that evaluation. Narrower operation limits SHALL still apply.

#### Scenario: Later page exhausts remaining time
- **WHEN** a Calendar page stalls after earlier work consumed part of the evaluation budget
- **THEN** its active request and response-body read are cancelled at the original deadline
- **AND** no later page, party, candidate or ranking request starts

#### Scenario: Provider ignores cancellation
- **WHEN** a provider completes after the shared deadline or never settles
- **THEN** the service returns a sanitized incomplete evaluation without waiting indefinitely
- **AND** late completion cannot save evidence, publish candidates or start booking

#### Scenario: Ranking has less time remaining
- **WHEN** ranking begins with less time remaining than its own model timeout
- **THEN** the original evaluation deadline still applies and incomplete ranking is not published

### Requirement: Deadline uncertainty preserves durable state
An expired evaluation SHALL NOT turn failed reads into availability or zero travel, release an uncertain booking, or claim an in-flight command was rolled back. Already committed authorized effects SHALL retain their existing retry and recovery identities. Further evidence, publication and booking dispatch from the expired evaluation SHALL be denied.

#### Scenario: Expiry during booking revalidation
- **WHEN** booking revalidation exhausts the evaluation budget
- **THEN** no new Calendar insertion is authorized by that incomplete evaluation
- **AND** any existing dispatched attempt remains subject to same-event reconciliation

#### Scenario: Command started before expiry
- **WHEN** an authorized command was already sent before the deadline and its reply is lost or late
- **THEN** the service retains uncertainty and uses the existing durable read/retry protocol
- **AND** it does not claim cancellation undid the command
