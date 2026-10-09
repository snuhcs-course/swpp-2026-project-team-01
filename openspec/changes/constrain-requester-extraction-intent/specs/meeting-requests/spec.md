## ADDED Requirements

### Requirement: Declared uncertain extraction has no patch
Application-owned requester extraction SHALL declare details, availability, question or unknown intent. Question and unknown outcomes SHALL contain no proposed scheduling or contact fields and SHALL include clarification. Invalid or missing classification SHALL be rejected before domain execution. Valid details and availability outcomes SHALL remain advisory and require the existing explicit review application.

#### Scenario: Question carries a change
- **WHEN** extraction declares question or unknown intent while supplying any patch field
- **THEN** it is rejected without creating or replacing a review or changing request state

#### Scenario: Clarification-only outcome
- **WHEN** extraction declares question or unknown intent with an empty patch and a nonempty clarification
- **THEN** the result can request clarification but cannot apply scheduling changes

#### Scenario: Explicit scheduling draft
- **WHEN** details or availability intent supplies a valid advisory draft
- **THEN** it follows the existing revision, retry and explicit application rules without granting agreement or approval
