## ADDED Requirements

### Requirement: Explicit audited recovery
Recovery SHALL run only through the administrator CLI with the same explicit environment selection and server credential as inspection, SHALL require a reason and either a typed confirmation of the target or an explicit non-interactive confirmation flag, and SHALL record, in the same statement as the change, the operator, action, target, the state found, the reason and the environment. Data API roles SHALL NOT execute recovery functions.

#### Scenario: Unconfirmed recovery
- **WHEN** an operator runs a recovery without the confirmation flag and no one can confirm interactively
- **THEN** nothing changes and no audit row is written

#### Scenario: Browser caller
- **WHEN** an anonymous or authenticated Data API caller invokes a recovery function
- **THEN** execution is denied

### Requirement: Exhausted job requeue
An operator SHALL be able to requeue only an exhausted job, granting between one and ten attempts beyond those already used. The requeued job SHALL be claimed under a new fence, so a result from an earlier claim records nothing, and its handler SHALL apply the same duplicate-prevention rules as on any retry.

#### Scenario: Job not exhausted
- **WHEN** the operator names a pending, running or completed job
- **THEN** recovery refuses without changing the job

#### Scenario: Requeued delivery found dispatching
- **WHEN** a requeued delivery job finds its message already dispatching
- **THEN** the message is recorded uncertain and is not sent again

### Requirement: Uncertain booking reconciliation
An operator SHALL be able to start reconciliation of a booking whose write may exist only when no booking job for it is pending or running. Reconciliation SHALL read the event by its fixed identity before any insert, and recovery SHALL NOT mark a booking confirmed, failed or cancelled, release its reservation, or create an approval by itself.

#### Scenario: Event exists after a lost response
- **WHEN** the operator reconciles a dispatching booking whose event was created
- **THEN** the booking is confirmed with the existing event and no second event is created

#### Scenario: Reconciliation already running
- **WHEN** a booking job for the booking is pending or running
- **THEN** recovery refuses and publishes nothing

### Requirement: Uncertain messages stay uncertain
Recovery SHALL NOT resend an email, thread reply or iMessage recorded uncertain.

#### Scenario: Operator inspects an uncertain email
- **WHEN** the snapshot lists an uncertain transactional email
- **THEN** no recovery command can send it again
