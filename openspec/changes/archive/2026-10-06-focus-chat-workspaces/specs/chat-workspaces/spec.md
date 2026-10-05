# Spec Delta

## MODIFIED Requirements

### Requirement: Conversation-first entry
The website SHALL open host setup and request management on the relevant conversation, with the current next action and a message composer available without navigating through structured forms. The primary workspace SHALL have no persistent sidebar or dashboard panel. Navigation SHALL remain available through a compact, keyboard-operable control. Structured controls SHALL remain reachable from a secondary, clearly labeled surface.

#### Scenario: Resume host setup
- **WHEN** an admitted host returns to incomplete setup
- **THEN** the current conversation, server-derived progress, and next action appear first, the composer remains reachable in the initial phone viewport, and manual settings remain accessible

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
- **WHEN** a browser opens a protected request without its continuation credential
- **THEN** no request details or chat appear, and the page directs the requester to use their private request link without credential-paste or recovery controls
