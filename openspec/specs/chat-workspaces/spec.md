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

### Requirement: Google-only MVP host login
The host workspace SHALL offer Google sign-in through Supabase Auth and SHALL NOT offer email/password, email OTP or magic-link login in the MVP. The application SHALL initiate identity-only OAuth with browser-bound PKCE and a fixed `/auth/callback` return to `/app`. The deployed Auth configuration SHALL disable email login. Login SHALL NOT grant host admission, Calendar permission or requester authority; waitlist and requester contact email fields SHALL remain available.

#### Scenario: Google login before admission
- **WHEN** a user completes Google sign-in without a redeemed invitation
- **THEN** the workspace displays invitation controls without private host conversation or Calendar access

#### Scenario: Invalid or cancelled return
- **WHEN** Google login is cancelled, the code is replayed or the callback arrives in another browser
- **THEN** no new authorized host session is established and the user can restart Google sign-in at `/app`

#### Scenario: Former email login request
- **WHEN** a client submits an email address to the sign-in endpoint
- **THEN** the request is rejected without sending an authentication email

### Requirement: Single host workspace
Host admission, setup, request selection, review and settings SHALL remain inside `/app` as authorized states, cards or dialogs. Browser authentication and consent SHALL return to that workspace with the permitted context restored.

#### Scenario: Return from calendar consent
- **WHEN** an admitted host completes valid browser consent
- **THEN** `/app` restores the authorized draft and server-confirmed next action without a separate setup page

### Requirement: Stable protected requester destination
Public `/{handle}` intake SHALL continue at `/booking/[bookingId]` after request creation. The route identifier SHALL not provide authority or imply a confirmed event. Closed access SHALL obey the existing request credential lifetime and minimal receipt limits.

#### Scenario: Shared calendar link has no credential
- **WHEN** a browser without request authority opens a booking route from a shared calendar description
- **THEN** it receives no protected history or receipt details

### Requirement: Recognized credentials are removed from conversation input
The service SHALL remove recognized bearer values, linking proofs and credential-bearing URL/query/fragment values before new conversation text is persisted in the runtime ledger or sent to the model. It SHALL preserve ordinary scheduling prose, replace removed material visibly and apply the same protection to authorized web, email and iMessage conversation input. Redaction SHALL confer no authority.

#### Scenario: Mixed scheduling and credential text
- **WHEN** an authorized message includes a meeting date/place alongside a bearer token, `LINK <UUID> <proof>` or named token/code/state/secret/proof/recovery/invitation/credential URL parameters
- **THEN** the runtime text retains the scheduling context and replacement markers but contains none of those credential values

#### Scenario: Credential URL encodings
- **WHEN** a credential parameter name has different casing or percent-encoded ASCII characters, or an iMessage proof appears in a URL fragment
- **THEN** the value cannot bypass protection and no automatic link-following or credential redemption occurs

#### Scenario: Ordinary links and prose
- **WHEN** a message contains ordinary scheduling prose or a link without recognized credential material
- **THEN** its meaningful content remains unchanged and it retains the existing size, authority and quota checks

### Requirement: Protected input retains exact retry semantics
Removing credential text SHALL NOT merge distinct submitted inputs under one message retry identity. Exact retries SHALL recover the same protected receipt without another model input or quota charge; changed original input SHALL conflict even if it produces the same protected text. Only a non-plaintext comparison value SHALL be retained for this purpose.

#### Scenario: Changed secret under the same retry identity
- **WHEN** two submissions have identical surrounding prose and retry identity but different recognized secret values
- **THEN** the later submission is rejected as a conflicting retry and no second message or charge is created

#### Scenario: Reclaimed pending delivery
- **WHEN** a protected message is redelivered after a process or acknowledgement failure
- **THEN** only its saved protected text reaches the runtime and no original credential value is reconstructed

#### Scenario: Pre-migration pending message
- **WHEN** a pending message admitted before this change is dispatched after migration
- **THEN** its recognized credentials are protected before future runtime delivery while its original retry identity remains stable

### Requirement: Visible conversation recovery
A workspace with a confirmed failed runtime SHALL show a safe explanation and an explicit recovery action while keeping saved scheduling controls available. The action SHALL remain keyboard-accessible and preserve pending text, history and discussion selection. Ordinary reconnect and send SHALL NOT silently replace a terminal runtime.

#### Scenario: Recover and continue
- **WHEN** the participant activates recovery and the guarded transition succeeds
- **THEN** the same logical conversation remains visible with its history and saved controls, and eligible pending or new input can continue

#### Scenario: Interrupted recovery response
- **WHEN** the browser loses a recovery response or reloads during recovery
- **THEN** it reads authoritative status and retries the same recovery identity without creating another successor

#### Scenario: Recovery unavailable
- **WHEN** provider state cannot be established or current authority is lost
- **THEN** the workspace reports that outcome without claiming recovery, exposing credentials or discarding unsent text
