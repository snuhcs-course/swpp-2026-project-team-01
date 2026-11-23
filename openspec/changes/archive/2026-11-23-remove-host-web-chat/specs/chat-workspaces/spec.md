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

### Requirement: No host chat on the web
The host's web workspace SHALL offer no chat with the assistant: no setup conversation, message composer, discussion history, streamed reply or **Restart Thyme** control. Setup SHALL proceed only in conversation in the host's linked messenger. A host whose setup is incomplete SHALL be led to link a messenger first and, on the workspace, SHALL see only a pointer to finish setup in the messenger and the messaging card, with no setup questions. A ready host SHALL keep the settings dialog, the dashboard, the Requests list, the share links and the sample request offer.

#### Scenario: Incomplete host on the workspace
- **WHEN** a host whose setup is incomplete reaches the `/app` workspace
- **THEN** the page says to finish setup with Thyme in the messaging app and shows the messaging card, with no setup card, composer or messages

#### Scenario: Ready host on the workspace
- **WHEN** a ready host opens the workspace instead of the Dashboard
- **THEN** the share links, the sample request offer and the messaging card appear as cards, with no composer or messages
