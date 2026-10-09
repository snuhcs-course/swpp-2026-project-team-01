## ADDED Requirements

### Requirement: Authored application extraction questions
New clarification text from application-owned requester extraction SHALL come only from authored questions for supported clarification categories in English or Korean. Unsupported categories or languages SHALL be rejected before domain execution. Clarification questions SHALL NOT assert agreement, approval, selection or booking. Current draft, retry and explicit-application rules SHALL remain in force.

#### Scenario: Model supplies a status claim
- **WHEN** extraction supplies arbitrary prose, including a claimed approval or booking, as a clarification category
- **THEN** it is rejected without creating or replacing a review

#### Scenario: Supported clarification
- **WHEN** extraction selects a supported missing-field category and English or Korean
- **THEN** the pending review contains the corresponding authored question and cannot apply while clarification remains

#### Scenario: Complete draft or exact retry
- **WHEN** a valid draft needs no clarification, or the same category/language draft is retried
- **THEN** an empty clarification list remains empty and an exact retry recovers the same authored wording without another mutation
