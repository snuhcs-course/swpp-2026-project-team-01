## ADDED Requirements

### Requirement: Offered times as a calendar
The requester's **Choose a time** card SHALL show the offered times as blocks on a week grid, and on a phone as one day with a day switcher. Details shared by every offered time (time zone, length, place) SHALL be stated once above the grid, and a detail that differs SHALL be stated on the time it applies to. Each offered time SHALL be a keyboard-operable control whose accessible name gives its date and time. Trip-dependent times SHALL be visually distinct and named as depending on the requester's trip, and choosing one SHALL open its trip estimate. **Find other times** and **Edit details** SHALL remain below the grid. When the requester connected a calendar to the request, their own busy times SHALL be drawn under the offered times without titles or other event details.

#### Scenario: Several days at a glance
- **WHEN** a requester is offered times on Tuesday, Wednesday and Friday of one week, all 30 minutes in person at one place
- **THEN** the card shows that week with the times in their day columns, and the time zone, "30 minutes" and the place appear once above the grid

#### Scenario: Phone
- **WHEN** the same card is shown at phone width
- **THEN** one day is shown with a switcher for the week's days, each day naming how many times it has

#### Scenario: Connected calendar
- **WHEN** a requester who connected Google Calendar to this request opens the times card
- **THEN** their busy times for the shown week are drawn as busy blocks under the offered times, with no event titles
