# Find Me a Time — Product Requirements Document

Status: Draft for team review\
Date: 2026-10-06\
Product: [findmeatime.com](https://findmeatime.com)\
Source of truth: [One-pager](01_one_pager.md)

This document turns the one-pager into observable product behavior and acceptance criteria. The core principles come from the one-pager; release boundaries and operational details below are proposed requirements until the team agrees to them. It records the agent access direction, while detailed architecture, schemas, and protocol contracts belong in technical design and capability specifications.

The [implementation plan](technical_specification/04_implementation_plan.md) confirms a full application-source rebuild, including the Supabase scheduling backend. Existing source, routes, schemas, tests, and deployment evidence are reference material rather than compatibility requirements. This PRD preserves the product obligations that the replacement must implement and verify afresh.

## 1. Product purpose

Find Me a Time helps hosts coordinate external one-to-one meetings. It gathers meeting details, finds feasible times, negotiates with the requester, and books only after the host explicitly approves the current proposal.

The problem is not simply finding an empty calendar slot. Hosts also consider focus time, meeting priority, location, and travel. Requesters should be able to reach an agreement without creating an account, while hosts retain control over their schedule and private information.

### Target users

| Role | Need |
|---|---|
| Host: VC investor, founder, or professor | Delegate repetitive coordination while retaining the final scheduling decision. |
| External requester | Explain the meeting, negotiate suitable options, and receive a confirmed invitation without registering. |
| Host's authenticated personal agent | Retrieve authorized request details and relay the host's explicit decision. |
| Requester's agent | Start from the host's booking link, submit a meeting request, and handle scheduling on the requester's behalf within their delegated preferences and permissions. |

MVP audience decision (2026-10-07): target iPhone/iMessage hosts. Recommend iMessage for everyday host conversation, proposal notifications and decisions. Onboarding can start in `/app` or private iMessage, with verified browser handoffs for sign-in, admission, Google consent and rich controls, then resume the same authorized conversation. Linking remains explicit and opt-in; web setup and review stay available without it. Android-specific experience and validation are deferred. This is a host audience focus, not a device-based access block on public requester links.

Internal team scheduling and group meetings are outside the product's initial scope.

## 2. Goals and success measures

The product should reduce host coordination work, help requesters complete scheduling, and preserve host control across channels. Mandatory approval is part of the experience; the product should make that decision easy to review on a phone.

| Goal | Measurement |
|---|---|
| Reduce coordination work | Host actions per booked request, separating the required final approval from clarification and negotiation actions. Compare with the host's existing process. |
| Help requesters finish | Share of valid submitted requests that reach booking; report declines, withdrawals, unresolved requests, and failures separately. |
| Shorten coordination | Median and 90th-percentile elapsed time from submission to booking, with time awaiting each party reported separately. |
| Offer feasible options | Share of offered candidates that violate known availability, duration, location, or travel constraints at evaluation time. Later calendar changes are measured separately. |
| Preserve trust | Unauthorized bookings, duplicate events for one request, and disclosures of private host information. |

Release acceptance requires zero unauthorized bookings, duplicate events, and private-information disclosures in the agreed acceptance suite. Conversion and speed targets will use post-launch measurement; numerical targets and the measurement window remain open decisions. A production pilot is not a prerequisite for the rebuild. Passing a test suite is not a guarantee of zero production incidents.

## 3. Proposed initial release scope

### Included

- One host and one external requester per meeting.
- Hosting a calendar—publishing your own booking link and receiving meeting requests—is invite-only, with a waitlist for prospective hosts. Requesters do not need an invitation to request meetings or optionally connect Google Calendar.
- Google Calendar connection, host-selected calendars for conflict checking, and a designated calendar for booking. Requesters can optionally connect their Google Calendar for availability checks without host admission or a product account.
- Host-configured availability, meeting duration, focus-time rules, preferences, meeting mode/location, and travel buffers, with map-based travel-time estimates between physical commitments.
- A booking link with conversational intake, email negotiation, and agent access to the same request lifecycle.
- Support for Dots, Muse, Instinct, ChatGPT, Codex, Claude, and Claude Code as required agent integrations, with role-appropriate access for hosts and requesters.
- Copy-and-paste agent entry points: `findmeatime.com/SKILL.md` for host onboarding and `findmeatime.com/{host}/SKILL.md` for requesting a meeting.
- Requester handoff by sharing the host's booking link with a supported agent; the agent handles intake, availability coordination, negotiation, and confirmation tracking.
- Remote MCP as the primary agent integration interface, with OAuth for protected host access, and a CLI with structured JSON output for terminal-based agents and scripts. Both use the same scheduling API and permission checks as other channels.
- A phone-friendly web experience for host review, revision, approval, and decline.
- An opt-in iMessage channel for host notifications, private discussion, revision, approval, and decline, using the selected Photon Spectrum transport. Mobile web remains available for setup and fallback review.
- Requester access without an account, with request-specific access controls.
- Explicit approval of the current proposal, revalidation before booking, and recovery from retries and uncertain booking outcomes.

### Outside the initial release

- Android-specific onboarding, notification channels and release testing. Do not add SMS, WhatsApp or host proposal-notification email as an Android substitute in the MVP. Existing Auth, admission, recovery and booking emails retain their defined purposes.
- Group scheduling, internal team coordination, round-robin assignment, and pooled host availability.
- Calendar providers other than Google Calendar.
- Automatic booking without host approval, including approval delegated to an AI's judgment.
- Moving existing calendar events to make room for a request.
- A native mobile application, payments, and general-purpose inbox or task management.
- Automated post-booking rescheduling and cancellation. Initial-release users manage an existing event through their calendar; the product must communicate this boundary.
- Guaranteed arrival times or a custom live-traffic prediction system. Map-provider travel estimates are included, with explicit host-defined buffers; missing or unsupported routes require clarification rather than assumed travel time.

Booking links, email, and agent access are all in the one-pager's intended experience. Dots, Muse, Instinct, ChatGPT, Codex, Claude, and Claude Code are required compatibility targets. If delivery is staged, the team must agree on the sequence rather than silently dropping a channel or required integration. Remote MCP and a CLI are the chosen access direction; client connection methods, protocol versions, and supported client versions still need technical design and compatibility testing. ChatGPT and Codex are separate compatibility targets, as are Claude and Claude Code; support for one client does not establish support for another. These names identify required integrations, not verified capabilities already available in each client.

## 4. Core concepts and rules

| Concept | Meaning |
|---|---|
| Booking link | The host's public Find Me a Time scheduling entry point, usable by a person or a supported requester agent. Also referred to as the host's calendar link; it does not expose the host's private calendar. |
| Skill entry document | Public instructions the personal agent reads to guide host onboarding or request a meeting with a specific host. It describes supported actions and connection steps; reading it does not grant credentials or meeting approval. |
| Request | The shared record of one scheduling attempt, its participants, conversation, candidates, and outcome. |
| Candidate | A possible meeting time that passes the known feasibility checks. Offering it does not reserve or book it. |
| Proposal | The exact meeting details submitted for agreement and host approval: participants, start/end time, timezone, mode, and location or meeting-link plan. Applicable exceptions are attached as host-only metadata; requester agreement covers the shared meeting details. |
| Proposal version | An identifiable revision of those details. Decisions refer to a specific version. |
| Hard constraint | A requirement enforced during candidate generation and booking, such as a busy calendar interval, required duration, or required travel buffer. |
| Preference | A host rule for suitability or ranking. Only the host may explicitly waive it for a request. |

The product must distinguish hard constraints from preferences when the host configures rules. If a rule's meaning is ambiguous, clarify it before using it to permit a booking. A host can edit a rule, but a rule change triggers feasibility checks and renewed approval where the approved proposal is affected.

The following rules apply to every channel:

1. Only an authenticated, explicit host decision approving the current proposal authorizes booking. Requester agreement and agent credentials alone do not authorize it.
2. A change to participants, time, duration, mode, location, or exceptions invalidates prior approval. An updated proposal requires fresh host approval and renewed requester agreement when their agreed details change.
3. Approval cannot override a conflicting calendar event or an unmet hard constraint. The host must resolve the conflict or explicitly change the applicable rule, then review a valid proposal.
4. Calendar details, host preferences, private host discussions, and private reasoning are not exposed to requesters or their agents.
5. All clients act on the same current request state. Old messages, concurrent decisions, and retries cannot revive a superseded proposal or duplicate a booking.

## 5. Main user journey

1. **Set up:** Host access is invite-only. A prospective host without access joins the waitlist; an invited host redeems access through web and continues setup. The host pastes “Let me use findmeatime.com/SKILL.md for my scheduling” into their personal agent. The agent reads the public instructions, guides required sign-in and consent, connects Google Calendar through the service, gathers and confirms minimum scheduling settings, and returns the host's booking and skill links. Website and linked private iMessage conversations are the primary direct setup surfaces: gather preferences, clarify missing values, show a concrete review and require confirmation before saving. Both resume the same host-owned draft. Invitation redemption, sign-in and Google consent remain browser actions. To use iMessage, the host proves their private sender and authenticated account, then explicitly confirms the binding; channel setup is optional and website recovery remains available. See [conversational setup](technical_specification/02_frontend_architecture.md#host-setup-conversation).
2. **Request:** A requester opens the link, emails the assistant, or hands the host's booking link to Dots, Muse, Instinct, ChatGPT, Codex, Claude, or Claude Code with the prompt “Let me schedule a meeting with findmeatime.com/dodo/SKILL.md”. Their agent starts the request from that link and supplies known details, asking the requester only for missing information or decisions outside its delegated authority.
3. **Find options:** The system checks availability and constraints. AI ranks valid candidates and explains the next step without revealing private host context.
4. **Negotiate:** The requester selects an option or supplies alternatives. When no valid option exists, the system requests more information or privately asks the host to revise a preference or decline.
5. **Review:** The host sees the current proposal, requester context, relevant private constraint information, and any proposed exceptions through mobile web, a supported personal agent, or their linked iMessage conversation. The host approves, revises, or declines; ambiguous replies prompt clarification or a link to the current web review screen.
6. **Book:** After requester agreement and current host approval, the system rechecks feasibility and creates the calendar event. It reports a booking only after the event's creation is confirmed.
7. **Recover when needed:** If a conflict appears, the proposal returns for revision. If event creation has an uncertain outcome, the product resolves that outcome before attempting another creation.

### Copy-and-paste entry experience

The primary agent experience starts with one of these prompts:

| Intent | Text to paste into a personal agent |
|---|---|
| Become a host | `Let me use findmeatime.com/SKILL.md for my scheduling` |
| Request a meeting with Dodo | `Let me schedule a meeting with findmeatime.com/dodo/SKILL.md` |

These are planned public HTTPS entry points; `dodo` is an example host handle. Users should not need to understand MCP, choose API endpoints, find command syntax, or manually relay messages. The agent reads the skill document, checks available capabilities, and guides the next action. Ask only for missing meeting/setup information, required consent, or decisions outside existing delegation. Offer defaults for review rather than silently saving inferred host rules.

The root skill document remains public and explains the waitlist/invite-only launch. Without host access, the agent offers a web waitlist entry and reports that access is pending; it cannot activate hosting. Invited hosts redeem access in the browser and resume the same onboarding flow. Joining the waitlist, signing in, or granting OAuth consent does not itself grant host access.

Host onboarding can pause for invitation redemption, browser sign-in, Google Calendar consent, and agent access consent, then resume in the agent without repeating supplied information. Return the host's shareable links only after setup succeeds; reconnecting should resume the existing account instead of creating another host. Optional iMessage/email channel setup should not block basic onboarding. Requesters remain account-free and do not need a host OAuth grant.

Reading a remote Markdown file is not automatic tool installation or authorization. If a client cannot read the document, connect the needed tool, or resume the flow, provide the smallest supported setup step or a direct web continuation. Test the pasted prompts in each required personal-agent client; do not claim universal one-paste compatibility without that evidence.

### Requester-agent handoff

The requester should be able to delegate the coordination rather than manually fill out the booking page or relay messages between systems. Starting from the shared booking link, a supported agent discovers how to submit and continue a request, uses requester-authorized availability and preferences, negotiates suitable options, and tracks the outcome through host approval and booking. Only the availability information needed for coordination is shared. The requester can optionally connect Google Calendar directly to Find Me a Time, provide availability manually, or let their personal agent supply authorized availability. Direct connection uses a separate browser consent flow and returns to the same request; it does not require waitlist admission or a Find Me a Time account.

Within the requester's delegated authority, their agent may select a candidate and express requester agreement without a separate manual confirmation step. It asks the requester when information is unavailable or a decision exceeds that authority. This permission does not grant host approval: the host must still explicitly approve the current proposal. The requester agent reports a confirmed meeting only after booking succeeds and otherwise communicates the pending status or required action.

### Agent connection and authorization

For host access, the personal agent starts from the root skill document and guides the host through a compatible connection, browser sign-in, permission review, and grant or denial. Manual MCP connection remains an alternative setup path. After consent, the client can use only the granted host operations, including onboarding and configuration when explicitly permitted. The host can inspect and revoke connected clients in account settings. Terminal-based agents can use the CLI to access the same scheduling API with the same role boundaries; CLI login details remain a technical design decision.

| Permission | Authorizes | Does not authorize |
|---|---|---|
| Google Calendar connection | Find Me a Time accesses the host's selected calendars or, with separate requester consent, the requester's selected availability. | A personal-agent client accessing the host's Find Me a Time account. |
| MCP OAuth connection | A client accesses the host's Find Me a Time operations within granted permissions. | Blanket meeting approval or automatic booking. |
| Explicit host approval | Booking the exact current proposal, subject to requester agreement and final feasibility checks. | Booking a changed proposal or waiving unrelated rules. |

Requesters retain public booking-link discovery and request-specific continuation without a Find Me a Time account or host-style OAuth connection. Their access cannot reveal other requests or host-only data. Sharing a booking link does not automatically install a CLI, connect an MCP server, or grant permissions: each supported client needs a tested discovery and connection path. If setup is needed, explain the next action and retain a web path to continue the same request.

### Guest identity, timezone and optional Google connection

Guests receive guided, suggestion-first intake without mandatory account creation. Reuse details already supplied by the guest or their authorized agent. Offer **Continue with Google** as an optional identity shortcut alongside **Continue without Google**. Validated Google identity may prefill name and verified email; manual entry uses a compact name/email card. Let the guest edit the display name and review the invitation recipient in the proposal. An alternate or manually entered address requires contact verification before trusted private recovery or attendee use; typing an address or matching an existing address never grants request access.

Use the browser's IANA timezone as an initial display suggestion when available, show it beside times with an editable selector, and do not interrupt with a separate confirmation question. An explicit guest choice takes precedence and survives reload or Google return. Ask only when timezone is missing, conflicting or date/travel context is ambiguous; do not infer it from name, language or email. Render date-specific offsets for daylight-saving time. Changing the display timezone preserves proposed instants; changing intended local availability requires re-evaluation and a new proposal where applicable.

Offer **Connect Google Calendar** when finding mutual times, with a clear availability-only explanation and **Skip for now**. Google identity verification and Calendar permission are separate transactions; neither grants requester agreement, host admission or host approval. Guests can sign in without Calendar access or use request-bound Calendar consent without a mandatory product account. Both flows resume the same protected request or bound intake draft. Web/email/manual availability and requester-agent delegation remain available.

### Agent-guided onboarding and preference suggestions

The AI agent guides every onboarding step: access/sign-in, invitation redemption, Google connection, calendar selection, preference review, inline iMessage linking and completion. It explains the next action, presents the appropriate card, waits for verified server results and resumes without repeating completed questions. Before admission, guidance is generic and reveals no private host state; sensitive inputs and browser consent use protected controls.

For preferences, suggest first rather than opening with a blank questionnaire. Respect current explicit choices and existing confirmed settings; use authorized calendar/profile context for remaining fields, then offer clearly labeled starter defaults when evidence is sparse. Propose calendar roles, timezone, meeting windows, duration, buffers and meeting mode/location with a short reason and **Use this**, **Adjust** or **Choose my own**. Identify whether a value is stated, inferred or a starter default; a default must never be described as an observed calendar pattern. Ask one focused question only when a required detail cannot be safely suggested or a contradiction remains. Do not guess identity, verification codes, permissions, consent, exact addresses or meeting approval. New corrections revise the draft and invalidate old reviews; neither a guess nor silence saves policy.

Location preference is an explicit onboarding question, even when calendar-based suggestions are available: **“Do you prefer online meetings, in-person meetings, or either?”** Show **Online**, **In person** and **Either** choices, with any recommendation labeled as a suggestion. For in-person or either, follow with **“Where do you prefer to meet?”** and editable suggested areas/venues, **Enter a place** and **Decide per meeting**. The host must answer or explicitly choose per-meeting decisions before final settings confirmation; an inferred or preselected option is not an answer. Reuse an explicit answer already given instead of asking again. Online-only hosts need no physical venue. Do not infer home/work addresses or publish observed locations; per-meeting decisions leave actual booking location and travel checks to the proposal workflow.

For hosts accepting in-person meetings, follow the location question with **“How do you usually get to meetings?”** Offer supported travel modes such as **Driving**, **Public transit** and **Walking**, plus **Depends on the trip**. Ask for an explicit choice even when suggesting a mode; calendar locations alone do not establish transportation habits. Then ask **“How much extra time should I leave around travel?”** with an editable starter buffer, clearly separate from estimated journey duration. Reuse already explicit answers and skip these questions for online-only setup. A per-trip choice is valid onboarding policy but requires the applicable mode/allowance to be resolved before offering a physical candidate. Unsupported regional routing must remain unresolved or use an explicit manual allowance, never a silent mode substitution or zero travel. Final review includes transport policy and buffer.

### Host interaction through iMessage

The host receives a private request summary with the meeting details and can ask questions, suggest changes such as “Make it next week,” or approve or decline the displayed proposal. A conversational reply may record approval only when the linked host identity, explicit intent, and exact current proposal are established. An unqualified “yes” with multiple pending proposals or a reply to an outdated message cannot authorize booking. When the channel cannot establish these conditions, the host completes the decision through an authenticated web link.

iMessage is a host interaction channel in this scope; requester-agent handoff remains available through the booking link. The messaging channel shares the same request state and does not create a separate approval or booking workflow.

## 6. Functional requirements

### Host setup and calendar access

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-01 | Authenticate hosts and scope access to their own requests, rules, and calendars. | A host cannot view or act on another host's private request through either the UI or an agent client. |
| FR-02 | Guide Google Calendar connection with in-chat actions and explain suggested conflict-checking calendars and a writable booking destination. | The host reviews actual authorized calendars, can change every suggestion, and explicitly confirms selection. Calendar access alone never selects calendars or authorizes publishing. |
| FR-03 | Make calendar connection failures visible and stop actions that require unavailable calendar data. | Revoked access or a failed availability check never appears as an empty calendar or a successful booking; the host receives a recovery action. |
| FR-04 | Guide hosts through reviewable scheduling rules, including calendar-informed meeting-window and location suggestions. | After consent and host selection of calendars to analyze, scan a disclosed bounded period and explain suggested windows and meeting modes/locations. Hosts can accept, edit, or dismiss suggestions; observed free time or repeated places are not assumed preferences. Sparse evidence produces labeled starter suggestions before a focused question or manual setup; observed patterns and defaults remain distinguishable. Explicitly ask and record meeting-mode/location preference, with a per-meeting choice allowed; inference alone cannot complete this step. Only explicitly confirmed settings become policy. |

### Intake and negotiation

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-05 | Accept requests without requiring a requester account. | A requester can submit through each supported requester channel and continue the request with access limited to that request. A public booking link grants no access to other requests. |
| FR-06 | Collect the information needed to evaluate a meeting. | Before finalizing a proposal, the system has requester identity/contact, purpose, duration, requested date range or availability, timezone, meeting mode, and the necessary location details. Relevant host defaults may be offered for confirmation. |
| FR-07 | Clarify ambiguous or incomplete input. | Expressions such as “next Friday afternoon” are resolved to an explicit date, timezone, and time window before agreement. An uncertain physical location triggers a clarification. |
| FR-08 | Preserve one request across channels. | A securely linked email reply, booking-link interaction, host iMessage reply, or agent action updates the same request with role-appropriate permissions. Unverified identity or a similar name is not enough to merge requests or expose their history. |
| FR-09 | Support alternatives and requester withdrawal before booking. | A requester can reject offered times, suggest alternatives, or withdraw. A withdrawal accepted before booking begins blocks event creation; during an uncertain booking attempt, the system reports the pending outcome accurately. |
| FR-10 | Handle no-match cases without inventing availability. | When no candidate satisfies current constraints, the assistant requests a wider window or missing details, or asks the host privately for a decision. It never silently relaxes a rule. |

### Candidate feasibility and AI behavior

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-11 | Check the entire meeting interval against known hard constraints. | Busy intervals, duration, availability rules, focus blocks, and required buffers exclude invalid candidates before ranking. |
| FR-12 | Evaluate location and travel feasibility on both sides of a physical meeting. | A nominally free slot is excluded when map-estimated travel from the preceding commitment or to the following commitment, plus configured buffers, cannot fit. Missing locations, unsupported routes, or failed estimates prompt clarification or an explicitly confirmed manual travel allowance; they never imply zero travel. |
| FR-13 | Use AI to gather details and rank feasible candidates. | Ranking can reflect explicit host priorities and preferences, but AI cannot turn an infeasible candidate into an offered option or waive a preference. |
| FR-14 | Keep private explanations separate from requester-visible explanations. | The host may see which private rule affects a candidate; the requester receives suitable alternatives or a neutral explanation without event titles, other attendees, private locations, or priority labels. |
| FR-15 | Make times unambiguous across locations and daylight-saving changes. | Both parties can inspect an explicit date, local time, and timezone representing the same instant. Ambiguous or nonexistent local times require resolution before selection. |

### Travel-time checks

For FR-12, evaluate the host's ability to reach the proposed meeting and the next commitment before offering a candidate, then revalidate before booking under FR-20. Requester calendar access remains availability-only; it does not authorize reading requester event locations.

- Use the relevant adjacent commitments across the host's selected calendars, the proposed meeting location, the host's confirmed travel mode, and the expected departure time. Ask the host to resolve ambiguous addresses or missing physical whereabouts. A virtual meeting does not establish where the host will physically be; do not infer a home or office address when an endpoint is unknown.
- Require the gap before the meeting to cover travel from the preceding commitment plus the applicable host buffer. Require the gap after it to cover travel to the following commitment plus the applicable buffer. Both checks must pass; a provider estimate supplements the buffer rather than replacing it.
- If a location is missing, a route is unsupported, or the provider fails, keep travel feasibility unresolved. Ask for clarification or let the host explicitly confirm a manual travel allowance for that trip. Record that allowance as scheduling input; do not treat it as permission to bypass hard constraints or as meeting approval.
- Show the host the estimated travel time, added buffer, and any manual allowance. Requesters receive feasible options or a neutral explanation, without private neighboring event locations or details. Changes to location, travel mode, relevant calendar context, or travel allowances trigger reevaluation and invalidate approval when the approved proposal or its exceptions change.

For example, if the previous meeting ends at 14:00 and the proposed meeting starts at 14:30, a 25-minute route plus a 10-minute buffer makes that candidate invalid. The following trip is checked independently. Supported geography, modes, and estimate freshness must be defined before launch; route estimates are not arrival-time guarantees. Google Routes is the selected initial provider in the [technical specification](03_technical_specification.md).

### Approval and booking

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-16 | Present a complete, versioned proposal for phone-friendly host review. | The host can inspect participants, purpose, date/time/timezone, duration, mode/location, and exceptions before approving, revising, or declining. No approval is preselected. |
| FR-17 | Bind approval to the host and current proposal version. | A stale approval or a requester-originated approval attempt is rejected without creating an event. A proposal edit invalidates the old approval. |
| FR-18 | Allow an authenticated host agent to relay an explicit host decision. | The decision is attributable to a host confirmation of the exact current proposal. Agent-generated consent, general scheduling instructions, or possession of an agent credential alone are insufficient. If the integration cannot establish this, direct host confirmation is required. |
| FR-19 | Require requester agreement on the current details before booking. | A host revision that changes agreed details is returned to the requester. Neither party is treated as agreeing to a superseded proposal. |
| FR-20 | Revalidate the current proposal immediately before event creation. | A new calendar conflict, changed rule, invalid approval, or missing agreement stops booking. Changed details are presented for fresh agreement and approval. |
| FR-21 | Prevent duplicate booking across retries and competing channels. | Repeating approval or replaying a message for one request results in at most one event. Simultaneous service-managed requests for the same host slot are coordinated and revalidated. |
| FR-22 | Handle uncertain calendar-write outcomes safely. | If an event may have been created before a timeout, the system checks the outcome before retrying creation. Until resolved, the request shows that booking is pending, with no success claim. |
| FR-23 | Confirm the booking and communicate failures truthfully. | A confirmed booking identifies the actual calendar event and final meeting details. Its confirmation email, calendar invitation and protected `/booking/[bookingId]` receipt show consistent details and a **View booking** destination; **Join meeting** appears when applicable. Calendar RSVP status is not a substitute for recorded agreement or approval. A definitively rejected write shows the failure and a retry or reconnection action. Every creation retry revalidates current agreement, approval, and feasibility. Failed confirmation delivery can be retried without creating another event; delivery failure is distinguishable from booking failure. |

The [booking invitation design](user_experience/03_interfaces.md#booking-confirmation-email-and-calendar-invitation) defines the proposed email/calendar presentation for FR-23. The requester booking page covers the scheduling process before confirmation as well as its final receipt; its name does not imply an event already exists. Post-booking rescheduling and cancellation remain outside the initial release.

### Named agent integrations

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-24 | Support Dots, Muse, Instinct, ChatGPT, Codex, Claude, and Claude Code as clients of the shared scheduling workflow. | For each integration, a requester can submit details, negotiate candidates, and retrieve their request status; an authenticated host can review the current proposal and relay an explicit decision subject to FR-18. Each client observes the same proposal version and outcome as web and email. Requester access does not require a Find Me a Time account. Compatibility is tested for each product, not inferred from a shared protocol. |
| FR-25 | Let requesters hand off scheduling by giving a supported agent the host's booking link. | Starting from the same link used by people, the agent can discover the scheduling interface, submit a request, exchange alternatives, express agreement within delegated authority, and retrieve the confirmed outcome. The requester need not manually operate the booking page or copy messages between clients. Missing information or decisions beyond delegation are returned to the requester; host approval remains mandatory. |

### Host iMessage channel

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-26 | Let hosts opt into a verified private iMessage conversation. | An authenticated host can link and unlink their messaging identity. Private request summaries are sent only to the linked host conversation; unlinked senders and group conversations cannot retrieve host-only details or act as the host. Unlinking stops notifications and future host actions through that identity. |
| FR-27 | Support host review, discussion, revision, approval, and decline through iMessage. | The host can inspect the proposal details required by FR-16 and discuss changes privately. Approval requires explicit host intent bound to the exact current proposal. Ambiguous replies trigger clarification; stale replies cannot approve a newer proposal. If identity or proposal context cannot be established, authenticated web review is required. |
| FR-28 | Keep iMessage delivery and recovery consistent with shared request state. | Replayed messages and concurrent web/agent actions do not duplicate decisions or bookings, including after a service restart. Delivery failure is visible in the web inbox, where the host can continue. A delivery/read receipt is never approval, and retrying a notification does not create another booking. |

### MCP, CLI, and authorization

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-29 | Expose the shared scheduling workflow through a remote MCP server. | Authorized clients can discover and invoke role-appropriate operations to submit, negotiate, inspect, and act on requests. All calls use the shared scheduling API and current proposal state; client compatibility and booking-link discovery are verified separately. |
| FR-30 | Offer a CLI for terminal-based agents and scripts. | The CLI provides role-appropriate access to the same workflow and structured JSON results identifying the request, proposal version where relevant, status, and errors. It enforces the same authority, approval, and retry rules as MCP; it does not maintain independent scheduling state. |
| FR-31 | Use OAuth for protected host access through remote MCP. | The host can sign in, inspect requested permissions, consent or deny, and revoke a client connection. Calls with expired, revoked, wrong-audience, or insufficiently scoped credentials cannot perform the protected operation. OAuth consent alone cannot approve a proposal; Google Calendar credentials are not accepted as MCP access tokens. |
| FR-32 | Preserve account-free, request-scoped access for requester agents. | Public booking-link discovery and request submission do not require a host account or host OAuth grant. Continuation is restricted to the authorized request; a booking link alone does not expose existing requests, private host data, or host actions. |

### Skill entry and onboarding

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-33 | Let a host start onboarding by pasting the root skill prompt into a supported personal agent. | The agent reads `https://findmeatime.com/SKILL.md`, checks host access, offers waitlist entry or invitation redemption as needed, then guides supported connection and required consent, gathers and confirms minimum calendar/rule settings, and returns the host's shareable links after successful setup. The host need not manually discover endpoints or commands. Interrupted setup resumes without duplicate host creation. |
| FR-34 | Publish a host-specific skill entry for account-free requester delegation. | `https://findmeatime.com/{host}/SKILL.md` identifies the intended host using public information and guides request submission, negotiation, and continuation. The agent asks only for missing information or out-of-delegation decisions. Unavailable hosts or unsupported client capabilities produce a clear recovery path, never an invented connection or booking. |
| FR-35 | Launch with a waitlist and invite-only host access. | Prospective hosts can join the waitlist without connecting a calendar. Only admitted hosts can configure their hosting settings and publish an active booking link. Requesters may connect Google Calendar for availability without admission. Enforce admission across web, API, MCP, and CLI; sign-in or OAuth consent alone cannot bypass it. Valid invite redemption resumes setup; invalid, expired, revoked, or already-used invitations cannot activate another host. Requesters can contact active hosts without joining the waitlist or receiving an invitation. |
| FR-36 | Let requesters optionally connect Google Calendar for availability checks. | From web or an agent-guided browser flow, a requester can consent, select calendars for availability, and resume the same request without a product account or host invitation. Candidate checks combine host constraints and authorized requester busy intervals. Manual or agent-provided availability remains available. Calendar consent grants neither requester agreement nor host authority. Denied, revoked, or failed access produces an explicit fallback/reconnect action, never assumed availability; private event details and tokens are not shared with the host or agents. |

## 7. Request lifecycle

These are user-visible states, not a required database design. Each request has one current state and enough history to explain changes.

| State | Meaning and permitted next step |
|---|---|
| Gathering details | Required information is missing. Clarification can lead to negotiation, withdrawal, or decline. |
| Negotiating | Candidates are being discussed. Agreement on a proposal leads to host review; a host revision may return here. |
| Awaiting host approval | The requester has agreed to the current proposal. The host can approve, revise, or decline it. |
| Booking | Required agreement and approval exist; revalidation and event creation are in progress. A conflict returns the request for revision. An uncertain write remains pending until reconciled. |
| Booked | Calendar event creation has been confirmed. Notification delivery status is tracked separately. |
| Declined | The host has declined; late replies cannot resume booking automatically. |
| Withdrawn | The requester withdrew before booking began; late approvals cannot book it. |
| Expired | The proposal or request is no longer actionable under the agreed expiry policy. Continuing requires refreshed details and decisions. |

Recoverable failures must show the action needed and preserve prior context. A definitively rejected write leaves booking paused with a visible failure and recovery action; retry requires current agreement, approval, and feasibility checks. A timeout alone must not label an uncertain calendar write as safely failed. Terminal requests cannot be reopened by replaying an old message. The UI must make the transition into booking clear because an in-progress write may already have created an event.

## 8. Privacy, security, and reliability requirements

- **Separate visibility:** Requesters and their agents see only their own submitted information, shared proposal details, and relevant status. Host-only notes and calendar context remain private in messages, notifications, agent responses, and error output.
- **Control shared details:** A private calendar location can inform travel checks without being disclosed. The approved meeting location or link is shared only as part of the proposal with its intended participants.
- **Enforce authority independently of AI:** Messages, emails, and agent-supplied text are untrusted input. Instructions embedded in them cannot change permissions, waive rules, reveal private data, or bypass approval.
- **Scope and revoke access:** Host calendar connections and personal-agent access must be revocable. Requester continuation access must be request-specific and must not provide host capabilities. Tokens and credentials must not appear in user-visible logs or messages.
- **Record decisions:** Keep a host-visible history of proposal revisions, explicit exceptions, agreements, approvals, booking attempts, and outcomes. Record the actor and proposal version so disputed or stale actions can be explained without exposing private history to requesters.
- **Preserve state:** Navigation, refreshes, delayed email delivery, repeated messages, and temporary provider failures must not lose the request or duplicate side effects.
- **Support mobile and accessible review:** Core intake and approval flows must work on a phone and with keyboard navigation, labeled controls, readable validation errors, and status indicators that do not depend on color alone.
- **Bound data collection:** Collect only information needed for scheduling. Before launch to real users, define retention, deletion, AI-provider data handling, and consent disclosures.

Calendar changes made outside this product can race with a final availability check. The product must recheck before writing and surface detected conflicts; it must not imply that an offered candidate reserves time or that external calendar races are impossible.

## 9. End-to-end release acceptance scenarios

| ID | Scenario | Expected outcome |
|---|---|---|
| AC-01 | A requester asks for 30 minutes next week without timezone or location. | The assistant clarifies missing details, offers feasible times, obtains requester agreement and host approval, then creates one event. No requester account is required. |
| AC-02 | A slot is free but a map-estimated trip plus host buffer cannot fit before or after it. Repeat with an unknown location, unsupported route, provider failure, and changed travel context before booking. | Either insufficient gap excludes the slot. Missing estimates remain unresolved until clarified or replaced by an explicit host-confirmed manual allowance; none are treated as zero travel. Revalidation blocks booking when the trip no longer fits. Host travel details stay private. |
| AC-03 | No option satisfies a host preference. | The host receives a private request for an explicit exception or revision. Requester-visible proposals and responses omit private rules, exception metadata, and exception reasons; an exception does not bypass final approval. |
| AC-04 | Duration, time, location, or participants change after approval. | Prior approval becomes unusable; changed agreed details require requester agreement and fresh host approval. |
| AC-05 | An email reply selects an old option while a newer proposal exists. | The old reply cannot book. The requester is directed to the current proposal without creating a second request. |
| AC-06 | Mobile approval and repeated agent approval arrive together. | Both observe a consistent result, and the request produces at most one calendar event. |
| AC-07 | Two requests compete for one slot, or a new busy event appears before booking. | The service coordinates its own competing writes and rechecks availability. A detected conflict stops the affected booking and prompts revision. |
| AC-08 | Calendar creation succeeds but its response is lost. | The system reconciles the outcome and reports the existing event rather than creating a duplicate. |
| AC-09 | Calendar access is revoked, a calendar write is definitively rejected, or confirmation delivery fails after successful booking. | Revocation blocks calendar-dependent actions. A rejected write shows a recovery action, and a creation retry rechecks current agreement, approval, and feasibility. Notification failure preserves the booked state and retries delivery without another event. |
| AC-10 | A requester or agent asks for private calendar details or claims the host has approved. | Private data is withheld; the claim supplies no booking authority. A host agent still needs an attributable explicit host confirmation. |
| AC-11 | A requester moves from email to a booking-link conversation. | Verified continuation shows the same current request and permitted shared context, without leaking other requests or host-only notes. |
| AC-12 | Parties use different timezones across a daylight-saving transition. | The selected proposal identifies the same instant for both parties; ambiguous local input is clarified. |
| AC-13 | A late approval arrives after withdrawal, decline, or expiry. | No event is created and the current status is returned. A withdrawal during an uncertain write does not falsely claim the event was prevented. |
| AC-14 | Run requester and authenticated-host journeys separately through Dots, Muse, Instinct, ChatGPT, Codex, Claude, and Claude Code, including continuation through web or email. | Each integration supports FR-24 with the correct role permissions and current request state. Verify private-data isolation, explicit host confirmation, stale-proposal rejection, and duplicate-retry handling for each product. Where confirmation cannot be established within the client, direct host confirmation is required before booking. |
| AC-15 | A requester gives Dots, Muse, Instinct, ChatGPT, Codex, Claude, or Claude Code the host's booking link and delegates a meeting request with sufficient details and authorized availability. Repeat for each client. | The agent starts and negotiates the request without manual booking-page interaction, selects an option within the delegation, waits for explicit host approval, and reports the confirmed booking. A second case with missing details or an out-of-scope option prompts the requester instead of inventing information or exceeding authority. |
| AC-16 | A linked host receives an iMessage request summary, asks a private question, revises the time, and approves the resulting current proposal. | Private discussion remains host-only; changed details receive requester agreement and fresh host approval. The decision is bound to the current proposal and appears consistently on web and agent clients. A separate decline case creates no event. |
| AC-17 | An unlinked sender or group conversation requests host details; a linked host sends an ambiguous “yes” or replies to an old proposal. | Unauthorized requests expose no private data and cannot approve. Ambiguous replies prompt clarification or authenticated web review; stale replies do not authorize a newer proposal. After unlinking, that messaging identity can no longer act as the host. |
| AC-18 | Replay an iMessage approval after a service restart while a web action occurs, then simulate outbound notification failure. | The request produces at most one booking and retains a consistent decision history. Delivery failure remains distinct from booking status; the host can continue through web, and a delivery retry creates no additional event. |
| AC-19 | A host connects an MCP client, grants limited permissions, then revokes the connection; repeat with consent denied. | Granted operations work only within scope and for that host. Insufficient permissions and subsequent revoked calls are rejected. Denying consent creates no authorized connection. The host can still review requests directly on web. |
| AC-20 | A client uses an expired or wrong-audience token, a Google Calendar token, or an OAuth grant as if it were meeting approval. | Invalid credentials cannot access protected operations. A valid OAuth grant alone creates no approval or booking; explicit host confirmation must still identify the current proposal. |
| AC-21 | A requester agent starts from a public booking link and continues its request without registering. | It can coordinate within request-specific access. Attempts to read another request, retrieve host-only data, or perform a host action fail. The public link alone grants no access to prior requests. |
| AC-22 | Use MCP and CLI on the same request, including a retried action and a client that needs initial connection setup. | Both observe consistent status and proposal versions, enforce the same permissions, and produce no duplicate booking. CLI results are machine-readable. Missing integration setup produces an actionable next step or web continuation, never fabricated success. |
| AC-23 | A newly invited host pastes “Let me use findmeatime.com/SKILL.md for my scheduling” into each supported agent; repeat with interrupted setup and an existing host. | The agent guides necessary consent and minimal configuration, confirms saved settings, and returns the correct shareable links only on success. Resumption preserves prior progress without creating another host. No API knowledge or manual message relaying is required. |
| AC-24 | A requester pastes “Let me schedule a meeting with findmeatime.com/dodo/SKILL.md”, first with sufficient authorized context and then with missing meeting details. | The agent identifies Dodo, coordinates within delegation without requester signup, asks only for missing information or decisions, and reports pending approval until the host approves and booking is confirmed. |
| AC-25 | A skill URL is unavailable, names an unknown/unavailable host, or is read by a client unable to fetch or connect; repeat with denied consent. | The flow explains the actual limitation and offers a supported setup or web continuation where possible. No fabricated host, credential, approval, or successful setup is recorded. Public skill documents expose no private settings, history, or credentials. |
| AC-26 | Join the waitlist, repeat the submission, and attempt host setup through web, MCP, CLI, and direct API before admission. Then redeem an invitation and retry setup; test invalid, expired, revoked, reused, and concurrently redeemed invitations. | Waitlist entry does not create active hosting or calendar consent. Duplicate submissions do not create duplicate entries. Unadmitted users cannot publish their own booking links or configure hosting settings; they may connect a requester calendar. Valid redemption activates access once and resumes setup; unusable invitations provide recovery without granting access to another account. An ordinary requester can still contact an active host without an invite or account. |
| AC-27 | An uninvited requester connects Google Calendar from a booking page or agent-guided browser flow and resumes their request. Repeat with declined consent, disconnected/expired access, a failed read, changed availability, and attempted access from another request. | Successful checks exclude requester busy intervals and preserve request-scoped access without product signup. Private event details and credentials remain private. Failed checks pause dependent scheduling until reconnection or explicit manual/agent availability replaces them. Skipping connection still permits requesting. Calendar consent does not agree to a proposal or admit a host; booking requires current requester agreement and host approval. |
| AC-28 | The agent guides access/sign-in and admission without exposing private state, then an admitted host follows suggestion-first onboarding: connect Google, review recommended calendars, analyze selected calendars, review meeting-window and location suggestions, and confirm settings. Repeat with sparse/missing locations, partial/failed reads, revoked access, duplicate names, read-only calendars and a stale review. | The agent leads each step through completion and inline iMessage connection or skip. It proposes preferences before asking for manual input, distinguishes stated choices/inferences/starter defaults, respects corrections and existing settings, and asks one focused unresolved question at a time. Action cards explain recommendations and analysis scope, allow edits/manual setup, and resume after browser return or failure. Only selected authorized data informs private suggestions. No failed read means free time, inferred place becomes a saved/public preference, or suggestion overwrites confirmed settings. Onboarding explicitly asks mode/location preference, reuses an existing explicit answer, and requires an answer or per-meeting choice before final settings confirmation; online-only skips venue and transportation entry. For in-person/either, explicitly capture transportation preference or per-trip policy and an extra travel buffer, separate from route duration. Current explicit confirmation and readiness checks precede publication. Mobile/keyboard and reduced-motion paths preserve progress and reachable controls. |

Run the applicable scenarios through each supported channel and include transitions between channels. Approval, authorization, privacy, and duplicate-prevention checks must exercise the underlying actions as well as visible controls.

## 10. Dependencies and open decisions

The product depends on Google Calendar access, email transport, an AI service, authenticated agent integration, and iMessage transport. Their failures must follow the behavior specified above. Supabase remains the selected database and host-identity infrastructure, but the scheduling backend source, API boundaries, workers, schemas, and tests are being rebuilt. The [technical specification](03_technical_specification.md#backend-decision) records the current infrastructure direction; the [frontend architecture](technical_specification/02_frontend_architecture.md) defines the replacement boundary.

The recommended conversation runtime is eve with Next.js, subject to a bounded build, authorization, reconnection, and restart check. Eve may manage conversation execution, but the application remains authoritative for identity, session ownership, proposal revisions, explicit decisions, idempotency, and booking reconciliation. If the check changes the runtime choice, update the architecture explicitly rather than introducing a second agent engine silently.

Use **Cloudflare Email Service** for host invitations and transactional contact-verification, recovery, and booking messages, sent from `no-reply@findmeatime.com`. Supabase remains the authentication system and sends its Auth confirmation and recovery messages through Cloudflare's authenticated SMTP endpoint as custom SMTP. Keep **AgentMail** for managed conversational inboxes, threads, and replies used by multi-turn scheduling negotiation. These are separate provider responsibilities. See [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [Cloudflare SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), and [AgentMail capabilities](https://docs.agentmail.to/knowledge-base/inbox-capabilities).

Keep request state, participant authority, proposal versions, and approval in Find Me a Time. Provider inbox/thread identifiers map to our requests and conversations; they do not establish a sender's scheduling authority. Host-private and requester-facing conversations remain separate. Provider selection does not promote the proposed host-email extension into initial release scope. The [backend architecture](technical_specification/01_backend_architecture.md#email-provider-direction) records adapter and validation details; an end-to-end email test is required before treating the integration as ready.

The agent access direction is **remote MCP and a thin CLI over the shared scheduling API**, with MCP prioritized for personal-agent integration. The HTTP MCP authorization design should follow the OAuth-based MCP authorization specification, including authorization-code flow with PKCE, protected-resource and authorization-server discovery, and access tokens issued for this resource. Select and test the supported protocol version and client-registration mechanisms during technical design. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

The CLI is a thin API client. Exact commands, application permission mapping, Supabase OAuth compatibility, CLI login, and requester continuation credentials remain design decisions. Provider calendar credentials stay with the scheduling service and are not passed to personal-agent clients.

Use the existing **Photon Spectrum** provider direction for iMessage transport. Rebuild or adapt the bridge against the new channel contracts; do not assume that an eve-native Photon adapter accepts the existing Spectrum credentials or preserves the required delivery semantics without verification. [Photon documentation](https://photon.codes/docs/spectrum-ts/introduction)

The newer proposed linking experience starts in the authenticated website: the host enters an iMessage number, receives a six-digit code in that private chat, and enters it in the same browser to link the identity. An iMessage-first handoff may lead to that authenticated browser flow. A code request alone does not grant host authority or approve a proposal. Basic web setup remains available without iMessage. The active conversational-host-setup OpenSpec delta now specifies this flow; implementation and verification remain pending. Live delivery and shared-pool target policy still need verification for each recipient. See [Photon's deliverability guidance](https://photon.codes/docs/best-practices/imessage-deliverability) and the [provider setup notes](technical_specification/03_provider_setup.md#first-message-and-host-onboarding).

After the first exchange, the proposed optional **Add to contacts** step lets the host save Find Me a Time with the verified sender number for their conversation. Contact saving remains user-controlled and does not grant host authority or notification consent. See [display-name and contact-card setup](technical_specification/03_provider_setup.md#display-name-contact-cards-and-profile-sync) for contact-sharing setup and verification. This onboarding UX is not yet implemented.

Transport or runtime approval mechanisms do not replace the product's proposal-specific host approval requirements. A rendered button label or ordinary chat response must not be assumed to authorize booking. Confirm the rebuilt Spectrum integration with an end-to-end host review and booking test before release.

The team must resolve these decisions before the corresponding feature is treated as release-ready:

| Decision | Needed to finalize |
|---|---|
| Delivery sequence and integration details | Which channels ship together, the MCP connection path or CLI availability and supported versions for required Dots, Muse, Instinct, ChatGPT, Codex, Claude, and Claude Code integrations, and the compatibility test environment for each. |
| OAuth and CLI access | Authorization-server implementation, MCP protocol version and discovery/registration compatibility, permission scopes, connection revocation, and CLI login and command design. OAuth for protected host MCP access is required. |
| Requester calendar | Optional Google Calendar connection is included. Finalize minimum availability scopes, calendar selection, request-bound credential lifetime/revocation, and fallback/revalidation behavior. |
| Waitlist and invitations | Calendar hosting is invite-only; requesting meetings and connecting a requester calendar require no invitation or product account. Finalize waitlist fields, invitation delivery/expiry, identity binding, operator access, and retention before implementing admission. |
| Skill entry and agent discovery | Root `/SKILL.md` and per-host `/{host}/SKILL.md` are the required entry paths. Finalize document versioning, per-client connection/resumption, minimum host setup, handle assignment, and request-scoped continuation. Verify AC-23–AC-25 for every named client. |
| Host confirmation through personal agents | How explicit human confirmation is attributed to the current proposal and how permissions are revoked. |
| iMessage integration and host identity | Photon Spectrum bridge compatibility with the rebuilt channel contracts, supported versions, hosting and line provisioning, verified host linking/revocation, proposal-specific reply handling, and delivery recovery. Implement the pending six-digit browser verification delta and validate the result through AC-16–AC-18. |
| Email and continuation access | Configure Cloudflare Email Service and Supabase Auth custom SMTP; verify controlled transactional and Auth delivery. Finalize AgentMail conversational inbox allocation, sender verification, request/thread mapping, forwarded-link handling, retention, and recovery. |
| Rule configuration | Defaults, hard-constraint versus preference classification, exception controls, travel modes and supported geography, estimate freshness, manual travel allowances, and buffer granularity. |
| Online meeting details | Whether the host supplies a link or a supported integration creates it, and what the host approves before creation. |
| Expiry and follow-up | Preserve the [meeting-request contract](../openspec/specs/meeting-requests/spec.md): actionable requests expire seven days after creation or at the requested-window end, whichever is earlier; guest credentials last at most thirty days and lose mutation/recovery/OAuth authority on closure. Reminder policy and automated follow-up limits remain open. |
| Supported languages | English and Korean intake are required by the [meeting-request contract](../openspec/specs/meeting-requests/spec.md). Broader localization and mixed-language acceptance coverage remain to be finalized. |
| Launch operations and measurement | Retention/deletion rules, support and recovery ownership, pre-release performance targets, and post-launch measurement criteria. |

## 11. Supporting documents

- [One-pager](01_one_pager.md): product purpose, audience, and core principles.
- [User journeys](user_experience/01_user_journeys.md): end-to-end experiences, interface map, and decision flows based on this draft.
- [User stories](user_experience/02_user_stories.md): actor-focused needs mapped to these requirements and acceptance scenarios.
- [Interfaces](user_experience/03_interfaces.md): channel responsibilities, agent access, and the proposed host email extension, which still needs release requirements and acceptance scenarios.
- [Page list](user_experience/04_page_list.md): proposed replacement web routes, access rules, contextual actions, and recovery states.
- [Technical specification](03_technical_specification.md): proposed architecture, authorization boundaries, data model, and booking recovery; unresolved stack choices remain proposals.
- [Frontend architecture](technical_specification/02_frontend_architecture.md): proposed Next.js/eve frontend and its boundary with the rebuilt scheduling backend.
- [implementation plan](technical_specification/04_implementation_plan.md): confirmed source-replacement scope and delivery sequence.
- [Competitive landscape](business/competitor_research.md): research context and comparative test scenarios. Competitor capabilities are not requirements or evidence of this product's performance.
