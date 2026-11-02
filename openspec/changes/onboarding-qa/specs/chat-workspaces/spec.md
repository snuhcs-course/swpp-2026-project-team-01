# Spec Delta

## ADDED Requirements

### Requirement: Reliable manual guest identification
The guest identity card SHALL submit the same name, email and timezone when the guest presses Enter in either field or activates **Continue without Google**. A successful submission SHALL continue the existing request and conversation without a page reload. A failed submission SHALL preserve the entered values and conversation, display a readable error beside the card, and allow a retry without creating a second request or duplicate creation email. Invalid fields SHALL identify what the guest must correct; a temporary service failure SHALL not imply that identification succeeded.

#### Scenario: Submit with Enter
- **WHEN** a guest fills in a valid name and email and presses Enter in the email field
- **THEN** the draft becomes an identified request, the booking link replaces the address in place, and the existing conversation remains visible

#### Scenario: Invalid or temporarily failed submission
- **WHEN** the guest submits invalid data or the identification command fails temporarily
- **THEN** the card retains the name and email, announces a specific recoverable error, and permits correction or retry in the same thread

#### Scenario: Retry after lost response
- **WHEN** identification commits but the browser loses its response and the guest retries
- **THEN** the same identified request is recovered, with no second request or creation email

### Requirement: Guest calendar image control
The guest Calendar step SHALL offer an optional **Upload calendar screenshot** action alongside Google Calendar connection and manual availability. The action SHALL remain inside the conversation, show the chosen image and processing state, and present recognized scheduling information only as a draft for the guest to review. The guest SHALL be able to remove the image and continue by manual availability when the file is invalid, cannot be read, or extraction is unavailable. Uploading an image SHALL not grant Calendar access or settle the Calendar step by itself.

#### Scenario: Choose a screenshot
- **WHEN** a guest selects a supported calendar screenshot
- **THEN** the Calendar card shows the selected file, its processing or review state, and an option to remove it without changing request availability

#### Scenario: Extraction unavailable
- **WHEN** automatic reading is unavailable or returns no usable time information
- **THEN** the guest sees a clear failure message and can enter availability manually in the same request

### Requirement: Compact candidate time presentation
The candidate card SHALL show at most five feasible times initially in their existing evaluation order, with clear dates in the guest's displayed timezone. It SHALL show how many more are available and reveal them in further batches without running a new evaluation. Each option SHALL keep its date, time, timezone, duration, mode and selection action readable. Unresolved travel or missing-link conditions SHALL remain distinguishable from selectable times. **Find other times** SHALL remain a separate action that runs a new evaluation.

#### Scenario: Many feasible times
- **WHEN** an evaluation offers more than five selectable times
- **THEN** the card initially shows five in evaluation order, identifies each date, the timezone and remaining count, and lets the guest reveal the rest in batches

#### Scenario: Select a revealed time
- **WHEN** the guest reveals and selects a later candidate by keyboard or pointer
- **THEN** the existing explicit proposal review opens for that exact candidate, with no automatic agreement

#### Scenario: Reopen candidates
- **WHEN** the guest returns to the candidate card after viewing a proposal
- **THEN** the card remains understandable and the previously offered options can still be reached without a new evaluation

### Requirement: Ink onboarding presentation
The host setup conversation and guest onboarding cards SHALL use the ink design roles in [DESIGN.md](../../../../../DESIGN.md) for canvas, typography, controls, conversation surfaces, focus and status. The presentation SHALL preserve clear hierarchy, field labels, error and pending states, readable proposal details, and the current action at phone width, 200% zoom and keyboard-only use. Texture SHALL not sit behind task content and color SHALL not be the only status cue.

#### Scenario: Host setup on a phone
- **WHEN** a host completes setup cards at a phone width using the keyboard
- **THEN** the current card, its input, error and action remain visible and operable with ink styling and without horizontal page scrolling

#### Scenario: Guest identity and candidates at zoom
- **WHEN** a guest uses the identity, Calendar and candidate cards at 200% zoom
- **THEN** labels, timezone, candidate details, errors and actions remain readable and operable without horizontal page scrolling
