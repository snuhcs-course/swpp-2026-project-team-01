# meeting-requests Specification

## Purpose
Carry one account-free meeting request through protected, versioned negotiation and host review while keeping each audience's information separate.

## Requirements

### Requirement: Complete account-free intake
Ready public hosts SHALL accept requests without requester signup. The service SHALL collect purpose, requester identity/contact, date windows, timezone, duration, mode, and location or meeting link, clarifying missing or ambiguous fields. The requester website SHALL allow the requester to supply and refine scheduling details through conversation, review extracted changes before applying them, evaluate availability, select a feasible candidate, and explicitly agree to the exact current proposal.

#### Scenario: Missing details
- **WHEN** a requester asks for thirty minutes next week without timezone or location
- **THEN** the request remains gathering with specific missing-field actions and no fabricated proposal

#### Scenario: Bilingual intake
- **WHEN** English or Korean intake supplies sufficient details
- **THEN** the service normalizes validated details and preserves the requester's stated intent

#### Scenario: Reviewed conversational details
- **WHEN** a requester message contains an unambiguous purpose, meeting mode, location, or availability window
- **THEN** the website presents the extracted changes for review and does not change the request until the requester explicitly applies them

#### Scenario: Conversational candidate agreement
- **WHEN** evaluated candidates are available in the requester conversation
- **THEN** the requester can explicitly select a candidate, review the resulting exact proposal, and separately confirm agreement before host review

### Requirement: Protected request continuation
Guest credentials SHALL authorize exactly one request, be stored as hashes server-side, expire within thirty days, and lose mutation, OAuth, and recovery authority on request closure. The existing unexpired request-bound credential SHALL permit only a minimal terminal status and confirmed-booking receipt read, excluding private discussion and historical provider context. Credential recovery SHALL verify the original contact before issuing replacement authority.

#### Scenario: Wrong request token
- **WHEN** a guest uses a continuation token for a different request
- **THEN** access is denied without revealing that request

#### Scenario: Unverified recovery contact
- **WHEN** a caller requests replacement authority using an unverified email claim
- **THEN** no usable continuation credential is issued

#### Scenario: Final receipt after asynchronous booking
- **WHEN** a valid unexpired request-bound credential polls after the request closes
- **THEN** only its final status and confirmed booking receipt are readable, and mutation, new OAuth, and recovery actions are rejected

### Requirement: Immutable current proposals
Each material meeting revision SHALL create a new immutable proposal version. Time, duration, participants, mode, or location changes SHALL invalidate applicable prior agreement and approval, requiring current decisions.

#### Scenario: Host changes agreed details
- **WHEN** the host revises a proposal after requester agreement
- **THEN** a new version is current and agreement and approval for old details cannot authorize booking

#### Scenario: Stale agreement
- **WHEN** the requester agrees to a superseded proposal
- **THEN** the action is rejected with current status and no decision on the newer proposal

### Requirement: Expected revision concurrency guards
Mutations of an existing request, including applying a conversational review, SHALL require its expected revision and reject stale input without overwriting intervening changes. Revision checks SHALL remain separate from same-operation idempotency.

#### Scenario: Concurrent stale mutation
- **WHEN** a mutation's expected revision differs from the current request revision
- **THEN** it is rejected with a stable conflict outcome and the intervening change remains intact

#### Scenario: Stale conversational review
- **WHEN** a requester tries to apply extracted details after another message or request mutation changed the revision
- **THEN** the review is rejected and no extracted field overwrites the newer request

### Requirement: Persisted lifecycle and closure guards
Requests SHALL expose gathering, negotiating, awaiting host approval, booking, booked, declined, withdrawn, or expired status. Still-actionable requests SHALL expire seven days after creation or at the requested window end, whichever is earlier; terminal requests SHALL not reopen through replay.

#### Scenario: Requester withdraws before booking
- **WHEN** withdrawal commits before entry to booking
- **THEN** the request becomes withdrawn and late agreement or approval cannot create an event

#### Scenario: Expired request
- **WHEN** an actionable request reaches its seven-day deadline or the earlier requested-window end
- **THEN** later decisions are rejected and continuation requires a new or explicitly refreshed request

#### Scenario: Withdrawal during pending write
- **WHEN** withdrawal is attempted after booking may have begun
- **THEN** the pending outcome is reported without claiming that event creation was prevented

### Requirement: Audience-specific projections
Guest responses SHALL contain only their submitted details, shared proposals, permitted conversation, and relevant status. Host notes, rules, preference exceptions, and private calendar context SHALL remain host-only.

#### Scenario: Guest inspects request
- **WHEN** a requester reads a request containing private host discussion or exception reasoning
- **THEN** those fields and messages are absent from the guest response

### Requirement: Constrained asynchronous interpretation
AI extraction SHALL operate on audience-appropriate context and return validated structured results. It SHALL not create approval, agreement, proposals, calendar writes, waive rules, reveal private information, or overwrite newer revisions. Ambiguous dates or times SHALL produce clarification without actionable windows.

#### Scenario: Prompt injection
- **WHEN** intake tells the assistant to ignore approval rules or reveal calendar contents
- **THEN** authority and visibility guards remain enforced

#### Scenario: Stale extraction
- **WHEN** an extraction result completes after its request revision changes
- **THEN** it is discarded or recomputed before any state update

#### Scenario: Ambiguous conversational time
- **WHEN** a requester gives a relative or offset-free time that cannot be resolved without invention
- **THEN** the assistant asks for an explicit date, time, and timezone and exposes no actionable window

#### Scenario: Natural-language assent
- **WHEN** a requester sends a message such as “yes” or “book it”
- **THEN** the message does not create requester agreement, host approval, or a calendar event

### Requirement: Accessible proposal review
Web intake and host review SHALL support phone widths, keyboard operation, labeled controls, readable validation, and exact proposal details in decision controls. Requester conversation actions SHALL expose the reviewed changes, candidate times, and proposal agreement as labeled keyboard-operable controls.

#### Scenario: Keyboard host review
- **WHEN** a host reviews a request using only the keyboard on a narrow screen
- **THEN** proposal details and available decision controls remain reachable and understandable without color-only status

#### Scenario: Keyboard requester conversation
- **WHEN** a requester completes scheduling from the conversation using only the keyboard on a narrow screen
- **THEN** draft review, evaluation, candidate selection, and explicit agreement remain reachable and understandable without relying on color

### Requirement: Bounded requester contact verification
A currently authorized requester SHALL explicitly request and enter a code sent to the request's current email before that address is trusted for attendee use. Codes SHALL expire, permit at most five failed guesses, and be invalidated by a new code, contact change, credential rotation or closure. Sending SHALL enforce a resend cooldown and per-request hourly limit.

#### Scenario: Correct current code
- **WHEN** the requester submits a current unexpired code for the same request, credential and contact
- **THEN** only that contact becomes verified, with no login session, replacement request credential, agreement, host approval or booking

#### Scenario: Attempts exhausted
- **WHEN** five distinct invalid confirmation commands are submitted for a code
- **THEN** further confirmation is denied, including a later correct guess, until an allowed new challenge is issued

#### Scenario: Changed contact or authority
- **WHEN** the contact, request credential or lifecycle changes after a code is issued
- **THEN** the old code cannot verify the new contact or regain authority

### Requirement: Recoverable contact verification commands
Repeated verification commands SHALL preserve their logical identity across lost responses. Duplicate code requests SHALL create no second challenge or email, and repeated confirmation commands SHALL not consume another attempt or repeat successful state changes. Browser reload SHALL recover current status without exposing the code or private delivery content.

#### Scenario: Response lost after commit
- **WHEN** a request or confirmation commits but the response is lost
- **THEN** retrying the same command recovers its saved result without another email or state change

### Requirement: Honest verification delivery
Verification SHALL use durable Cloudflare delivery with frozen sender/content and recipient rechecks. Possible dispatch SHALL prevent automatic resending, and failed or uncertain delivery SHALL remain distinct from successful contact verification. The requester SHALL have labeled keyboard-operable controls and truthful queued, failed, uncertain, expired and verified states.

#### Scenario: Uncertain email
- **WHEN** the send response is lost after possible provider acceptance
- **THEN** verification remains unproven, the saved send is not repeated, and the requester can explicitly request a new code after the cooldown

### Requirement: Private bounded recovery requests
Recovery SHALL accept a known request identifier and email without disclosing request existence, verified-contact state or delivery outcome. Only an active request's previously verified current contact SHALL receive a recovery link. Issuance SHALL permit at most one link per minute and five per hour per request, with a fifteen-minute lifetime bounded by request expiry. Exact retries SHALL create no extra delivery.

#### Scenario: Unknown or unverified contact
- **WHEN** a caller supplies a missing request, wrong email, unverified contact or closed request
- **THEN** the same generic acceptance is returned without sending recovery email or issuing authority

#### Scenario: Repeated issuance
- **WHEN** concurrent or retried issuance uses the same logical identity
- **THEN** at most one challenge and delivery are created, and changed input cannot replace that challenge

### Requirement: Atomic recovery credential replacement
A valid recovery proof SHALL atomically replace only its bound request credential. Old credentials, pending contact proofs and linked channels SHALL lose authority. Changed contact, revocation, supersession, closure or expiry SHALL invalidate the proof permanently. Recovery SHALL not create login, proposal agreement, host approval or booking.

#### Scenario: Lost redemption response
- **WHEN** a valid recovery redemption commits but its response is lost
- **THEN** the exact redemption can recover the same replacement credential while it remains current, without a second rotation

#### Scenario: Earlier proof after later change
- **WHEN** the contact changes and changes back, or another credential replaces the recovered credential
- **THEN** an earlier proof or successful replay cannot restore access

### Requirement: Accessible private recovery continuation
The booking destination SHALL offer recovery with labeled keyboard-operable controls and generic issuance feedback. Recovery links SHALL contain secrets only in a fragment, remove them immediately and exchange them for request-specific HttpOnly cookies. Delivery SHALL use durable frozen Cloudflare messages, suppress stale recipients and avoid blind resend after possible acceptance.

#### Scenario: Recover in a browser without prior access
- **WHEN** the verified recipient explicitly redeems an unexpired recovery link
- **THEN** the browser resumes only that request without placing the credential in query strings, browser storage or model context

#### Scenario: Uncertain delivery
- **WHEN** delivery may have succeeded but its acknowledgment is lost
- **THEN** the same message is not automatically resent and the caller sees no private delivery information

### Requirement: Aggregate recovery issuance limits
Recovery issuance SHALL allow at most five links per verified recipient per hour across requests and at most 120 links across the service per minute. A fixed-size budget SHALL bound accepted issuance attempts to 600 per minute without storing caller IPs or unknown email claims. Budget exhaustion SHALL preserve generic acceptance and issue no proof or email.

#### Scenario: Same recipient across requests
- **WHEN** five recovery links have been issued to a verified address within an hour
- **THEN** another request using that address receives generic acceptance without another recovery link

#### Scenario: Shared budget exhaustion
- **WHEN** either service-wide minute budget is exhausted
- **THEN** additional issuance produces no proof or delivery and normal issuance resumes in the next budget window

### Requirement: Temporally valid assistant review windows
An assistant-generated request review SHALL contain only windows whose starts are still in the future when a new review is accepted. Each window SHALL accommodate the proposed effective meeting duration when that duration is known. Invalid windows SHALL reject the new review without superseding a pending review or changing scheduling state. An omitted duration SHALL NOT be invented.

#### Scenario: Past-start extraction
- **WHEN** an assistant supplies a window that has already begun, even if its end is still in the future
- **THEN** the review is rejected and existing review and scheduling state remain unchanged

#### Scenario: Duration inherited or changed
- **WHEN** proposed windows are shorter than the duration obtained by merging the partial patch with current details
- **THEN** the review is rejected without persisting partial results

#### Scenario: Duration not yet known
- **WHEN** future windows are proposed before a duration has been supplied
- **THEN** no duration is inferred and incomplete details cannot authorize candidate selection or booking

### Requirement: Review time validation respects current decisions and retries
Applying an assistant review SHALL recheck future starts and known duration after acquiring the required locks. A rejected apply SHALL preserve the pending review and current request. Exact retries of already committed review creation or decisions SHALL retain their recorded outcome without another mutation, even after time has elapsed.

#### Scenario: Window begins before apply
- **WHEN** the window starts after review creation but before apply validation, including during a lock wait
- **THEN** applying it is denied without updating request details or consuming the decision

#### Scenario: Committed retry after time passes
- **WHEN** the same authorized review creation or decision is retried after its window starts
- **THEN** the existing result is recovered without creating, applying or superseding another review

### Requirement: Minimized structured contact context
New application-owned conversation tool results SHALL replace structured requester names and email addresses with derived presence indicators, including nested current, proposed and reviewed details. Omitted patch fields SHALL remain distinguishable from explicit empty values. Authorized protected contact review and explicit contact edits SHALL remain available. Presence SHALL NOT imply verification, agreement or approval.

#### Scenario: Read or draft echoes saved contact
- **WHEN** a conversation reads current request context or creates a details draft containing saved requester contact fields
- **THEN** its model-facing tool result contains contact presence indicators instead of those structured values, retaining scheduling and review state

#### Scenario: Exact application retry
- **WHEN** a committed request operation is retrieved again through the conversation application adapter
- **THEN** the recovered result receives the same contact minimization without another mutation

#### Scenario: Partial or empty contact edit
- **WHEN** a draft omits one contact field and explicitly empties another
- **THEN** the omitted field remains absent from the patch projection, the empty field is marked absent, and protected review retains the exact edit for explicit application

#### Scenario: Protected contact review
- **WHEN** the currently authorized requester reviews or applies an explicit contact correction in protected controls
- **THEN** the exact contact remains visible there and existing verification invalidation and human confirmation rules still apply
