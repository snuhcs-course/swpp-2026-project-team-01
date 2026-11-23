## ADDED Requirements

### Requirement: Received requests awaiting a decision on the Dashboard
The Dashboard SHALL show each received request that needs the host's decision (awaiting approval, or with a pending suggestion), except sample requests, at the time of its current proposal when that time falls in the period shown. It SHALL have its own color, text label and source filter, distinct from Google events, Find Me a Time meetings and sent requests, and SHALL never be shown as booked. Selecting it SHALL show the proposed time, the requester and the purpose, say that it is not booked until the host approves it, and offer **Open request**, which opens that request in the host's Requests view. A received request without a proposal SHALL not appear on the calendar.

#### Scenario: A request awaits approval this week
- **WHEN** a host opens a week in which a received request awaiting approval proposes Wednesday 14:00
- **THEN** the Dashboard shows a "From {requester} · To decide" block at Wednesday 14:00, and selecting it shows Proposed time, From and Purpose, a note that it is not booked until approved, and **Open request**

#### Scenario: Filter requests to decide
- **WHEN** the host turns off **Requests to decide**
- **THEN** received requests are hidden and Google events, Find Me a Time meetings and sent requests stay

#### Scenario: Request decided or only a sample
- **WHEN** the request is booked, declined or closed, or the only request is the tutorial sample
- **THEN** no received-request block appears for it; a booked request appears as a Find Me a Time meeting
