# chat-workspaces Specification

## Purpose
Provide a conversation-first workspace that keeps scheduling progress and decisions reviewable in context while preserving accessible structured controls for recovery and precise edits.

## Requirements

### Requirement: Conversation-first entry
The website SHALL open incomplete host setup and request management on the relevant conversation, with the current next action and a message composer available without navigating through structured forms. A ready host who opens `/app` without a specific request or workspace view SHALL see the calendar Dashboard. Navigation SHALL remain available through a compact, keyboard-operable control. Structured controls SHALL remain reachable from a secondary, clearly labeled surface. A protected request opened without valid authority SHALL show only the generic unavailable view with the link resend control that the meeting-request contract requires.

#### Scenario: Resume host setup
- **WHEN** an active host returns to incomplete setup
- **THEN** the current conversation, server-derived progress, and next action appear first, the composer remains reachable in the initial phone viewport, and manual settings remain accessible

#### Scenario: Return after setup
- **WHEN** a ready host signs in and opens `/app` without a request or a workspace view
- **THEN** the calendar Dashboard appears, with the existing Settings dialog and workspace menu reachable

#### Scenario: Resume request
- **WHEN** a requester or host opens an active meeting request
- **THEN** the permitted conversation and current request status appear first, with structured editing in a secondary surface

#### Scenario: Browse host requests
- **WHEN** a host opens the meeting inbox
- **THEN** request conversations appear as selectable artifacts in the conversation workspace without a permanent sidebar

#### Scenario: Switch host discussion visibility
- **WHEN** a host reviews a request
- **THEN** only the host-private discussion is shown, with no switch to the requester's conversation, and the private discussion is never exposed to a requester

#### Scenario: Use compact navigation
- **WHEN** a host opens the workspace menu by pointer or keyboard
- **THEN** dashboard, setup, inbox, and sign-out actions are available for a ready host, the menu closes with Escape, and focus returns to its trigger

#### Scenario: Request link without authority
- **WHEN** a browser opens a protected request without its continuation credential, or with an unknown, malformed or expired one
- **THEN** no request details or chat appear, and the page directs the requester to use their private request link and offers only the generic **Resend my booking link** control, with no credential-paste field and no other recovery control

### Requirement: Contextual artifacts and actions
The website SHALL present draft changes, calendar choices, candidate times, current proposals, and decision status as reviewable artifacts in the relevant conversation. For guests, every card SHALL appear inside the conversation thread at the point it is needed and remain in its history, and no form or card SHALL sit outside the thread. Available actions SHALL be labeled, keyboard-operable buttons adjacent to the artifact and SHALL invoke the authorized commands with current revisions.

#### Scenario: Review a candidate
- **WHEN** a requester receives feasible candidate times
- **THEN** the times appear in a conversation artifact with a select action and enough date, time, timezone, and duration detail to identify the choice

#### Scenario: Confirm a proposal
- **WHEN** the exact current proposal awaits requester agreement or host approval
- **THEN** the appropriate audience sees its own explicit decision button beside that proposal, and no message text alone records the decision

#### Scenario: Stale artifact
- **WHEN** a decision artifact refers to a superseded revision
- **THEN** the action is unavailable or rejected, the current artifact is shown, and no stale decision is saved

#### Scenario: Guest identity in the thread
- **WHEN** the assistant needs the guest's name and email
- **THEN** the identity card appears in the thread after that assistant message, and no identity form is shown elsewhere on the page

### Requirement: Equivalent safe recovery
The conversation and secondary controls SHALL report the same authoritative server outcome. Moving controls SHALL not weaken admission, consent, privacy, or approval checks, and a failed chat or model interpretation SHALL leave structured recovery available.

#### Scenario: Model unavailable
- **WHEN** interpretation fails while a user describes a setting or request detail
- **THEN** unsent text or a retry path remains visible, saved state is unchanged, and the user can open structured controls

#### Scenario: Narrow viewport and keyboard
- **WHEN** the workspace is used at phone width or by keyboard
- **THEN** the conversation, artifacts, action buttons, and secondary controls remain reachable with readable labels and visible status

### Requirement: Bounded conversation admission
The service SHALL admit at most 20 new messages per minute and 100 per hour per host account or requester request, and 200 per minute and 2,000 per hour service-wide. Independent fixed windows SHALL start at the first accepted message after expiry. Budgets SHALL be shared across scopes and channels. Admission and charging SHALL commit atomically; accepted exact retries SHALL not charge again.

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
The host workspace SHALL offer Google sign-in through Supabase Auth and SHALL NOT offer email/password, email OTP or magic-link login in the MVP. The application SHALL initiate one Google OAuth consent that requests identity together with the Calendar scopes needed to read selected calendars and create events, with browser-bound PKCE, offline access and a `/auth/callback` return to `/app`, and SHALL record the scopes Google actually granted and the refresh token server-side at sign-in. The only other returns SHALL be to a live, undecided agent consent transaction at `/connect/consent`, to a live host chat-link page at `/connect/link/{token}`, or to `/app` after a sign-in started from the iMessage start; sign-in records the return in an HTTP-only cookie after checking the transaction or link, and the callback checks it again. A query parameter or other caller-supplied value SHALL NOT choose any other destination. The deployed Auth configuration SHALL disable email login. First-time Google sign-in SHALL create an active host account whether or not the Calendar scopes were granted. Calendar permission SHALL exist only for granted scopes; login SHALL NOT grant requester authority, and requester contact email fields SHALL remain available.

#### Scenario: First Google sign-in
- **WHEN** a user completes Google sign-in for the first time
- **THEN** the service creates an active host account and the workspace opens the setup conversation with the Calendar access granted on that screen

#### Scenario: Calendar scopes unchecked at sign-in
- **WHEN** the user completes Google sign-in but unchecks the Calendar scopes on the consent screen
- **THEN** the active host account is still created and setup offers **Connect Google Calendar** before calendar analysis or booking-destination selection, without blocking unrelated settings

#### Scenario: Invalid or cancelled return
- **WHEN** Google login is cancelled, the code is replayed or the callback arrives in another browser
- **THEN** no new authorized host session is established and the user can restart Google sign-in at `/app`

#### Scenario: Former email login request
- **WHEN** a client submits an email address to the sign-in endpoint
- **THEN** the request is rejected without sending an authentication email

#### Scenario: Sign-in from agent consent
- **WHEN** a signed-out host starts sign-in from the consent page of a live transaction
- **THEN** the callback returns to that consent page instead of `/app`

#### Scenario: Return to a stale transaction
- **WHEN** the recorded transaction expired or was decided before the callback
- **THEN** the callback returns to `/app`

### Requirement: Single host workspace
Host sign-in, setup, request selection, review and settings SHALL remain inside `/app` as authorized states, cards or dialogs. Browser authentication and consent SHALL return to that workspace with the permitted context restored. The wordmark on every signed-in host page SHALL link to `/app`. While the workspace reads the host's session, it SHALL show the workspace background with a loading status, not the sign-in layout. A return from Google consent begun at Thyme's Calendar link SHALL say that Google Calendar is connected only when the grant can use Calendar.

#### Scenario: Return from calendar consent
- **WHEN** an active host completes valid browser consent
- **THEN** `/app` restores the authorized draft and server-confirmed next action without a separate setup page

#### Scenario: Return from Thyme's Calendar link
- **WHEN** a linked host who is not ready grants Calendar on the consent opened from Thyme's Calendar link
- **THEN** `/app` says that Google Calendar is connected and that setup continues in the linked app, with its open action, instead of the link confirmation

#### Scenario: Wordmark opens the workspace
- **WHEN** a signed-in host selects the Find Me a Time wordmark on the Dashboard, the requests, the setup conversation, the notes page, the link step or the suspended-account page
- **THEN** the workspace at `/app` opens

#### Scenario: Workspace loading
- **WHEN** a host opens `/app` or `/app/notes` and the server has not yet read the session
- **THEN** the page shows the workspace background with a loading status announced to screen readers, and no sign-in layout

### Requirement: Stable protected requester destination
Public `/{handle}` intake SHALL continue at `/booking/[bookingId]` after request creation. The route identifier SHALL be the random booking link defined in the [meeting-request contract](../meeting-requests/spec.md), which is the requester's only credential; it SHALL NOT imply a confirmed event. Closed access SHALL obey the booking link lifetime and minimal receipt limits.

#### Scenario: Calendar description carries no booking link
- **WHEN** a confirmed event's description is shared with attendees
- **THEN** it contains the meeting details and join link but not the booking link, so attendees gain no access to the request conversation

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

### Requirement: Host calendar Dashboard
The Dashboard SHALL show confirmed Find Me a Time bookings received by the signed-in account, timed requests the account sent as a verified guest, and events from selected Google calendars in the account's saved timezone. The sources SHALL have distinct colors and text labels. A confirmed booking also present in Google Calendar SHALL appear only once. The Dashboard SHALL provide week and month views, previous and next period navigation, a return to today, source filters, and details for a selected day and event. Calendar details SHALL be available only to the authenticated account. A Google Calendar access error SHALL leave Find Me a Time bookings and sent requests visible with an explanation. Period navigation SHALL keep the date and time grid visible, showing loading feedback in the event area while the period's events are fetched; a period loaded earlier in the visit SHALL show its events at once, the adjacent periods SHALL be fetched ahead, and the events shown SHALL always be those of the selected period.

#### Scenario: Compare sources
- **WHEN** a host opens a week containing a Google event and a confirmed Find Me a Time booking
- **THEN** both appear with distinct colors and labels, and selecting either reveals its time and available location

#### Scenario: Booking also appears in Google Calendar
- **WHEN** a confirmed booking's event is returned from a selected Google calendar
- **THEN** the Dashboard shows one Find Me a Time meeting for it, not a second Google event

#### Scenario: Google Calendar access fails
- **WHEN** Google Calendar cannot be read for the host
- **THEN** confirmed Find Me a Time bookings remain visible and a status message explains the Google Calendar problem

#### Scenario: Changing weeks
- **WHEN** the host moves to the next week and back in the Week view
- **THEN** the grid stays visible throughout, the next week's events usually show without waiting, and the week returned to shows its events at once

#### Scenario: Answers arrive out of order
- **WHEN** the host moves through several weeks quickly and an earlier week's answer arrives last
- **THEN** the Dashboard shows the selected week's events, not the earlier week's

#### Scenario: Sent booking and Google invitation
- **WHEN** a signed-in account has a confirmed booking made as a guest and Google Calendar returns its invitation
- **THEN** the Dashboard shows one labeled sent meeting at its confirmed time, not a second Google event

#### Scenario: Sent request waiting for approval
- **WHEN** a matched guest request has an agreed proposal awaiting approval
- **THEN** the Dashboard shows its proposed time and **Awaiting approval**, without calling it booked

#### Scenario: Guest without a verified account match
- **WHEN** a guest neither signs in with Google for a request nor has an existing signed-in account session
- **THEN** that request is absent from the account's sent view

### Requirement: Guided host setup in the linked chat
Host setup in a linked iMessage, WhatsApp or Telegram conversation SHALL show its progress: the first setup message SHALL say in one line what setup covers and roughly how long it takes; each step's question SHALL start with a line naming the step and where it stands among the four steps, Calendar, Meeting hours, Where you meet and Open times; and the first successful save SHALL say plainly that setup is done, with the booking link. The web setup SHALL use the same step names for the same steps. When the service saves the primary calendar as the default calendar roles, its message SHALL name the other calendars it would recommend checking for conflicts and ask once whether they should count too; without an answer, the primary calendar SHALL remain the only conflict calendar. Each message SHALL ask at most one question.

#### Scenario: Progress through setup
- **WHEN** a host who linked their chat goes through setup
- **THEN** the first message says what setup covers and how long it takes
- **AND** the calendar, hours, place and open-times questions start with "1/4 · Calendar", "2/4 · Meeting hours", "3/4 · Where you meet" and "4/4 · Open times"
- **AND** the first save replies that setup is done, with the booking link

#### Scenario: Other calendars are offered once
- **WHEN** the service saves the primary calendar as the default and Google lists a work calendar the host can read
- **THEN** the message names the work calendar and asks whether it should also be checked for busy times
- **AND** a later message about the saved roles does not ask again

#### Scenario: No answer keeps the primary
- **WHEN** the host does not answer the other-calendars question
- **THEN** the primary calendar stays the only calendar checked for conflicts and setup continues

#### Scenario: The host adds a calendar
- **WHEN** the host answers yes or names one of the listed calendars
- **THEN** the named calendars are added to the conflict calendars through the same calendar role checks as the web

#### Scenario: Changing weeks
- **WHEN** the host moves to the next week and back in the Week view
- **THEN** the grid stays visible throughout, the next week's events usually show without waiting, and the week returned to shows its events at once

#### Scenario: Answers arrive out of order
- **WHEN** the host moves through several weeks quickly and an earlier week's answer arrives last
- **THEN** the Dashboard shows the selected week's events, not the earlier week's

### Requirement: Pending decisions on the workspace menu
Where the workspace menu offers the host's Requests, the menu button and its Requests item SHALL show the number of received requests that need the host's decision (awaiting approval, holding a suggestion the host has not settled, held by the weekly limit, or with every candidate needing the host), as a round count with an accessible text equivalent that shows 9+ above nine. The count SHALL exclude sample requests, SHALL be refreshed when the page regains focus, when the menu opens and whenever the Requests view in the same tab reloads its requests, and SHALL disappear when no request needs a decision. A failed read SHALL keep the last count without an error.

#### Scenario: A request awaits approval
- **WHEN** a ready host with one received request awaiting approval opens `/app`
- **THEN** the menu button shows a count of 1, its accessible name says one request needs a decision, and the Requests item in the open menu shows the same count

#### Scenario: Last decision made
- **WHEN** the host approves or declines the only request that needed a decision
- **THEN** the count disappears from the menu button and the Requests item

#### Scenario: Only a sample request
- **WHEN** the host's only received request is the tutorial sample
- **THEN** no count appears

### Requirement: Booked meeting details on the Dashboard
Selecting a confirmed Find Me a Time meeting on the Dashboard SHALL show its time, length, mode, place for an in-person meeting or meeting link for an online one, and the guest's name with their email, marked when the address is not confirmed, and the purpose when it differs from the title, together with an **Open request** action that opens that request in the host's Requests view. The meeting link SHALL be the join link Google returned for the event, or the requester's own link. An online meeting with no link SHALL say the link is not set. A week block for the meeting SHALL show who it is with: next to its time in a short block, under the title in a longer one.

#### Scenario: Online meeting with Google Meet
- **WHEN** the host selects a booked online meeting whose event has a Meet link
- **THEN** the details show When, Length, Mode **Online**, the Meet link and With {guest name <email>}, and **Open request** opens that request

#### Scenario: In-person meeting
- **WHEN** the host selects a booked in-person meeting
- **THEN** the details show its place and no meeting link

#### Scenario: Short meeting in the week view
- **WHEN** a 30-minute booked meeting is drawn in the week grid
- **THEN** its block shows the time and the guest's name on one line

### Requirement: Received requests awaiting a decision on the Dashboard
The Dashboard SHALL show each received request that needs the host's decision (awaiting approval, or with a pending suggestion), except sample requests, at the time of its current proposal when that time falls in the period shown. It SHALL have its own color, text label and source filter, distinct from Google events, Find Me a Time meetings and sent requests, and SHALL never be shown as booked. Selecting it SHALL show the proposed time, the requester and the purpose, say that it is not booked until the host approves it, and offer **Open request**, which opens that request in the host's Requests view. A received request without a proposal SHALL not appear on the calendar.

#### Scenario: A request awaits approval this week
- **WHEN** a host opens a week in which a received request awaiting approval proposes Wednesday 14:00
- **THEN** the Dashboard shows a "From {requester} · To decide" block at Wednesday 14:00, and selecting it shows Proposed time, From and Purpose, a note that it is not booked until approved, and **Open request**

#### Scenario: Filter requests to decide
- **WHEN** the host turns off **Requests to decide**
- **THEN** received requests are hidden and Google events, Find Me a Time meetings and sent requests stay

#### Scenario: Request decided or only a sample
- **WHEN** the request is booked, declined or closed, or the only request is the tutorial sample
- **THEN** no received-request block appears for it; a booked request appears as a Find Me a Time meeting

### Requirement: Notify a host when the weekly limit holds a requester
When a requester evaluation finds feasible candidates but offers none because every candidate falls in a full week under the host's current weekly limit, the service SHALL send the host a notice on the host's active linked conversation. The notice SHALL explain that the guest cannot choose a time, ask whether the host wants to adjust the weekly limit, and link directly to that setting. It SHALL be suppressed when the request or settings revision changes before delivery and deduplicated for the same revisions.

#### Scenario: Weekly limit holds every feasible time
- **WHEN** a current requester evaluation holds all otherwise feasible candidates because of the weekly limit
- **THEN** the host receives one revision-scoped notice with a direct link to edit the limit

#### Scenario: Request or settings changed before delivery
- **WHEN** the queued weekly-limit notice is processed after its request or settings revision changed, or the hold no longer applies
- **THEN** the notice is suppressed

### Requirement: Host request inbox
`/app` SHALL offer a request inbox from the workspace menu that lists the host's requests, except drafts, as selectable cards with requester, purpose, status and whether a decision is needed. A selected request SHALL open on the host-private discussion with the assistant and its decision cards: the proposal review, any suggested shared changes, the rule and travel review and the booking status. The host SHALL NOT be shown the requester's conversation with the assistant; the request's details, current proposal, agreement and status SHALL come from the host projection. Selection SHALL be addressable as `/app?request={requestId}`.

#### Scenario: Host opens a request from the inbox
- **WHEN** a host selects a request awaiting approval
- **THEN** the private discussion and the proposal review card with **Approve this proposal**, **Request changes** and **Decline** appear, and the URL names the request

#### Scenario: Requester conversation stays with the requester
- **WHEN** a host opens a request whose requester has written to the assistant
- **THEN** the view offers no tab, link or route to that conversation, and the requester's messages are not shown

#### Scenario: Another host's request
- **WHEN** a host opens `/app?request=` with a request that belongs to another host
- **THEN** the inbox opens with no request selected and nothing about that request is shown

### Requirement: Connected apps manages host calendars
The host's **Connected apps** dialog SHALL show the connected Google account and let the host change the calendars checked for conflicts and the destination used for new bookings. It SHALL let the host disconnect the saved Google Calendar grant. Disconnecting SHALL remove the app's saved grant and calendar selections, pause readiness for new requests until setup is completed again, and SHALL NOT delete existing calendar events or bookings.

#### Scenario: Change calendar roles
- **WHEN** the host selects different conflict calendars or a different writable booking calendar and saves
- **THEN** the new choices are saved through setup's calendar-role command

#### Scenario: Disconnect Google Calendar
- **WHEN** the host confirms disconnecting
- **THEN** the saved grant and calendar selections are removed, existing events and bookings remain, and new requests are unavailable until reconnection and setup

### Requirement: Account request inbox
The Requests view SHALL combine requests received by the signed-in account with requests it sent as a guest whose verified Google subject or existing signed-in account session matched that active account, whether or not host settings were completed. A typed contact email alone SHALL NOT link a request. Each card SHALL show the other party, purpose when available, state, proposed time when available, and a direction tag reading **Received request** or **Sent request**. All, Received and Sent filters SHALL narrow the list. Received requests requiring action SHALL say **Needs your decision** in red, and a sent request awaiting the other party's approval SHALL say **Awaiting host approval**. Direction SHALL be conveyed by text as well as color.

#### Scenario: Both directions
- **WHEN** a signed-in account has one received and one matched sent request
- **THEN** both appear in All, and each appears only in its matching filter

#### Scenario: Signed-in guest continues without Google
- **WHEN** an already signed-in account identifies a guest request manually
- **THEN** the request is linked to that account after identification succeeds, without using the typed contact email as proof

#### Scenario: Open a sent request
- **WHEN** the account selects an open sent request with a valid private link
- **THEN** the existing guest workspace opens under that link, with its existing requester permissions; a closed sent request shows its conversation read only in the list instead ([guest-account-history](../guest-account-history/spec.md))

#### Scenario: Expired private link
- **WHEN** the sent request's private link has expired
- **THEN** the summary remains visible but no link or request credential is exposed

#### Scenario: Closed request history
- **WHEN** a matched request closes
- **THEN** its host-profile settings choice is cleared and the account still sees the sent request summary

### Requirement: Host calendar beside a decision
While a received request in the host's Requests view shows a proposal, a suggestion, the offered times of a private search or the **Request changes** editor, the view SHALL show the host's own calendar for that week beside the decision card on a wide screen and with it on a narrow one, as one day with a day switcher on a phone. The calendar SHALL show the events the Dashboard shows for that week, with the proposed time, a suggestion and the time being edited marked over them in text as well as colour, and SHALL move to a new proposed or edited time. Choosing an offered time or an empty time on the calendar SHALL open **Request changes** with that time filled in and SHALL share nothing until the host shares the suggestion. The calendar SHALL NOT appear for the tutorial sample or a closed request, and a failed calendar read SHALL keep the marked times with an explanation.

#### Scenario: Proposal against the host's day
- **WHEN** the host opens a received request awaiting approval with a proposal at 10:00 on a day that has a Google event at 09:00
- **THEN** the host's week for that day is shown beside the decision card with the 09:00 event and the 10:00 time marked **Proposed**

#### Scenario: Suggest a time from the calendar
- **WHEN** the host clicks an empty 14:00 slot on the calendar
- **THEN** **Request changes** opens with that date and 14:00 filled in, the calendar marks it as the new time, and nothing is shared with the requester

#### Scenario: Calendar cannot be read
- **WHEN** the host's calendar cannot be loaded for the shown week
- **THEN** the marked times remain and a status line says the calendar could not be loaded

### Requirement: Host schedule image review
The host Calendar connection card SHALL offer an English action to upload a schedule image. Activating it SHALL reveal a PNG/JPEG/WebP file input, preview, reading status and detected free hours. The server SHALL authorize the host, bound and validate the image, limit model attempts and return only structured weekday/time ranges. Adding the detected hours to setup SHALL create an unaccepted draft suggestion. After Google Calendar connection, the normal weekly hours question SHALL show that suggestion with actions to accept or adjust it. The image and private extracted text SHALL not be persisted or sent to a guest or the assistant. The host SHALL still choose a writable Google Calendar destination for confirmed bookings.

#### Scenario: Recognized weekly timetable
- **WHEN** the host uploads a labeled weekly timetable and the extractor finds clear free hours
- **THEN** the hours appear as a draft suggestion and the weekly hours question asks the host to accept or correct them

#### Scenario: Unavailable reading
- **WHEN** the image is invalid, ambiguous, the provider is disabled or a budget limit is reached
- **THEN** the host can enter weekly hours through the existing setup editor and still connect Calendar for bookings
