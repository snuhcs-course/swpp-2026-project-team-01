## MODIFIED Requirements

### Requirement: Exact commands before any model turn
A linked host's whole-message commands SHALL be parsed and executed by the application before any model turn: listing requests, reading a named request, entering setup within the account conversation, reviewing, showing suggested changes, sharing or dismissing a suggestion, approving or declining a proposal, and confirming settings. They SHALL keep working for reply buttons and for hosts who type them, but no reply SHALL ask the host to type one. Decisions SHALL name the exact current reference and run through the application command pipeline as the linked host with a retry identity derived from the receipt. A stale or unknown reference SHALL change nothing and return the current reference or a web link. Free text SHALL decide only through the assistant, as the requirements on approval and on host decisions in the host's own words allow. Legacy `setup` and `request <ref>` commands SHALL NOT select another discussion or runtime.

#### Scenario: Approve the current proposal
- **WHEN** the linked host sends `approve <ref>` naming the latest agreed proposal version
- **THEN** that version is approved once and the booking proceeds as from the web

#### Scenario: Reply to an outdated proposal
- **WHEN** the host sends `approve <ref>` naming a version that a newer proposal superseded
- **THEN** nothing is approved and the reply names the current reference

#### Scenario: Conditional yes
- **WHEN** the host replies "yes, but can we do 11?" to a summary
- **THEN** the text goes to the assistant as discussion and no decision is recorded

#### Scenario: Replay after restart during a web action
- **WHEN** the same approval receipt is processed again after a restart while the host also acts on the web
- **THEN** at most one approval and one booking exist and both channels show the same decision

### Requirement: Approval in the host's own words
In the host account conversation, the assistant SHALL be able to approve the current agreed proposal when the host clearly approves it in their own words in the linked iMessage, WhatsApp or Telegram conversation, through the same application command as the web button and with the exact current version. It SHALL NOT approve for a message typed on the web, for a version that is no longer current, for a closed request, or when the reply asks for a change, adds a condition or asks a question. The awaiting-approval summary SHALL say the host may approve in their own words, without selecting a request or replacing the assistant's pending question. An unqualified reply SHALL use only that question's target ref and still-current version; absent an unambiguous target it SHALL ask one clarification and approve nothing.

#### Scenario: Clear approval from iMessage
- **WHEN** a linked host replies "Looks good, book it" to the assistant's pending question about one still-current proposal
- **THEN** the current version is approved once and the booking proceeds as from the web

#### Scenario: Same words on the web
- **WHEN** a caller submits "Looks good, book it" as a web-typed host input
- **THEN** nothing is approved and the host is pointed to **Approve this proposal**

#### Scenario: Outdated version
- **WHEN** the assistant tries to approve a version that a newer proposal superseded
- **THEN** nothing is approved and the assistant names the current version

### Requirement: Shared discussions and replies
A linked host's free text SHALL become an accepted input of the one account assistant discussion, marked with its actual linked iMessage, WhatsApp or Telegram input channel, under the existing redaction, admission, session index and model limits; a retried receipt SHALL resolve to the same input. When that input's turn ends, the assistant's final text SHALL be sent to the linked conversation without any leading channel marker such as `[iMessage]`, which the send path SHALL drop whatever the model wrote (#410), and a turn that fails or yields no text SHALL send a fixed fallback pointing to the web.

#### Scenario: Private question
- **WHEN** the linked host names a request and asks a question in text
- **THEN** the question continues the account discussion without creating or selecting a per-request host session, and the answer arrives on the input channel

#### Scenario: Reply copies the marker
- **WHEN** the assistant's final text for a linked host's message starts with `[iMessage] ` or `[Telegram] `, once or more
- **THEN** the message sent to the linked conversation starts after the markers

### Requirement: Setup over iMessage
A linked host SHALL be able to continue setup in the account assistant discussion, with or without `setup` and answer setup questions in plain text that update the same account setup draft. Sign-in, Google consent and protected fields SHALL stay browser steps; Thyme SHALL send a link for connecting Google Calendar that returns the host to the conversation. Linking SHALL send a welcome by where the host stands: a ready host is told what Thyme can do, a host without a usable Calendar gets the Calendar link, and any other host gets the first setup question. Initial settings SHALL be saved only through confirmation of the current settings review, using the existing command or natural-language tool under the same checks as web confirmation. Ready-host settings changes SHALL retain the existing save semantics.

#### Scenario: Welcome into setup
- **WHEN** a host who is not ready links a sender, after either entry
- **THEN** the welcome asks for Calendar or the first setup question, and a plain reply joins the shared setup discussion without `setup`

#### Scenario: Back from Google
- **WHEN** a linked host signs in with Google from Thyme's Calendar link
- **THEN** one message is queued to the linked conversation even if the sign-in is replayed, it does not claim Calendar was granted, and the browser returns to `/app`, which says Google Calendar is connected when the grant can use it

#### Scenario: Stale settings review
- **WHEN** the host sends `confirm <ref>` after the draft changed
- **THEN** nothing is saved and the reply names the current review's reference

## REMOVED Requirements

### Requirement: Switching the conversation in words
**Reason**: One account conversation replaces setup/request runtime selection in all linked host messengers.
**Migration**: Resolve request refs inside the account session; remove `switch_conversation` and `selected_request_id` routing. Existing request-selection words read the named request without switching runtimes; ambiguous refs receive one clarification.

## ADDED Requirements

### Requirement: Ref-addressed account actions
At every point in the account conversation, the assistant SHALL read any owned received request by ref and offer the same host operations: propose/share/dismiss changes, ask its guest, and handle supported exceptions. Settings, setup and request actions SHALL reuse existing domain rules, explicit-intent checks and authorization. A request-specific action SHALL NOT change global settings or bypass feasibility, version, revision or booking guards.

#### Scenario: Read another request
- **WHEN** the host asks about received request B while discussing request A
- **THEN** B's host-projected details are returned by ref without moving the conversation

#### Scenario: Changes and guest question
- **WHEN** the host asks to propose and share changes or ask the guest of an owned request
- **THEN** each action uses that ref and its existing consent/version guards without a per-request host session

#### Scenario: Exceptions stay bounded
- **WHEN** the host explicitly allows a supported exception for one request
- **THEN** only that request's existing exception command runs; general policy and other requests are unchanged

### Requirement: Batch account decisions
One decision call SHALL accept several approve, decline or cancel items addressed by ref and return a result for each. Each item SHALL independently enforce ownership, explicit intent, current version/revision, idempotency and existing command guards. An ambiguous, inaccessible, stale or failed item SHALL NOT prevent clear valid siblings from completing. The reply SHALL distinguish approval from confirmed booking and ask only about the unclear item.

#### Scenario: Approve and decline together
- **WHEN** the host says "approve Eunwoo's and decline Dohyeon's" and both names identify one actionable request each
- **THEN** one call applies both decisions with per-item results and no repeated question for a completed decision

#### Scenario: Ambiguous beside clear
- **WHEN** Eunwoo resolves uniquely but two requests match Dohyeon
- **THEN** Eunwoo's decision completes and only Dohyeon's target is clarified

#### Scenario: One proposal changed
- **WHEN** one batch item has a stale proposal version while another is current
- **THEN** the stale item changes nothing and returns its stale result while the current item executes normally

#### Scenario: Replay and cancellation
- **WHEN** a batch containing an authorized cancellation is retried after its command committed
- **THEN** the saved per-item outcome is returned without repeating cancellation or any completed sibling action

### Requirement: Notices do not change account focus
Request summaries and weekly-limit-hold notices SHALL retain their existing event/version and delivery checks, but SHALL NOT select a request, change the account session or replace the assistant's latest pending question. An unqualified "yes" SHALL answer only that pending question's still-valid target; an absent, stale or unclear target SHALL produce a single clarification without a decision.

#### Scenario: Notice arrives while a question is pending
- **WHEN** the assistant has asked about request A and a notice for request B arrives before the host answers "yes"
- **THEN** B is not decided, routing stays in the account session, and only A's still-valid pending question is answered

#### Scenario: Unsolicited summary with no pending question
- **WHEN** a summary arrives with no pending assistant question and the host writes "yes"
- **THEN** nothing is decided until the assistant clarifies the intended request and action
