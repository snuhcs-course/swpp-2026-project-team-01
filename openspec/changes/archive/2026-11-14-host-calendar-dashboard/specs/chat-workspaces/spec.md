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
- **WHEN** a host reviews a request with shared and private discussions
- **THEN** a labeled switch shows one discussion at a time and never exposes the private discussion to a requester

#### Scenario: Use compact navigation
- **WHEN** a ready host opens the workspace menu by pointer or keyboard
- **THEN** dashboard, setup, inbox, and sign-out actions are available, the menu closes with Escape, and focus returns to its trigger

#### Scenario: Request link without authority
- **WHEN** a browser opens a protected request without its continuation credential, or with an unknown, malformed or expired one
- **THEN** no request details or chat appear, and the page directs the requester to use their private request link and offers only the generic **Resend my booking link** control, with no credential-paste field and no other recovery control

## ADDED Requirements

### Requirement: Host calendar Dashboard
The Dashboard SHALL show confirmed Find Me a Time bookings and events from the host's selected Google calendars in the host's saved timezone. The two sources SHALL have distinct colors and text labels. A confirmed booking that is also present in Google Calendar SHALL appear only once as a Find Me a Time meeting. The Dashboard SHALL provide week and month views, previous and next period navigation, a return to today, source filters, and details for a selected day and event. Calendar details SHALL be available only to the authenticated host. A Google Calendar access error SHALL leave confirmed bookings visible with an explanation.

#### Scenario: Compare sources
- **WHEN** a host opens a week containing a Google event and a confirmed Find Me a Time booking
- **THEN** both appear with distinct colors and labels, and selecting either reveals its time and available location

#### Scenario: Booking also appears in Google Calendar
- **WHEN** a confirmed booking's event is returned from a selected Google calendar
- **THEN** the Dashboard shows one Find Me a Time meeting for it, not a second Google event

#### Scenario: Google Calendar access fails
- **WHEN** Google Calendar cannot be read for the host
- **THEN** confirmed Find Me a Time bookings remain visible and a status message explains the Google Calendar problem
