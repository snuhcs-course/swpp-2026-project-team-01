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
The website SHALL present draft changes, calendar choices, candidate times, current proposals, and decision status as reviewable artifacts in the relevant conversation. Available actions SHALL be labeled, keyboard-operable buttons adjacent to the artifact and SHALL invoke the authorized commands with current revisions.

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

### Requirement: Bounded conversation admission
The service SHALL admit at most 20 new messages per minute and 100 per hour per host account or requester request, and 200 per minute and 2,000 per hour service-wide. Independent fixed windows SHALL start at the first accepted message after expiry. Budgets SHALL be shared across scopes, channels and replacement credentials. Admission and charging SHALL commit atomically; accepted exact retries SHALL not charge again.

#### Scenario: Concurrent messages across scopes
- **WHEN** concurrent authorized inputs cross the remaining host or service allowance
- **THEN** only the remaining allowance is accepted, and rejected inputs create no runtime work or scheduling changes

#### Scenario: Retry and authority
- **WHEN** an accepted input is retried at the limit
- **THEN** its exact receipt remains available only under current authority, without another charge, and changed input is rejected

#### Scenario: Window recovery
- **WHEN** a fixed window expires while an input waits for its budget lock
- **THEN** admission uses the current wall clock, and expired or revoked authority still cannot admit a message

### Requirement: Recoverable conversation throttling
Temporary admission throttling SHALL return a safe retryable error to web callers while retaining the unsent message and structured controls. Authenticated messaging receipts SHALL remain queued in order, delayed at least one minute, without consuming provider failure attempts; delayed execution SHALL revalidate authority. Existing lifetime caps SHALL remain terminal and distinct from temporary throttling.

#### Scenario: Browser throttling
- **WHEN** a new browser message exceeds a temporary budget
- **THEN** the response is HTTP 429 with a safe temporary-limit message and the same message can be retried after capacity returns

#### Scenario: Messaging backpressure
- **WHEN** a verified iMessage or requester-email receipt exceeds a temporary budget
- **THEN** it remains unprocessed with no runtime message, retries no earlier than one minute later and does not allow a later receipt in that conversation to overtake it

#### Scenario: Authority expires during delay
- **WHEN** the linked authority expires or is revoked before a delayed receipt is retried
- **THEN** no new model work is admitted and the receipt reaches the channel's existing unauthorized terminal outcome
