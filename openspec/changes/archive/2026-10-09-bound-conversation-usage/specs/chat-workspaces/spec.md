## ADDED Requirements

### Requirement: Bounded conversation admission
The service SHALL admit at most 20 new messages per minute and 100 per hour per host account or requester request, and 200 per minute and 2,000 per hour service-wide. Independent fixed windows SHALL start at the first accepted message after expiry. Budgets SHALL be shared across scopes, channels and replacement credentials. Admission and charging SHALL commit atomically; accepted exact retries SHALL not charge again.

#### Scenario: Concurrent messages across scopes
- **WHEN** concurrent authorized inputs cross the remaining host or service allowance
- **THEN** only the remaining allowance is accepted, and rejected inputs create no runtime work or scheduling changes

#### Scenario: Retry and authority
- **WHEN** an accepted input is retried at the limit
- **THEN** its exact receipt remains available only under current authority, without another charge, and changed input is rejected

#### Scenario: Window recovery
- **WHEN** a fixed window expires while an input waits for its budget lock
- **THEN** admission uses the current wall clock, and expired or revoked authority still cannot admit a message

### Requirement: Recoverable conversation throttling
Temporary admission throttling SHALL return a safe retryable error to web callers while retaining the unsent message and structured controls. Authenticated messaging receipts SHALL remain queued in order, delayed at least one minute, without consuming provider failure attempts; delayed execution SHALL revalidate authority. Existing lifetime caps SHALL remain terminal and distinct from temporary throttling.

#### Scenario: Browser throttling
- **WHEN** a new browser message exceeds a temporary budget
- **THEN** the response is HTTP 429 with a safe temporary-limit message and the same message can be retried after capacity returns

#### Scenario: Messaging backpressure
- **WHEN** a verified iMessage or requester-email receipt exceeds a temporary budget
- **THEN** it remains unprocessed with no runtime message, retries no earlier than one minute later and does not allow a later receipt in that conversation to overtake it

#### Scenario: Authority expires during delay
- **WHEN** the linked authority expires or is revoked before a delayed receipt is retried
- **THEN** no new model work is admitted and the receipt reaches the channel's existing unauthorized terminal outcome
