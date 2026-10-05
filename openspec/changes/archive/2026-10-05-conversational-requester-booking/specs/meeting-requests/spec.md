# Spec Delta

## MODIFIED Requirements

### Requirement: Complete account-free intake
Ready public hosts SHALL accept requests without requester signup. The service SHALL collect purpose, requester identity/contact, date windows, timezone, duration, mode, and location or meeting link, clarifying missing or ambiguous fields. The requester website SHALL allow the requester to supply and refine scheduling details through conversation, review extracted changes before applying them, evaluate availability, select a feasible candidate, and explicitly agree to the exact current proposal.

#### Scenario: Missing details
- **WHEN** a requester asks for thirty minutes next week without timezone or location
- **THEN** the request remains gathering with specific missing-field actions and no fabricated proposal

#### Scenario: Bilingual intake
- **WHEN** English or Korean intake supplies sufficient details
- **THEN** the service normalizes validated details and preserves the requester's stated intent

#### Scenario: Reviewed conversational details
- **WHEN** a requester message contains an unambiguous purpose, meeting mode, location, or availability window
- **THEN** the website presents the extracted changes for review and does not change the request until the requester explicitly applies them

#### Scenario: Conversational candidate agreement
- **WHEN** evaluated candidates are available in the requester conversation
- **THEN** the requester can explicitly select a candidate, review the resulting exact proposal, and separately confirm agreement before host review

### Requirement: Expected revision concurrency guards
Mutations of an existing request, including applying a conversational review, SHALL require its expected revision and reject stale input without overwriting intervening changes. Revision checks SHALL remain separate from same-operation idempotency.

#### Scenario: Concurrent stale mutation
- **WHEN** a mutation's expected revision differs from the current request revision
- **THEN** it is rejected with a stable conflict outcome and the intervening change remains intact

#### Scenario: Stale conversational review
- **WHEN** a requester tries to apply extracted details after another message or request mutation changed the revision
- **THEN** the review is rejected and no extracted field overwrites the newer request

### Requirement: Constrained asynchronous interpretation
AI extraction SHALL operate on audience-appropriate context and return validated structured results. It SHALL not create approval, agreement, proposals, calendar writes, waive rules, reveal private information, or overwrite newer revisions. Ambiguous dates or times SHALL produce clarification without actionable windows.

#### Scenario: Prompt injection
- **WHEN** intake tells the assistant to ignore approval rules or reveal calendar contents
- **THEN** authority and visibility guards remain enforced

#### Scenario: Stale extraction
- **WHEN** an extraction result completes after its request revision changes
- **THEN** it is discarded or recomputed before any state update

#### Scenario: Ambiguous conversational time
- **WHEN** a requester gives a relative or offset-free time that cannot be resolved without invention
- **THEN** the assistant asks for an explicit date, time, and timezone and exposes no actionable window

#### Scenario: Natural-language assent
- **WHEN** a requester sends a message such as “yes” or “book it”
- **THEN** the message does not create requester agreement, host approval, or a calendar event

### Requirement: Accessible proposal review
Web intake and host review SHALL support phone widths, keyboard operation, labeled controls, readable validation, and exact proposal details in decision controls. Requester conversation actions SHALL expose the reviewed changes, candidate times, and proposal agreement as labeled keyboard-operable controls.

#### Scenario: Keyboard host review
- **WHEN** a host reviews a request using only the keyboard on a narrow screen
- **THEN** proposal details and available decision controls remain reachable and understandable without color-only status

#### Scenario: Keyboard requester conversation
- **WHEN** a requester completes scheduling from the conversation using only the keyboard on a narrow screen
- **THEN** draft review, evaluation, candidate selection, and explicit agreement remain reachable and understandable without relying on color
