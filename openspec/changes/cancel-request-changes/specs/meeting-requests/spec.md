## ADDED Requirements

### Requirement: Cancel requester changes
A guest who reopened their agreed request SHALL be able to cancel their scheduling changes and restore the previously agreed details to awaiting host approval. Cancelling changes to a standing booking SHALL retain that confirmed booking. Cancellation SHALL preserve proposal history, advance the revision and require the requester's current authority.

#### Scenario: Return a request to the host's queue
- **WHEN** a guest cancels changes they opened while their request awaited host approval
- **THEN** the original agreed scheduling details are restored and the host sees Needs your decision instead of Coordinating time
- **AND** intermediate proposals remain history and cannot be approved using an earlier revision

#### Scenario: Keep a confirmed booking
- **WHEN** the guest cancels their changes to a confirmed future meeting
- **THEN** the original calendar event remains booked and no provider cancellation is sent

#### Scenario: Respect a newer decision
- **WHEN** a cancellation uses a stale revision or the host has already decided or shared a newer change
- **THEN** cancellation is rejected and that newer state is preserved

#### Scenario: Retry a committed cancellation
- **WHEN** the guest repeats a cancellation with the same retry identity
- **THEN** the recorded result is returned and no duplicate proposal or notice is created

#### Scenario: Preserve current contact and preferences
- **WHEN** the guest changed contact proof or notification preferences during editing
- **THEN** cancellation restores scheduling details without reversing those independent choices

#### Scenario: Earlier edit without a complete restore record
- **WHEN** an edit predates rollback snapshots and its request revision has advanced since reopening
- **THEN** the service does not offer a rollback it cannot safely reconstruct
