## ADDED Requirements

### Requirement: Explicit terminal runtime recovery
A currently authorized participant SHALL be able to explicitly recover a confirmed failed runtime for the same logical conversation. Recovery SHALL require trusted terminal evidence and an exact observed generation. Missing, timed-out, active, or uncertain runtime state SHALL NOT authorize replacement. Closed resources and revoked authority SHALL remain denied.

#### Scenario: Existing authentication failure
- **WHEN** an authorized participant requests recovery after a recorded model authentication failure, including one predating this feature
- **THEN** the service creates at most one successor for the same conversation and preserves its host, request and audience

#### Scenario: Uncertain runtime state
- **WHEN** inspection times out, no session can be resolved without terminal evidence, or the observed generation has changed
- **THEN** recovery creates no successor and returns a safe unavailable or stale result

#### Scenario: Concurrent or repeated recovery
- **WHEN** participants concurrently recover the same failed generation, or retry after a lost response
- **THEN** one durable transition wins, exact retries return its status and stale or changed requests cannot replace the successor

### Requirement: Recovery fences retired execution
Retired runtime generations SHALL NOT perform new model work, tool operations, delivery or settlement. The service SHALL recheck current generation and participant authority under the relevant transaction locks and after asynchronous reads. Recovery SHALL NOT extend original grants or create scheduling decisions.

#### Scenario: Old tool resumes after recovery
- **WHEN** an old runtime attempts a tool, model reservation, delivery or settlement after its generation is retired
- **THEN** the operation is denied without changing domain state or the successor's work

#### Scenario: Revocation during recovery
- **WHEN** a credential expires or is revoked while terminal inspection or a recovery lock is pending
- **THEN** recovery is denied and no successor gains that credential's authority

### Requirement: Recovery preserves accepted work and history
Recovery SHALL preserve accepted input identities, exact retry fingerprints, prior tool results and all authorized conversation history. Pending work SHALL retain its original authority and budgets. Completed inputs SHALL NOT be executed again. Historical stream cursors SHALL remain meaningful without exposing raw runtime IDs or mixing audiences.

#### Scenario: Pending input after terminal failure
- **WHEN** recovery finds input accepted after the prior runtime failed
- **THEN** eligible pending input continues with its original message and retry identity, while expired authority cannot be renewed through recovery

#### Scenario: History and cursor continuation
- **WHEN** an authorized browser or agent reads history across a recovered generation, including with a pre-recovery cursor
- **THEN** prior permitted history and subsequent output appear in order without duplicate committed output, private cross-audience data or dropped history

#### Scenario: Committed tool result before failure
- **WHEN** a continued input repeats an operation that committed before runtime failure
- **THEN** current authority is rechecked and the saved result is reused without a second effect or fabricated approval
