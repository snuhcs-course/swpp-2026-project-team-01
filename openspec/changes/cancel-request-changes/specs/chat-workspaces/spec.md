## ADDED Requirements

### Requirement: Meeting change card
While the guest edits an existing meeting, the initial change card SHALL be titled What would you like to change? and offer Find a new time, Edit details and Cancel when restoration is available. Cancel SHALL be distinct from Cancel meeting and SHALL refresh the conversation to the restored request state.

#### Scenario: Open an agreed request for editing
- **WHEN** a guest chooses Change meeting
- **THEN** the change card names both time and detail changes and explains that Cancel retains the previous request or booking

#### Scenario: Cancel editing
- **WHEN** the guest presses Cancel
- **THEN** the authorized restore command is sent at the current revision and the guest sees the restored agreement or booking
