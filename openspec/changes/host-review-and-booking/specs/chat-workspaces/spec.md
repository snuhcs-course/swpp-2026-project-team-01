## ADDED Requirements

### Requirement: Host request inbox and discussion switch
`/app` SHALL offer a request inbox from the workspace menu that lists the host's requests, except drafts, as selectable cards with requester, purpose, status and whether a decision is needed. A selected request SHALL open with a labeled switch between the host-private discussion with the assistant and a read-only view of the shared requester conversation, one at a time, and with its decision cards beside the private discussion: the proposal review, any suggested shared changes, the rule and travel review and the booking status. The shared view SHALL have no composer and SHALL never show private discussion. Selection SHALL be addressable as `/app?request={requestId}`.

#### Scenario: Host opens a request from the inbox
- **WHEN** a host selects a request awaiting approval
- **THEN** the private discussion and the proposal review card with **Approve this proposal**, **Request changes** and **Decline** appear, and the URL names the request

#### Scenario: Host views the shared conversation
- **WHEN** the host switches to the shared view
- **THEN** the requester conversation appears read-only with the current proposal and status, and no composer or private card is shown

#### Scenario: Another host's request
- **WHEN** a host opens `/app?request=` with a request that belongs to another host
- **THEN** the inbox opens with no request selected and nothing about that request is shown
