# chat-workspaces Specification

## Purpose
Provide a conversation-first workspace that keeps scheduling progress and decisions reviewable in context while preserving accessible structured controls for recovery and precise edits.

## Requirements

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

### Requirement: Contextual artifacts and actions
The website SHALL present draft changes, calendar choices, candidate times, current proposals, and decision status as reviewable artifacts in the relevant conversation. Available actions SHALL be labeled, keyboard-operable buttons adjacent to the artifact and SHALL invoke the existing authorized commands with current revisions.

#### Scenario: Review a candidate
- **WHEN** a requester receives feasible candidate times
- **THEN** the times appear in a conversation artifact with a select action and enough date, time, timezone, and duration detail to identify the choice

#### Scenario: Confirm a proposal
- **WHEN** the exact current proposal awaits requester agreement or host approval
- **THEN** the appropriate audience sees its own explicit decision button beside that proposal, and no message text alone records the decision

#### Scenario: Stale artifact
- **WHEN** a decision artifact refers to a superseded revision
- **THEN** the action is unavailable or rejected, the current artifact is shown, and no stale decision is saved

### Requirement: Equivalent safe recovery
The conversation and secondary controls SHALL report the same authoritative server outcome. Moving controls SHALL not weaken admission, consent, privacy, or approval checks, and a failed chat or model interpretation SHALL leave structured recovery available.

#### Scenario: Model unavailable
- **WHEN** interpretation fails while a user describes a setting or request detail
- **THEN** unsent text or a retry path remains visible, saved state is unchanged, and the user can open structured controls

#### Scenario: Narrow viewport and keyboard
- **WHEN** the workspace is used at phone width or by keyboard
- **THEN** the conversation, artifacts, action buttons, and secondary controls remain reachable with readable labels and visible status
