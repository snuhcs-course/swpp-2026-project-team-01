## ADDED Requirements

### Requirement: Nearest open times around the requester's windows
When a requester evaluation over the requester's own windows offers no candidate, feasibility SHALL also look for the nearest offered time before the first window and the nearest after the last, each within seven days, with the same deterministic checks and without the requester's preferences, and below the host's weekly limit when one is set. The requester projection SHALL carry them only when no candidate is shown. The search SHALL stop early, keeping what it found, rather than let the evaluation miss its deadline. Requester-facing output about them SHALL NOT give a reason why the windows did not work, nor any host event, rule, buffer or travel detail.

#### Scenario: Nothing fits the requested morning
- **WHEN** the requester asks for Monday 10:00 to 11:00, the host is busy then and free on the Friday before until 17:00 and on Monday from 12:00
- **THEN** the evaluation offers no candidate and gives Friday 16:30 as the nearest time before and Monday 12:00 as the nearest after, with no reason

#### Scenario: A time fits
- **WHEN** at least one candidate is offered in the requested windows
- **THEN** no nearest times are given

#### Scenario: Nothing open within a week
- **WHEN** the host is busy for more than seven days on each side of the requested windows
- **THEN** no nearest times are given and the requester gets the no-match message

#### Scenario: Picking a nearest time
- **WHEN** the requester picks one of the nearest times
- **THEN** it becomes a time to choose only after it is drafted as the requester's availability and found again
