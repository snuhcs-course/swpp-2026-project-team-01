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
- **THEN** the share links and the sample request offer appear as cards, with the messaging card until the host links a messenger or chooses Maybe later, and with no composer or messages

## MODIFIED Requirements

### Requirement: Conversation-first entry
The website SHALL open requester request management on the relevant conversation, with the current next action and a message composer available without navigating through structured forms. The host's web workspace SHALL have no conversation: host setup and host request discussion happen in the host's linked messenger, and an incomplete host SHALL be led to link one first. A ready host who opens `/app` without a specific request or workspace view SHALL see the calendar Dashboard. Navigation SHALL remain available through a compact, keyboard-operable control. Structured controls SHALL remain reachable from a secondary, clearly labeled surface. A protected request opened without valid authority SHALL show only the generic unavailable view with the link resend control that the meeting-request contract requires.

#### Scenario: Resume host setup
- **WHEN** an active host returns to incomplete setup on the web
- **THEN** the web leads them to link a messenger, or, when one is linked, to finish setup with Thyme there, with no setup questions or composer on the web

#### Scenario: Return after setup
- **WHEN** a ready host signs in and opens `/app` without a request or a workspace view
- **THEN** the calendar Dashboard appears, with the existing Settings dialog and workspace menu reachable

#### Scenario: Resume request
- **WHEN** a requester opens an active meeting request
- **THEN** the permitted conversation and current request status appear first, with structured editing in a secondary surface

#### Scenario: Browse host requests
- **WHEN** a host opens the meeting inbox
- **THEN** received and sent requests appear as selectable cards without a permanent sidebar, and a received request expands to its details and permitted decisions with no conversation

#### Scenario: Switch host discussion visibility
- **WHEN** a host reviews a received request
- **THEN** no discussion switch or private chat appears on the web, and the requester's conversation stays reachable only through its authorized requester path

#### Scenario: Use compact navigation
- **WHEN** a ready host opens the workspace menu by pointer or keyboard
- **THEN** dashboard, setup, inbox, and sign-out actions are available, the menu closes with Escape, and focus returns to its trigger

#### Scenario: Request link without authority
- **WHEN** a browser opens a protected request without its continuation credential, or with an unknown, malformed or expired one
- **THEN** no request details or chat appear, and the page directs the requester to use their private request link and offers only the generic **Resend my booking link** control, with no credential-paste field and no other recovery control

### Requirement: Google-only MVP host login
The host workspace SHALL offer Google sign-in through Supabase Auth and SHALL NOT offer email/password, email OTP or magic-link login in the MVP. The application SHALL initiate one Google OAuth consent that requests identity together with the Calendar scopes needed to read selected calendars and create events, with browser-bound PKCE, offline access and a fixed `/auth/callback` return to `/app`, and SHALL record the scopes Google actually granted and the refresh token server-side at sign-in. The deployed Auth configuration SHALL disable email login. First-time Google sign-in SHALL create an active host account whether or not the Calendar scopes were granted. Calendar permission SHALL exist only for granted scopes; login SHALL NOT grant requester authority, and requester contact email fields SHALL remain available.

#### Scenario: First Google sign-in
- **WHEN** a user completes Google sign-in for the first time
- **THEN** the service creates an active host account with the Calendar access granted on that screen, and `/app` asks them to link a messenger, where setup continues with Thyme

#### Scenario: Calendar scopes unchecked at sign-in
- **WHEN** the user completes Google sign-in but unchecks the Calendar scopes on the consent screen
- **THEN** the active host account is still created, and setup in the messenger asks for Calendar access through the browser consent link before calendar analysis or booking-destination selection, without blocking unrelated settings

#### Scenario: Invalid or cancelled return
- **WHEN** Google login is cancelled, the code is replayed or the callback arrives in another browser
- **THEN** no new authorized host session is established and the user can restart Google sign-in at `/app`

#### Scenario: Former email login request
- **WHEN** a client submits an email address to the sign-in endpoint
- **THEN** the request is rejected without sending an authentication email
