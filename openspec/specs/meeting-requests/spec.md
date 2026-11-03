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
The identifier in `/booking/[bookingId]` SHALL be a server-generated random UUID and SHALL be the requester's only credential for that request: holding the link authorizes exactly that request, with no separate token, cookie exchange or URL fragment. The service SHALL look the identifier up only by its hash, SHALL NOT derive it from any guessable value and SHALL keep it out of referrers, search indexes, shared calendar descriptions and full request logs. Any recoverable copy SHALL be kept only sealed with the application's encryption key and SHALL be opened only to email the link to the request's contact on creation or contact change, to resend it to the request's verified contact, to recover an exact creation retry, or to return the requester's own browser to the request after Google consent. A link SHALL expire within thirty days of request creation and SHALL lose mutation and OAuth authority on request closure, after which it SHALL permit only a minimal terminal status and confirmed-booking receipt read, excluding private discussion and historical provider context. A lost link SHALL be resent only to the request's previously verified contact.

#### Scenario: Unknown or expired identifier
- **WHEN** a booking link with an unknown, malformed or expired identifier is opened
- **THEN** the destination shows the generic unavailable view without revealing whether a request exists

#### Scenario: Unverified resend contact
- **WHEN** a caller asks for a lost link using an unverified email claim
- **THEN** no booking link is sent

#### Scenario: Final receipt after asynchronous booking
- **WHEN** a valid unexpired booking link is opened after the request closes
- **THEN** only its final status and confirmed booking receipt are readable, and mutation and new OAuth actions are rejected

#### Scenario: Database read without the key
- **WHEN** someone reads the stored booking-link records without the application's encryption key
- **THEN** no usable booking link can be rebuilt from them

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

### Requirement: Private bounded link resend
Link resend SHALL accept an email address without disclosing request existence, verified-contact state or delivery outcome. Only an active request's previously verified current contact SHALL receive that request's current booking link. Issuance SHALL permit at most one resend per minute and five per hour per request. Exact retries SHALL create no extra delivery.

#### Scenario: Unknown or unverified contact
- **WHEN** a caller supplies an email that matches no active request's verified contact, or only a closed request
- **THEN** the same generic acceptance is returned without sending any email

#### Scenario: Repeated issuance
- **WHEN** concurrent or retried issuance uses the same logical identity
- **THEN** at most one delivery is created, and changed input cannot replace that pending resend

### Requirement: Accessible link resend
The public host page and the booking destination's unavailable view SHALL offer link resend with labeled keyboard-operable controls and generic issuance feedback. The resent email SHALL carry the current booking link and nothing that grants broader access; resend SHALL NOT create login, proposal agreement, host approval or booking. Delivery SHALL use durable frozen Cloudflare messages, suppress stale recipients and avoid blind resend after possible acceptance.

#### Scenario: Reopen from a resent link
- **WHEN** the verified recipient opens the resent booking link in any browser
- **THEN** the browser resumes only that request, with no login session, agreement, approval or booking created

#### Scenario: Uncertain delivery
- **WHEN** delivery may have succeeded but its acknowledgment is lost
- **THEN** the same message is not automatically resent and the caller sees no private delivery information

### Requirement: Aggregate resend issuance limits
Resend issuance SHALL allow at most five emails per verified recipient per hour across requests and at most 120 across the service per minute. A fixed-size budget SHALL bound accepted issuance attempts to 600 per minute without storing caller IPs or unknown email claims. Budget exhaustion SHALL preserve generic acceptance and send no email.

#### Scenario: Same recipient across requests
- **WHEN** five resend emails have been sent to a verified address within an hour
- **THEN** another request using that address receives generic acceptance without another email

#### Scenario: Shared budget exhaustion
- **WHEN** either service-wide minute budget is exhausted
- **THEN** additional issuance produces no delivery and normal issuance resumes in the next budget window

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

### Requirement: Declared uncertain extraction has no patch
Application-owned requester extraction SHALL declare details, availability, question or unknown intent. Question and unknown outcomes SHALL contain no proposed scheduling or contact fields and SHALL include clarification. Invalid or missing classification SHALL be rejected before domain execution. Valid details and availability outcomes SHALL remain advisory and require the existing explicit review application.

#### Scenario: Question carries a change
- **WHEN** extraction declares question or unknown intent while supplying any patch field
- **THEN** it is rejected without creating or replacing a review or changing request state

#### Scenario: Clarification-only outcome
- **WHEN** extraction declares question or unknown intent with an empty patch and a nonempty clarification
- **THEN** the result can request clarification but cannot apply scheduling changes

#### Scenario: Explicit scheduling draft
- **WHEN** details or availability intent supplies a valid advisory draft
- **THEN** it follows the existing revision, retry and explicit application rules without granting agreement or approval

### Requirement: Authored application extraction questions
New clarification text from application-owned requester extraction SHALL come only from authored questions for supported clarification categories in English or Korean. Unsupported categories or languages SHALL be rejected before domain execution. Clarification questions SHALL NOT assert agreement, approval, selection or booking. Current draft, retry and explicit-application rules SHALL remain in force.

#### Scenario: Model supplies a status claim
- **WHEN** extraction supplies arbitrary prose, including a claimed approval or booking, as a clarification category
- **THEN** it is rejected without creating or replacing a review

#### Scenario: Supported clarification
- **WHEN** extraction selects a supported missing-field category and English or Korean
- **THEN** the pending review contains the corresponding authored question and cannot apply while clarification remains

#### Scenario: Complete draft or exact retry
- **WHEN** a valid draft needs no clarification, or the same category/language draft is retried
- **THEN** an empty clarification list remains empty and an exact retry recovers the same authored wording without another mutation

### Requirement: Optional contact confirmation
Confirming the requester's contact address SHALL be optional, and no scheduling step SHALL wait on it: intake, candidates, agreement and later host approval, invitation and status emails SHALL proceed with an unconfirmed address. When a request is created, and whenever its contact address changes, the service SHALL email that address the booking link and a single-use confirmation link. Opening the confirmation link SHALL confirm nothing by itself and SHALL show a **Confirm this address** button; pressing it SHALL confirm that address only while it is still the request's contact and the request is open; a newer email, a contact change or closure SHALL void earlier confirmation links. An address Google reports as verified for the requester's identity SHALL count as confirmed without the email. A confirmed address is the request's verified contact wherever this contract names one, and the host SHALL see whether the contact is confirmed. Confirmation SHALL create no login session, agreement, approval or booking.

#### Scenario: Creation email
- **WHEN** a requester continues without Google and the request is created
- **THEN** one email goes to the typed address with the booking link and a confirmation link, and the requester can go on scheduling before opening it

#### Scenario: Confirmation link opened
- **WHEN** the recipient opens an unused confirmation link for the request's current contact and presses **Confirm this address**
- **THEN** that address becomes confirmed and nothing else about the request changes

#### Scenario: Link fetched without a press
- **WHEN** a mail scanner fetches the confirmation link
- **THEN** the address stays unconfirmed

#### Scenario: Link after a contact change
- **WHEN** the requester changes the contact address and the old confirmation link is opened
- **THEN** neither address is confirmed by it, and the new address receives its own email

#### Scenario: Google-verified address
- **WHEN** the requester continued with Google and Google reports the address as verified
- **THEN** the address counts as confirmed and the creation email carries no confirmation link

#### Scenario: Unconfirmed agreement
- **WHEN** a requester whose address is unconfirmed agrees to the current proposal
- **THEN** the agreement is recorded and the host sees that the contact is unconfirmed

### Requirement: Recoverable confirmation email
Sending the creation email again SHALL wait at least 60 seconds after the previous one for the same request and SHALL allow at most 5 per request and 10 per recipient address in any rolling hour, and 1,000 across the service in any rolling day. These bounds SHALL apply to every creation email, including the one request creation sends and those a contact change sends, and a contact change past a bound SHALL be rejected with nothing changed. Repeated send commands SHALL preserve their logical identity across lost responses, so a duplicate creates no second email. Delivery SHALL use durable Cloudflare messages with frozen sender and content and a recipient recheck; possible dispatch SHALL prevent automatic resending. The requester SHALL have labeled keyboard-operable controls and truthful queued, sent, rejected, uncertain and confirmed states, and browser reload SHALL recover the current status.

#### Scenario: Too soon or too many
- **WHEN** the requester asks to send the email again within 60 seconds, or past an hourly or daily bound
- **THEN** no email is created and the card says when it can be sent again

#### Scenario: Contact changed too often
- **WHEN** the requester changes the contact address again within 60 seconds of the last creation email
- **THEN** the change is rejected with a temporary-limit result, the contact stays as it was and no email is created

#### Scenario: Response lost after commit
- **WHEN** a send command commits but its response is lost
- **THEN** retrying the same command recovers its saved status without another email

#### Scenario: Uncertain email
- **WHEN** the send response is lost after possible provider acceptance
- **THEN** the email is not sent again automatically and the card shows that delivery is uncertain

### Requirement: Continuous guest conversation
A ready host's public page SHALL offer an assistant conversation from the guest's first message, and that conversation SHALL continue in the same thread and assistant session until the request closes. The first message SHALL create a draft request that is invisible to the host, bound to one browser tab by its booking link kept outside the address bar, limited to 30 messages and deleted 24 hours after creation unless the guest is identified. Drafts SHALL be bounded to 5 per source address in any rolling hour and 20 in any rolling day. A request whose contact is unconfirmed and that holds no live Google identity, drafts included, SHALL have at most USD 3 of model allowance per 24 hours, counted toward a USD 50 anonymous allowance across the service; once its contact is confirmed or a Google identity is held, the usual request allowance SHALL apply, counting what it already spent. Candidate evaluation, candidate selection and agreement SHALL require the guest to be identified. Identification SHALL keep the same thread and session, SHALL move the address bar to the booking link without reloading the page, and SHALL send the creation email.

#### Scenario: Visitor asks for the host's calendar
- **WHEN** a visitor on the public page asks the assistant for the host's free times or calendar
- **THEN** no tool can read them, nothing is read, and the assistant answers within the requester projection

#### Scenario: Times before identification
- **WHEN** a guest who has not given a name and email asks for available times
- **THEN** no evaluation runs and the identity card appears in the thread

#### Scenario: Identification keeps the thread
- **WHEN** a guest who described the meeting on the public page continues without Google
- **THEN** the request leaves draft, the address bar shows its booking link without a reload, the assistant still has the earlier messages, and the creation email is sent

#### Scenario: Abandoned draft
- **WHEN** a guest sends a message and leaves without identifying
- **THEN** the host never sees the draft and it is deleted after 24 hours

#### Scenario: Anonymous budget exhausted
- **WHEN** the anonymous service-wide allowance is used up
- **THEN** new draft messages get a temporary-limit response and **Continue without Google** still identifies the guest

#### Scenario: Unconfirmed request keeps the anonymous cap
- **WHEN** a request identified without Google has spent USD 3 of model allowance and its contact is still unconfirmed
- **THEN** further model work for it is refused until the requester confirms the address

### Requirement: Bounded request creation
Creating a request on a public host page SHALL require a ready host and SHALL be bounded to 5 requests per source address in any rolling hour and 20 in any rolling day and 500 across the service in any rolling day, with no per-host bound. Source addresses SHALL be stored only as keyed hashes. Past a bound, the service SHALL create nothing and SHALL return generic temporary-limit feedback that discloses neither the host's existing requests nor which bound applied.

#### Scenario: Source over its bound
- **WHEN** a sixth request is attempted from one source address within an hour
- **THEN** no request, booking link or conversation is created and the page shows a temporary-limit message

#### Scenario: Unavailable host
- **WHEN** a requester attempts to create a request for an unknown, unready or suspended host
- **THEN** nothing is created and the response is the same neutral unavailable result as the public page

#### Scenario: Exact creation retry
- **WHEN** a creation command is retried with the same retry identity after its response was lost
- **THEN** the same request and booking link are returned and no bound is charged again

### Requirement: Online meeting link plan
A proposal for an online meeting SHALL record its link plan as either a Google Meet conference created with the event in the host's booking destination, offered only when that calendar supports Google Meet, or an `https:` link the requester supplied. Requester agreement and host approval SHALL cover the recorded plan, and a change of plan SHALL create a new proposal version. When neither plan is available, the request SHALL ask the requester for a meeting link instead of creating a proposal.

#### Scenario: Destination supports Meet
- **WHEN** an online request is evaluated and the host's booking destination allows Google Meet
- **THEN** the proposal shows that a Google Meet link will be created when the meeting is booked

#### Scenario: Requester supplies a link
- **WHEN** the requester applies a reviewed `https:` meeting link
- **THEN** the proposal shows that link, and agreement covers it

#### Scenario: No plan available
- **WHEN** the destination does not allow Google Meet and the requester has supplied no link
- **THEN** no proposal is created and the requester is asked for a meeting link
