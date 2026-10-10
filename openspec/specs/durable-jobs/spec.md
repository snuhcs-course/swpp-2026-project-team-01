# durable-jobs Specification

## Purpose

Keep scheduling work recoverable across worker termination, repeated delivery, and lost invocations without depending on an open client connection.

## Requirements

### Requirement: Atomic durable publication
The service SHALL commit business mutations and required durable work atomically. A committed business action SHALL remain recoverable even when its immediate worker wake-up is lost.

#### Scenario: Transaction rolls back
- **WHEN** a mutation fails before commit
- **THEN** neither its state change nor its required jobs are visible

#### Scenario: Worker wake-up is lost
- **WHEN** state and work commit but no immediate worker invocation occurs
- **THEN** recurring recovery discovers and processes the saved work

### Requirement: Authorized bounded consumption
Only authenticated internal workers SHALL consume jobs. Each invocation SHALL claim bounded work with recoverable ownership and deadlines.

#### Scenario: Public invocation
- **WHEN** a public or host client tries to consume internal work
- **THEN** invocation is denied and no job is claimed

#### Scenario: Expired owner
- **WHEN** a worker terminates before recording completion and its ownership expires
- **THEN** another authorized worker can recover the saved step under current fencing guards

### Requirement: Redelivery-safe completion
Workers SHALL persist the step outcome and any necessary follow-up before acknowledging its message. Recognized completed work SHALL not repeat domain or external effects.

#### Scenario: Duplicate completed message
- **WHEN** a completed work item is delivered again
- **THEN** it is acknowledged without repeating its effect

#### Scenario: Follow-up acknowledgement crash
- **WHEN** follow-up work commits but the current message acknowledgement is lost
- **THEN** redelivery recognizes the saved outcome and preserves one logical follow-up

### Requirement: Visible exhaustion
Retry exhaustion SHALL preserve business state and expose a recovery reason. Expired worker ownership SHALL not prove that an external side effect failed.

#### Scenario: Retry budget exhausted
- **WHEN** a work item reaches its configured retry limit
- **THEN** it remains operationally visible with its failure category and does not silently close the request
