# Spec Delta

## MODIFIED Requirements

### Requirement: Conversation-first entry
The website SHALL open request management and ready-host work on the relevant conversation, with the current next action and a message composer available without navigating through structured forms. For an active host whose setup is incomplete, `/app` SHALL instead show messaging channel selection and verified linking before any web setup conversation. The primary workspace SHALL have no persistent sidebar or dashboard panel. Navigation SHALL remain available through a compact, keyboard-operable control. Structured controls SHALL remain reachable from a secondary, clearly labeled surface. A protected request opened without valid authority SHALL show only the generic unavailable view with the link resend control that the meeting-request contract requires.

#### Scenario: Resume host setup
- **WHEN** an active host with incomplete setup opens `/app` after Google sign-in or on a later visit
- **THEN** the host sees the channel linking step first, and no browser setup question or composer is shown

#### Scenario: Resume request
- **WHEN** a requester or host opens an active meeting request
- **THEN** the permitted conversation and current request status appear first, with structured editing in a secondary surface

#### Scenario: Browse host requests
- **WHEN** a host opens the meeting inbox
- **THEN** request conversations appear as selectable artifacts in the conversation workspace without a dashboard or permanent sidebar

#### Scenario: Switch host discussion visibility
- **WHEN** a host reviews a request with shared and private discussions
- **THEN** a labeled switch shows one discussion at a time and never exposes the private discussion to a requester

#### Scenario: Use compact navigation
- **WHEN** a host opens the workspace menu by pointer or keyboard
- **THEN** setup, inbox, and sign-out actions are available, the menu closes with Escape, and focus returns to its trigger

#### Scenario: Request link without authority
- **WHEN** a browser opens a protected request without its continuation credential, or with an unknown, malformed or expired one
- **THEN** no request details or chat appear, and the page directs the requester to use their private request link and offers only the generic **Resend my booking link** control, with no credential-paste field and no other recovery control

### Requirement: Google-only MVP host login
The host workspace SHALL offer Google sign-in through Supabase Auth and SHALL NOT offer email/password, email OTP or magic-link login in the MVP. The application SHALL initiate one Google OAuth consent that requests identity together with the Calendar scopes needed to read selected calendars and create events, with browser-bound PKCE, offline access and a fixed `/auth/callback` return to `/app`, and SHALL record the scopes Google actually granted and the refresh token server-side at sign-in. The deployed Auth configuration SHALL disable email login. First-time Google sign-in SHALL create an active host account whether or not the Calendar scopes were granted. Calendar permission SHALL exist only for granted scopes; login SHALL NOT grant requester authority, and requester contact email fields SHALL remain available.

#### Scenario: First Google sign-in
- **WHEN** a user completes Google sign-in for the first time
- **THEN** the service creates an active host account and `/app` immediately offers configured iMessage, WhatsApp and Telegram linking choices; no second Google sign-in is requested

#### Scenario: Calendar scopes unchecked at sign-in
- **WHEN** the user completes Google sign-in but unchecks the Calendar scopes on the consent screen
- **THEN** the active host account is still created and, after channel linking, setup offers a browser **Connect Google Calendar** consent link in the linked conversation before calendar analysis or booking-destination selection

#### Scenario: Invalid or cancelled return
- **WHEN** Google login is cancelled, the code is replayed or the callback arrives in another browser
- **THEN** no new authorized host session is established and the user can restart Google sign-in at `/app`

#### Scenario: Former email login request
- **WHEN** a client submits an email address to the sign-in endpoint
- **THEN** the request is rejected without sending an authentication email

### Requirement: Single host workspace
Host sign-in, channel linking, request selection, review and settings SHALL remain inside `/app` as authorized states, cards or dialogs. A host with incomplete setup SHALL complete setup in the verified messaging conversation, with browser authentication and consent returning to the authorized linking or conversation state. A ready host SHALL retain workspace access.

#### Scenario: Return from calendar consent
- **WHEN** an active host completes valid browser Calendar consent during message-led setup
- **THEN** the linked conversation resumes the server-confirmed next action without a separate web setup page

## ADDED Requirements

### Requirement: Verified messaging handoff for host setup
An incomplete host SHALL choose one configured messaging channel, send its one-time proof from that channel, and confirm the observed sender in the authenticated browser before the channel can control setup. The browser SHALL NOT offer deferral into web setup. The linked conversation SHALL own settings suggestions, slot review and the first booking link. A failed status read or provider error SHALL show a retry path without granting channel authority.

#### Scenario: Choose a channel
- **WHEN** an incomplete host opens `/app` without a pending link
- **THEN** configured iMessage, WhatsApp and Telegram choices are shown, except iMessage on Android, and selecting one starts its existing secure link flow

#### Scenario: Confirm sender
- **WHEN** the host's one-time proof arrives from a channel sender
- **THEN** the browser shows that sender and requires explicit confirmation before the binding becomes active

#### Scenario: Linked continuation
- **WHEN** the sender is confirmed
- **THEN** the browser offers a link to the selected messaging app and setup continues in that conversation, including the first booking link after confirmed readiness

#### Scenario: Link unavailable
- **WHEN** the link status cannot load or the provider cannot create a link
- **THEN** the browser explains the failure, offers retry, and does not expose web setup as a bypass
