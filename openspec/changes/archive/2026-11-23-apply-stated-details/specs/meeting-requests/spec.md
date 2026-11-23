## MODIFIED Requirements

### Requirement: Complete account-free intake
Ready public hosts SHALL accept requests without requester signup. The service SHALL collect purpose, requester identity/contact, date windows, timezone, duration, mode, and location or meeting link, clarifying missing or ambiguous fields. The requester website SHALL allow the requester to supply and refine scheduling details through conversation, have the details they state applied at once, review before applying only the changes the assistant inferred, those that differ from what the request holds and contact changes, evaluate availability, select a feasible candidate, and explicitly agree to the exact current proposal.

#### Scenario: Missing details
- **WHEN** a requester asks for thirty minutes next week without timezone or location
- **THEN** the request remains gathering with specific missing-field actions and no fabricated proposal

#### Scenario: Bilingual intake
- **WHEN** English or Korean intake supplies sufficient details
- **THEN** the service normalizes validated details and preserves the requester's stated intent

#### Scenario: Stated conversational details
- **WHEN** a requester message states an unambiguous purpose, meeting length, meeting mode, location or availability window that the request does not yet hold differently
- **THEN** the assistant's draft applies it at once without a review card, says in one line what it applied and that the requester can change it in words, and finds times once the request has its purpose, length and form

#### Scenario: Reviewed conversational details
- **WHEN** the assistant infers a value the requester did not state, such as an afternoon read as clock bounds or in person taken from a place named as where to meet, or the message gives a value that differs from what the request holds
- **THEN** the website presents that value for review and does not change it until the requester explicitly applies it, while the stated rest of the message applies at once and no times are searched until the review is settled

#### Scenario: Conversational candidate agreement
- **WHEN** evaluated candidates are available in the requester conversation
- **THEN** the requester can explicitly select a candidate, review the resulting exact proposal, and separately confirm agreement before host review

### Requirement: Declared uncertain extraction has no patch
Application-owned requester extraction SHALL declare details, availability, question or unknown intent. Question and unknown outcomes SHALL contain no proposed scheduling or contact fields and SHALL include clarification. Invalid or missing classification SHALL be rejected before domain execution. Valid details and availability outcomes SHALL NOT grant agreement or approval; their stated scheduling fields SHALL apply at once under the existing revision and retry rules, and only inferred, conflicting or contact fields SHALL require the existing explicit review application. The guest web, email and messenger conversations SHALL apply this one rule.

#### Scenario: Question carries a change
- **WHEN** extraction declares question or unknown intent while supplying any patch field
- **THEN** it is rejected without creating or replacing a review or changing request state

#### Scenario: Clarification-only outcome
- **WHEN** extraction declares question or unknown intent with an empty patch and a nonempty clarification
- **THEN** the result can request clarification but cannot apply scheduling changes

#### Scenario: Explicit scheduling draft
- **WHEN** details or availability intent supplies a valid draft of fields the requester stated
- **THEN** it is validated as a whole, applied at once at the request's current revision with its own retry key, and grants no agreement or approval

#### Scenario: Draft with inferred or conflicting fields
- **WHEN** a valid draft marks inferred time bounds or an inferred meeting mode, or gives a value that differs from one the request holds, or changes the name or email
- **THEN** those fields, and windows that must fit a length still under review, remain one pending review for explicit application, and the other fields apply at once
