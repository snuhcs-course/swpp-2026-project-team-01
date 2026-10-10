# Spec Delta

## Purpose

Let hosts complete and resume verified scheduling setup through website chat or a linked private iMessage conversation, using shared settings and readiness state.

## ADDED Requirements

### Requirement: Conversational website setup
The website SHALL make chat the primary host setup interface, accepting free-text preferences and providing accessible structured actions for choices, corrections, and required browser steps.

#### Scenario: Describe preferences
- **WHEN** an admitted host says they meet on weekday afternoons and need a buffer
- **THEN** the assistant extracts supported preferences, asks for unresolved times and buffer length, and shows a draft without claiming those settings are saved

#### Scenario: Accessible pending and failure states
- **WHEN** a host sends a message by keyboard on desktop or mobile
- **THEN** the interface exposes pending, success, or recoverable failure status, preserves unsent text on failure, and permits reading earlier messages without forced scrolling

### Requirement: Shared resumable setup
The service SHALL persist a host-owned setup conversation and versioned draft, and SHALL resume current progress across reloads, browser consent, and linked iMessage without repeating completed steps or exposing another host's conversation.

#### Scenario: Switch channels
- **WHEN** a verified linked host describes preferences in iMessage and later opens website setup
- **THEN** both surfaces show the same current draft and remaining setup actions

#### Scenario: Cross-account access
- **WHEN** another account requests a conversation identifier owned by a different host
- **THEN** neither transcript nor settings are disclosed or modified

### Requirement: Confirmed settings changes
Extracted preferences SHALL remain a draft until the host explicitly confirms a concrete current summary. Unsupported or ambiguous preferences SHALL trigger clarification. Stale confirmations SHALL not overwrite newer settings.

#### Scenario: Confirm current draft
- **WHEN** a host confirms a displayed summary with a unique handle, timezone, and valid scheduling rules
- **THEN** the existing setup guards validate and persist those exact settings and the conversation reports the server result

#### Scenario: Concurrent correction
- **WHEN** the host revises settings in one channel before confirming an older summary in another
- **THEN** the service rejects the stale confirmation and presents the current summary

#### Scenario: Model unavailable
- **WHEN** natural-language extraction fails or returns invalid data
- **THEN** confirmed settings remain unchanged and the host can retry or use structured setup controls

### Requirement: Explicit private-channel setup confirmation
An admitted host with a current private iMessage link SHALL be able to request an application-authored setup review and explicitly confirm that exact review without returning to the browser for the settings confirmation itself. Google consent, calendar selection and account admission SHALL retain their protected browser boundaries. The service SHALL validate all existing setup prerequisites and fresh selected-calendar permissions before saving.

#### Scenario: Review and confirm current settings
- **WHEN** a linked host sends `review setup` with a complete current draft and subsequently sends `confirm setup <review-reference>` for the delivered review
- **THEN** the application presents every setting and the review expiry, binds the reference to the host, link, receiver, conversation, draft/review/rules revisions and Calendar generation, and saves those exact settings after current permission checks without invoking the model

#### Scenario: Incomplete or oversized review
- **WHEN** settings are incomplete, required explicit answers are missing, or a full review cannot fit the supported private-message length
- **THEN** the service issues no confirmable partial summary, explains the remaining action or protected browser continuation, and preserves confirmed settings

#### Scenario: Stale or foreign confirmation
- **WHEN** the draft, confirmed rules, calendar selection, grant generation, link or receiver changes, the review expires, or another private route presents the reference
- **THEN** confirmation cannot save settings or obtain authority from the old reference and the host must request a current review

#### Scenario: Delivery uncertainty and retries
- **WHEN** review delivery lacks validated acceptance evidence or a confirmation is replayed after its committed response is lost
- **THEN** unverified delivery cannot authorize confirmation, while an exact authorized replay returns the saved result without another save, model call, provider permission read or booking effect

#### Scenario: Ordinary assistant input is not confirmation
- **WHEN** a model emits confirmation text, calls a setup tool with confirmation fields, or the host sends bare assent without a current review reference
- **THEN** the application does not interpret that text or tool call as permission to save settings

### Requirement: Verified browser handoffs
Setup chat SHALL direct hosts to verified browser steps for sign-in, invitation redemption, and Google authorization. It SHALL resume from validated server state after completion and SHALL not collect provider credentials or treat a chat message as consent.

#### Scenario: Unlinked iMessage entry
- **WHEN** an unknown sender requests host setup in a private iMessage conversation
- **THEN** the response provides a bounded verification continuation without revealing host records, admitting the sender, or connecting a calendar

#### Scenario: Denied or interrupted consent
- **WHEN** a host denies or interrupts Google consent
- **THEN** setup retains its draft and offers a safe resume action without claiming Calendar access

#### Scenario: Calendar selection
- **WHEN** consent succeeds and the host chooses conflict calendars and a booking calendar through the conversation
- **THEN** the server verifies actual calendar identifiers and current write permissions before saving the selection

### Requirement: Verified private iMessage identity
The service SHALL bind a private iMessage identity to an authenticated admitted host only after fresh proof of control of both sides. Group messages, forwarded challenges, expired challenges, and mismatched senders SHALL not authorize linking or setup access. Unlinking SHALL revoke subsequent channel authority.

#### Scenario: Inline website linking
- **WHEN** an admitted host chooses Connect iMessage during `/app` onboarding
- **THEN** the conversation renders inline phone entry and Send code, followed by a protected code input and Confirm and link, and shows connected only after server verification, without a separate page or settings dialog

#### Scenario: Safe inline verification and recovery
- **WHEN** the host enters a verification code, reloads, changes the phone number, encounters expiry/delivery failure or chooses Maybe later
- **THEN** typed endpoints process verification outside the chat/model path, no code is stored in transcript, analytics or persisted card state, and inline recovery or continued web onboarding remains available without claiming a connection; change-number invalidates the old challenge

#### Scenario: Successful link
- **WHEN** an admitted signed-in host receives a six-digit code in the chosen private iMessage conversation and enters it in the same browser that requested the code
- **THEN** future authenticated provider messages from that linked identity can access only that host's setup conversation

#### Scenario: Code delivery and guessing
- **WHEN** the host requests a link code or enters a wrong, expired, or previously used code
- **THEN** the browser never receives the code itself, the message is dispatched only to the chosen private identity through a durable intent, and bounded failed attempts cannot establish a link

#### Scenario: iMessage-first continuation
- **WHEN** an unlinked private sender starts a conversation before opening the website
- **THEN** the browser continuation remains bound to that sender and requires a fresh private challenge and authenticated browser confirmation

#### Scenario: Replayed or transferred challenge
- **WHEN** a consumed challenge is replayed or its private-conversation binding differs from the sender completing it
- **THEN** no new or replacement account link is created

#### Scenario: Unlinked queued message
- **WHEN** a previously linked identity is unlinked before a queued message is processed
- **THEN** the message cannot read private setup or mutate that host's settings

### Requirement: Reliable channel processing
The service SHALL process each inbound provider message once logically, preserve per-conversation order, recheck authority before mutation and outbound dispatch, and distinguish accepted, delivered, failed, and uncertain outbound states without blind resends.

#### Scenario: Duplicate inbound delivery
- **WHEN** Photon replays a message after a channel runtime restart
- **THEN** the saved operation result is reused without a second settings mutation or duplicate reply job

#### Scenario: Lost send response
- **WHEN** a reply dispatch loses its acknowledgement
- **THEN** its status remains uncertain until reconciled and no new message identifier is generated to resend it automatically

### Requirement: Honest completion and separate booking authority
Setup SHALL report readiness and share a booking link only when current admission, confirmed rules, timezone, handle, and writable calendar checks pass. Setup confirmation SHALL never authorize meeting approval or Calendar event creation.

#### Scenario: Ready host
- **WHEN** all existing setup readiness checks pass after the host confirms settings and calendar selections
- **THEN** either channel reports completion and provides the same public booking URL

#### Scenario: Missing permission or unrelated instruction
- **WHEN** calendar permission is missing or chat asks to bypass admission or book an event during setup
- **THEN** setup reports the relevant next action without bypassing guards or creating an event

### Requirement: Guided onboarding action cards
The website SHALL guide admitted hosts inside `/app` through Google connection, calendar choices, optional analysis, suggestion review and explicit settings confirmation with accessible in-chat actions. It SHALL show one primary next action, compact progress and editable completed steps without requiring separate setup pages or a long form.

#### Scenario: Guided connection and return
- **WHEN** a host chooses Connect Google Calendar and completes browser consent
- **THEN** verified server state resumes the same conversation with actual calendar cards, readable account/access labels, explained recommendations and editable selections, rather than claiming settings are already saved

#### Scenario: Mobile and keyboard review
- **WHEN** a host reviews calendars, weekly windows and location cards on a narrow screen, with a keyboard or with reduced motion enabled
- **THEN** controls and the composer remain reachable, selection is not conveyed by color alone, the weekly view has a text equivalent, and focus/progress survives edits, reload and consent return

### Requirement: Calendar-informed setup suggestions
After verified host consent, the service SHALL recommend calendar roles from authorized metadata and stated intent, and SHALL let the host select calendars for a disclosed bounded analysis before reading their events. It SHALL use selected calendar evidence to suggest meeting windows and, where supported, location/mode preferences with reasons and uncertainty. Suggestions SHALL remain editable private drafts until explicit current-review confirmation.

#### Scenario: Useful calendar patterns
- **WHEN** a host analyzes selected calendars containing recurring commitments, free intervals and usable location information
- **THEN** the assistant presents suggested meeting windows and candidate location/mode preferences, identifies the analysis scope/timezone and evidence limits, and offers use, edit, dismiss or manual choices without claiming that observed gaps or repeated places are the host's preferences

#### Scenario: Calendar permissions and distinct roles
- **WHEN** available calendars include duplicate names or a read-only shared calendar
- **THEN** selection uses actual authorized IDs with distinguishing labels, conflict-check recommendations remain separate from the writable booking destination, and no unselected calendar is scanned or silently activated

#### Scenario: Sparse or failed evidence
- **WHEN** selected calendars contain little history, missing/ambiguous locations, partial results or a failed/revoked read
- **THEN** the assistant explains the limitation, asks for missing preferences and offers retry or manual setup without interpreting failure as free time, inventing venues or overwriting confirmed settings

#### Scenario: Private and untrusted source data
- **WHEN** calendar events contain private titles, attendees, addresses or instructions addressed to an agent
- **THEN** only necessary derived summaries enter model context, source text cannot issue instructions, candidate locations remain host-private, and no observed address is labeled home/work or published as a meeting preference without the host's explicit choice

#### Scenario: Changed sources and confirmation
- **WHEN** calendar selection, permission, refreshed analysis or a setup revision changes before an old scan result or settings review is applied
- **THEN** dependent results/reviews are invalidated and current authorization is checked; neither an old suggestion nor an earlier use action saves settings, approves a meeting or creates an event

### Requirement: Agent-led onboarding with suggestions first
The agent SHALL guide every onboarding stage and recovery using authorized server state, including access, admission, Google consent, calendar selection, preference review, inline iMessage linking or skip, and completion. It SHALL propose missing preferences before asking for manual input, prioritizing explicit choices and confirmed settings, then authorized evidence, then clearly labeled starter defaults. It SHALL ask one focused question when a required detail cannot be safely suggested or a conflict remains, and SHALL require current explicit confirmation before saving settings.

#### Scenario: Start without preferences
- **WHEN** an admitted host begins setup without describing their scheduling preferences
- **THEN** the agent guides connection and analysis, proposes supported calendar roles, timezone, windows, duration, buffers and mode/location choices with editable actions, and distinguishes evidence-based suggestions from starter defaults rather than presenting an empty questionnaire

#### Scenario: Sparse context and correction
- **WHEN** evidence is sparse or the host corrects or dismisses a suggestion
- **THEN** the agent labels defaults honestly, prioritizes the correction in the draft, preserves confirmed settings until explicit save, and asks only the next unresolved question without repeatedly presenting the dismissed guess absent new evidence or a user request

#### Scenario: Browser return and channel handoff
- **WHEN** the host returns from sign-in or Google consent, resumes on a verified linked channel, or encounters an onboarding failure
- **THEN** the agent reads authorized current progress and presents the next permitted action or recovery without repeating completed questions, exposing private state before admission, or guessing identity, consent, verification codes, exact addresses or approval

### Requirement: Explicit host location preference
During onboarding the agent SHALL explicitly ask whether the host prefers online, in-person or either, unless an explicit answer is already available. For in-person/either it SHALL ask for preferred areas/venues or an explicit per-meeting decision. Suggestions MAY accompany the question but SHALL not count as the host's answer. Final settings confirmation SHALL require the applicable explicit preference answer; online-only SHALL not require a physical venue.

#### Scenario: Suggested venue still requires an answer
- **WHEN** calendar analysis suggests a meeting mode or frequent venue and the host has not stated a preference
- **THEN** the agent asks the mode/location question with editable choices and cannot complete final settings confirmation using inferred or preselected answers

#### Scenario: Online-only or per-meeting location
- **WHEN** the host chooses online-only, or chooses in-person/either and Decide per meeting
- **THEN** onboarding records that explicit choice without requiring a fixed physical venue, while actual booking proposals still require their applicable location and travel checks

#### Scenario: Preference already stated
- **WHEN** the host has explicitly provided the applicable mode/location preference in the authorized conversation or confirmed settings
- **THEN** the agent includes that answer in the editable final review without asking the same question again or replacing it with a calendar inference

### Requirement: Explicit transportation and travel buffer preferences
For hosts accepting in-person meetings, onboarding SHALL ask how they usually travel and confirm an extra travel buffer separately from estimated journey duration, unless explicit answers already exist. The host SHALL choose a supported mode or an explicit per-trip policy; inferred habits or preselected defaults SHALL not count as answers. Online-only onboarding SHALL skip these questions. Final settings review SHALL include applicable transportation and buffer choices.

#### Scenario: Suggested transportation requires confirmation
- **WHEN** an in-person/either host has no explicit travel preferences
- **THEN** the agent asks for transportation mode or Depends on the trip, then offers an editable extra-buffer suggestion and records the host's explicit answers before final settings confirmation without treating calendar addresses as proof of travel habits

#### Scenario: Per-trip or unsupported routing
- **WHEN** the host chooses Depends on the trip or routing is unavailable for the chosen mode/region
- **THEN** onboarding retains the explicit policy and physical scheduling resolves each necessary leg's mode or manual allowance before offering candidates, without assuming zero travel or silently substituting another mode

#### Scenario: Online-only or existing preferences
- **WHEN** the host selects online-only meetings or has already stated their applicable mode and buffer
- **THEN** the agent skips unnecessary questions and includes applicable existing choices in the editable final review

### Requirement: Application-authored setup clarification questions
Structured setup guidance SHALL use application-authored English or Korean questions selected by bounded categories, never arbitrary model-authored clarification prose. The same current-state projection SHALL apply to web, linked private channels and external agents. Unknown stored wording SHALL remain pending as a neutral question until resolved; normalization SHALL NOT imply confirmation or booking success.

#### Scenario: False completion in model clarification
- **WHEN** model output supplies a claim that settings were saved or a booking completed as clarification text
- **THEN** typed model and agent draft inputs reject that free-form value and the shared operation never projects it as an application question, while confirmed settings and booking authority remain unchanged

#### Scenario: Legacy draft and retry
- **WHEN** a stored draft contains an unrecognized question or its original mutation is retried
- **THEN** current reads and exact retries expose a neutral pending question without another mutation, changed input under the same retry identity is rejected, and refreshing or editing the draft preserves unresolved questions until explicitly resolved

#### Scenario: Bounded localized questions
- **WHEN** a valid setup draft identifies missing preferences with English or Korean question categories
- **THEN** every authorized channel receives the corresponding fixed questions in the supplied order and browser controls can resolve one without dropping the others
