## ADDED Requirements

### Requirement: Revised request after a decline or an expiry
When a request closed as declined, expired or withdrawn, the guest's next message in its bound email thread or iMessage conversation SHALL create one revised request to the same host instead of reopening the closed one, only while the host is active and ready, as the only revised request of that closed request, while the chain from the first request holds fewer than 10 requests, and within the request creation bounds counted per keyed contact hash. The revised request SHALL carry over purpose, duration, mode, place or link plan, travel mode, timezone, language, requester name and contact (with its confirmed state when the address is unchanged) and the requester's windows, SHALL leave the declined time out of its searches without stating any reason, and SHALL carry no evaluations, proposals, agreements or approvals. It SHALL get a new booking link sent by the creation email, the channel binding SHALL move to it, and its discussion SHALL begin with an authored summary of the closed request, with the times proposed before and the declined time, that contains no host-private data, followed by the guest's message. A booked request SHALL create no revised request; its conversation SHALL reach its discussion, where the assistant SHALL answer questions about the confirmed meeting from the booking's receipt and SHALL record no change, and SHALL tell the guest to contact the host directly to change or cancel it.

#### Scenario: Reply after a decline
- **WHEN** the host declined and the guest replies in the bound email thread
- **THEN** one revised request exists, linked to the declined one, the thread reaches its discussion, and the declined request stays declined

#### Scenario: Second reply
- **WHEN** a revised request already exists for that closed request and the guest writes again in the old conversation
- **THEN** the message goes to the revised request's discussion and no further request is created

#### Scenario: Chain full
- **WHEN** the declined request is the tenth in its chain and the guest replies
- **THEN** the channel receives one fixed text and nothing is created

#### Scenario: Host unavailable
- **WHEN** the host was suspended or is no longer ready
- **THEN** the channel receives one fixed text and nothing is created

#### Scenario: Retried receipt
- **WHEN** the receipt that created a revised request is processed again
- **THEN** no second request, booking link or creation email is created

#### Scenario: Booked request
- **WHEN** the guest writes in the conversation of a booked request
- **THEN** the assistant answers questions about the meeting from the booking's receipt, records nothing, and no request is created

### Requirement: Requester changes until host approval
While a request awaits the host's approval and has no booking, the requester SHALL be able to withdraw their agreement with **Change**, which SHALL return the request to negotiating with a new revision, after which details and times SHALL be changeable and a new agreement SHALL need a new proposal version. A host approval and a change SHALL be serialized: whichever commits first SHALL stand, and the other SHALL be refused without creating a booking or a second agreement.

#### Scenario: Change before approval
- **WHEN** the requester presses **Change** on the agreed time while the host has not approved
- **THEN** the request is negotiating, the candidate times reopen, and an approval sent for the earlier version is refused as stale

#### Scenario: Approval first
- **WHEN** the host approves before the requester's change commits
- **THEN** the booking proceeds and the change is refused with the current status

### Requirement: Host sees the revised request's origin
The host's view and iMessage summary of a revised request SHALL state that it follows their earlier decline, the earlier request's expiry or the guest's withdrawal, with the earlier request's reference.

#### Scenario: Revised request summary
- **WHEN** the guest agrees to a time on a revised request of a linked host
- **THEN** the host's awaiting-approval summary names the earlier request's reference and its outcome (`host-imessage-channel` D24)

### Requirement: Booking page iMessage controls
The booking page SHALL offer **Get updates in iMessage** while the request is open, SHALL show the arrived masked sender with **Confirm and link**, and SHALL offer **Unlink iMessage** while a guest binding is active, each as one card in the thread, with keyboard access and at phone width.

#### Scenario: Keyboard linking
- **WHEN** a keyboard-only guest at 390 px links iMessage with the loopback stand-in
- **THEN** each step is reachable and the linked state is announced

## MODIFIED Requirements

### Requirement: Complete account-free intake
Ready public hosts SHALL accept requests without requester signup. The service SHALL collect purpose, requester identity/contact, timezone, duration, mode, and location or meeting link, clarifying missing or ambiguous fields; date windows SHALL be optional, and without them times SHALL be found over the next two weeks. A new request SHALL start with the host's meeting length, and with the meeting form when the host offers only one. The requester's assistant SHALL ask only for what is still open, one question at a time, using what the host offers every guest and nothing else of the host's settings, and SHALL draft the details in one review once nothing is missing. The requester website SHALL allow the requester to supply and refine scheduling details through conversation, review extracted changes before applying them, except that availability alone is applied and searched immediately when the meeting details are complete; evaluate availability, select a feasible candidate, and explicitly agree to the exact current proposal. Determinable days and relative weeks use the requester's timezone and cover the whole named days; genuinely ambiguous times still require clarification.

#### Scenario: Missing details
- **WHEN** a requester asks for thirty minutes next week without timezone or location
- **THEN** the request remains gathering with specific missing-field questions and no fabricated proposal

#### Scenario: Bilingual intake
- **WHEN** English or Korean intake supplies sufficient details
- **THEN** the service normalizes validated details and preserves the requester's stated intent

#### Scenario: Reviewed conversational details
- **WHEN** a requester message contains an unambiguous purpose, meeting mode, or location
- **THEN** the website presents the extracted changes for review and does not change the request until the requester applies them, on the card or in words

#### Scenario: A guest names days after completing meeting details
- **WHEN** a requester with complete meeting details names only a date or a determinable relative week
- **THEN** the service applies those days and searches for feasible times without asking for clock times or a separate review

#### Scenario: A preferred afternoon with an inferred boundary
- **WHEN** a guest says next week is possible and afternoon is preferred
- **THEN** the assistant proposes next week's days with an afternoon preference of 12:00–18:00 in the guest's timezone, states that the hours are assumed, and asks for confirmation before applying them
- **AND** the preference does not exclude other times within the stated days

#### Scenario: Recurring weekly guest preferences
- **WHEN** the guest saves or confirms preferred weekdays and times for the request
- **THEN** those preferences remain available when the request is reopened, and matching candidates are offered before other feasible times
- **AND** other feasible times remain available and the preferences do not carry into unrelated requests

#### Scenario: Choosing the meeting form
- **WHEN** the host offers both online and in-person meetings and the guest has not chosen a form
- **THEN** the website offers both as buttons alongside the assistant's question

#### Scenario: Conversational candidate agreement
- **WHEN** evaluated candidates are available in the requester conversation
- **THEN** the requester can explicitly select a candidate, review the resulting exact proposal, and separately confirm agreement before host review

#### Scenario: Host offers one form
- **WHEN** the host meets only online and the guest has said what the meeting is for
- **THEN** the assistant does not ask for the form or the length, and drafts the review

### Requirement: Continuous guest conversation
A ready host's public page SHALL open on a landing that names whose booking link it is and offers **Start with agent** and **Continue with web**. The web start SHALL show two fixed messages, the host's assistant's greeting and a request to continue with Google and Calendar, with the identity card, and SHALL write nothing and call no model until the guest presses **Continue with Google** or **Continue without Google**. That button SHALL create a draft request that is invisible to the host, accepts no message and is deleted 24 hours after creation unless the guest is identified, and the Google return or the name and email form SHALL identify it, send the creation email and open the booking page. Drafts SHALL be bounded to 5 per source address in any rolling hour and 20 in any rolling day. A request whose contact is unconfirmed and that holds no live Google identity SHALL have at most USD 3 of model allowance per 24 hours, counted toward a USD 50 anonymous allowance across the service; once its contact is confirmed or a Google identity is held, the usual request allowance SHALL apply, counting what it already spent. The booking page SHALL keep the two fixed messages at the top of the thread, settle the Calendar step, then ask with a fixed message what the meeting is for, with what the host offers, before the assistant's first turn. Candidate evaluation, candidate selection and agreement SHALL require the guest to be identified.

#### Scenario: Visitor asks for the host's calendar
- **WHEN** a guest asks the assistant for the host's free times or calendar
- **THEN** no tool can read them, nothing is read, and the assistant answers within the requester projection

#### Scenario: Nothing before a button
- **WHEN** a visitor opens the web start and leaves without pressing a button
- **THEN** no request exists and no model was called

#### Scenario: Times before identification
- **WHEN** something asks for times on a draft request whose guest has not given a name and email yet
- **THEN** no evaluation runs and the answer is that identity is required

#### Scenario: Identification keeps the thread
- **WHEN** a guest cancels the Google consent once and then continues with Google
- **THEN** the same draft request is identified, not a new one, and its booking page opens with the two fixed messages and the guest's details as their reply

#### Scenario: Anonymous budget exhausted
- **WHEN** the anonymous service-wide allowance is used up
- **THEN** the next assistant turn of an unconfirmed request without a Google identity gets a temporary-limit response, and **Continue without Google** still identifies a new guest and opens their booking page

#### Scenario: Identification opens the booking page
- **WHEN** a guest continues without Google with a name and email
- **THEN** the request leaves draft, the booking page opens with the two fixed messages, and the creation email is sent

#### Scenario: Abandoned draft
- **WHEN** a guest presses **Continue with Google** and cancels the consent
- **THEN** the host never sees the draft, a second try reuses it, and it is deleted after 24 hours unless identified

#### Scenario: Unconfirmed request keeps the anonymous cap
- **WHEN** a request identified without Google has spent USD 3 of model allowance and its contact is still unconfirmed
- **THEN** further model work for it is refused until the requester confirms the address

### Requirement: Constrained asynchronous interpretation
AI extraction SHALL operate on audience-appropriate context and return validated structured results. It SHALL not create approval, calendar writes, waive rules, reveal private information, or overwrite newer revisions. The requester's assistant MAY record the requester's own decisions in words, in any channel (applying drafted details, choosing one of the current candidate times, agreeing to the current proposal version, reopening an agreement before the host approves, and withdrawing after the requester confirmed it), only through the requester's own commands at the current revision and only for the exact time or version the requester named; when that is unclear it SHALL ask. Ambiguous dates or times SHALL produce clarification without actionable windows.

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
- **WHEN** a requester replies "yes, book it" to the current proposal in iMessage
- **THEN** the assistant records the requester's agreement to that proposal version, the request waits for the host's approval, and no approval or calendar event is created

#### Scenario: Unclear choice
- **WHEN** a requester writes "that one works" while several candidate times are shown
- **THEN** the assistant asks which time they mean and records nothing
