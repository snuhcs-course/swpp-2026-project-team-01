## ADDED Requirements

### Requirement: Temporally valid assistant review windows
An assistant-generated request review SHALL contain only windows whose starts are still in the future when a new review is accepted. Each window SHALL accommodate the proposed effective meeting duration when that duration is known. Invalid windows SHALL reject the new review without superseding a pending review or changing scheduling state. An omitted duration SHALL NOT be invented.

#### Scenario: Past-start extraction
- **WHEN** an assistant supplies a window that has already begun, even if its end is still in the future
- **THEN** the review is rejected and existing review and scheduling state remain unchanged

#### Scenario: Duration inherited or changed
- **WHEN** proposed windows are shorter than the duration obtained by merging the partial patch with current details
- **THEN** the review is rejected without persisting partial results

#### Scenario: Duration not yet known
- **WHEN** future windows are proposed before a duration has been supplied
- **THEN** no duration is inferred and incomplete details cannot authorize candidate selection or booking

### Requirement: Review time validation respects current decisions and retries
Applying an assistant review SHALL recheck future starts and known duration after acquiring the required locks. A rejected apply SHALL preserve the pending review and current request. Exact retries of already committed review creation or decisions SHALL retain their recorded outcome without another mutation, even after time has elapsed.

#### Scenario: Window begins before apply
- **WHEN** the window starts after review creation but before apply validation, including during a lock wait
- **THEN** applying it is denied without updating request details or consuming the decision

#### Scenario: Committed retry after time passes
- **WHEN** the same authorized review creation or decision is retried after its window starts
- **THEN** the existing result is recovered without creating, applying or superseding another review
