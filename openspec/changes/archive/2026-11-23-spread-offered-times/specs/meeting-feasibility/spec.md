## ADDED Requirements

### Requirement: Offered times spread across the range
Feasibility SHALL order the times it offers across the requested range and the parts of each day, for the default search and the requester's own windows alike. Within each rank set by the host's weekly-limit and trip preferences and the requester's preferences, each local day's first time SHALL come before any day's second, and a later time on a day SHALL come at least two hours from that day's earlier times while such a time remains; the remaining times SHALL follow in their order. The spread SHALL NOT remove a time or move one across a rank. A model ranking SHALL be spread the same way, its order breaking ties, so it cannot put one day's times first.

#### Scenario: A whole week
- **WHEN** the requester gives any weekday next week and Monday is free only from 12:45
- **THEN** the first three offered times are Monday 12:45, Tuesday's first time and Wednesday's first time, and Monday 13:00 is still offered later

#### Scenario: One day
- **WHEN** the requester gives Monday 10:00 to 17:00 for a 30-minute meeting
- **THEN** the times are offered as 10:00, 12:00, 14:00 and 16:00 first, then the other quarter hours in time order

#### Scenario: A preferred week
- **WHEN** one week is at the host's weekly limit and the next is below it
- **THEN** every time in the week below the limit still comes first, spread across its days

#### Scenario: A ranking that favours sooner dates
- **WHEN** the ranking puts three Monday times 15 minutes apart before Tuesday's first time
- **THEN** Monday's first ranked time and Tuesday's come first, and the other two Monday times after them
