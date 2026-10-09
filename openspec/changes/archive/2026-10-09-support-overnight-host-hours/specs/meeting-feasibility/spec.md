## ADDED Requirements

### Requirement: Overnight weekly host hours
A host weekly availability window SHALL start on each selected weekday in the host timezone. An end clock earlier than its start SHALL mean the following local date; equal clocks SHALL be rejected. Candidate evaluation SHALL include the preceding day's applicable overnight tail without changing existing full-interval, busy, focus or buffer checks.

#### Scenario: Request only names the following morning
- **WHEN** Monday availability is 22:00–02:00 and a request names Tuesday 01:00–01:30
- **THEN** the entire candidate is inside that Monday window, subject to all other constraints
- **AND** Wednesday 01:00 is not included unless Tuesday was also selected

#### Scenario: Week and timezone boundary
- **WHEN** an overnight Saturday window ends Sunday in the host timezone while the requester is on a different date
- **THEN** the starting Saturday owns the complete window and both parties refer to the same instants

#### Scenario: Invalid equal clocks
- **WHEN** a draft supplies identical start and end clocks
- **THEN** the system rejects it without treating it as all-day availability or altering confirmed settings

### Requirement: Overnight clock changes and review
Overnight boundaries SHALL use actual local calendar dates and timezone rules. An ambiguous or nonexistent boundary SHALL require clarification rather than a guessed instant. Host editing and review SHALL clearly identify next-day ends, and saving SHALL retain explicit confirmation requirements.

#### Scenario: Daylight-saving transition
- **WHEN** an overnight window crosses a clock change with unambiguous boundaries
- **THEN** feasibility uses actual elapsed duration, including the shorter or longer night
- **AND** an ambiguous or nonexistent end boundary yields no actionable candidate for that unresolved window

#### Scenario: Review next-day hours
- **WHEN** a host edits or reviews 22:00–02:00
- **THEN** the display identifies 02:00 as next day and does not save the draft without the existing explicit confirmation
