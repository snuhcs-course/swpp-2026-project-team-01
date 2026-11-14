## ADDED Requirements

### Requirement: Host request inbox
`/app` SHALL offer a request inbox from the workspace menu that lists the host's requests, except drafts, as selectable cards with requester, purpose, status and whether a decision is needed. A selected request SHALL open on the host-private discussion with the assistant and its decision cards: the proposal review, any suggested shared changes, the rule and travel review and the booking status. The host SHALL NOT be shown the requester's conversation with the assistant; the request's details, current proposal, agreement and status SHALL come from the host projection. Selection SHALL be addressable as `/app?request={requestId}`.

#### Scenario: Host opens a request from the inbox
- **WHEN** a host selects a request awaiting approval
- **THEN** the private discussion and the proposal review card with **Approve this proposal**, **Request changes** and **Decline** appear, and the URL names the request

#### Scenario: Requester conversation stays with the requester
- **WHEN** a host opens a request whose requester has written to the assistant
- **THEN** the view offers no tab, link or route to that conversation, and the requester's messages are not shown

#### Scenario: Another host's request
- **WHEN** a host opens `/app?request=` with a request that belongs to another host
- **THEN** the inbox opens with no request selected and nothing about that request is shown

## MODIFIED Requirements

### Requirement: Conversation-first entry
The website SHALL open incomplete host setup and request management on the relevant conversation, with the current next action and a message composer available without navigating through structured forms. A ready host who opens `/app` without a specific request or workspace view SHALL see the calendar Dashboard. Navigation SHALL remain available through a compact, keyboard-operable control. Structured controls SHALL remain reachable from a secondary, clearly labeled surface. A protected request opened without valid authority SHALL show only the generic unavailable view with the link resend control that the meeting-request contract requires.

#### Scenario: Resume host setup
- **WHEN** an active host returns to incomplete setup
- **THEN** the current conversation, server-derived progress, and next action appear first, the composer remains reachable in the initial phone viewport, and manual settings remain accessible

#### Scenario: Return after setup
- **WHEN** a ready host signs in and opens `/app` without a request or a workspace view
- **THEN** the calendar Dashboard appears, with the existing Settings dialog and workspace menu reachable

#### Scenario: Resume request
- **WHEN** a requester or host opens an active meeting request
- **THEN** the permitted conversation and current request status appear first, with structured editing in a secondary surface

#### Scenario: Browse host requests
- **WHEN** a host opens the meeting inbox
- **THEN** request conversations appear as selectable artifacts in the conversation workspace without a permanent sidebar

#### Scenario: Switch host discussion visibility
- **WHEN** a host reviews a request
- **THEN** only the host-private discussion is shown, with no switch to the requester's conversation, and the private discussion is never exposed to a requester

#### Scenario: Use compact navigation
- **WHEN** a host opens the workspace menu by pointer or keyboard
- **THEN** dashboard, setup, inbox, and sign-out actions are available for a ready host, the menu closes with Escape, and focus returns to its trigger

#### Scenario: Request link without authority
- **WHEN** a browser opens a protected request without its continuation credential, or with an unknown, malformed or expired one
- **THEN** no request details or chat appear, and the page directs the requester to use their private request link and offers only the generic **Resend my booking link** control, with no credential-paste field and no other recovery control
