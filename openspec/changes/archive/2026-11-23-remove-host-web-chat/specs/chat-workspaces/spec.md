## ADDED Requirements

### Requirement: Host request controls on the web
A received request in the host's Requests list SHALL show no chat with the assistant. Besides **Approve** and **Decline**, it SHALL keep **Request changes** with the suggestion review, the rule card for a weekly-limit hold or an unresolved trip, and **Cancel meeting** and **Change meeting** for a booked meeting, each through the authorized request commands with current revisions.

#### Scenario: Open a received request
- **WHEN** a host expands a received request
- **THEN** the details and the controls its state allows appear, with no message composer, discussion history or **Private messages** area

#### Scenario: Weekly-limit hold on the web
- **WHEN** every feasible time of a request falls in a week at the host's weekly limit
- **THEN** the rule card offers **Allow this request beyond my weekly limit** on the web

#### Scenario: Booked meeting on the web
- **WHEN** a host expands a booked request before the meeting starts
- **THEN** the booking card offers **Cancel meeting** and **Change meeting**
