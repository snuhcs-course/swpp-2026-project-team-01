# Page list

Date: 2026-10-19
Status: proposed page design; not an implementation report
Companion: [Frontend architecture](../technical_specification/02_frontend_architecture.md)

This inventory defines the web surfaces of the application. The [PRD](../02_product_requirements.md) owns release scope, and the [chat workspace specification](../../openspec/specs/chat-workspaces/spec.md) owns the agreed conversation-first behavior. The single host chat page `/app` and requester route `/booking/[bookingId]` are the selected naming directions; the page designs below remain proposed. Detailed new behavior must be captured in an OpenSpec change before implementation.

The target origin for the routes below is **`https://release.findmeatime.com`**: host chat is `https://release.findmeatime.com/app`, public intake is `https://release.findmeatime.com/{handle}`, and private continuation is `https://release.findmeatime.com/booking/[bookingId]`. See [deployment setup](../technical_specification/03_provider_setup.md#deployment-origin) for callback and link configuration.

## Navigation and page model

Use a centered conversation with contextual cards and a reachable composer. A compact menu opens setup, request selection and settings controls inside the host chat, plus sign-out. Do not introduce a persistent sidebar, dashboard metrics, separate generic chat home, or model picker. Precise preference edits open labeled in-chat editors within the same page and restore focus on cancel or save, following the [interface contract](03_interfaces.md).

Public visitors enter through `/` or a host's `/{handle}` link. Signed-in hosts chat with their agent at `/app`. Sign-in state, setup, request review and settings are states and contextual controls of that same page. Requesters continue through a private request link without creating a product account. Email and iMessage conversations use the same application records and link to these pages when browser consent or review is needed.

## Primary pages

| ID | Route | Audience and access | Content and main actions |
|---|---|---|---|
| P01 | `/` | Public | Product explanation; become a host or sign in with Google, which creates an active host account. Do not show fabricated active booking links. |
| P02 | `/auth/sign-in` | Prospective or returning host | Google-only host sign-in and return to the intended safe destination; no email-login form. Show pending, invalid/expired sign-in and retry states. Requesters are not required to visit this page. |
| P03 | `/app` | Signed-in account; private agent conversation and host operations require an active host account | Host chat with contextual setup, request selection/review, proposal decisions and settings controls. Resume the permitted conversation and server-derived next action. |
| P08 | `/[handle]` | Public requester; active host only | Public host identity and conversational intake. Gather contact, purpose, duration, availability, timezone, mode and location. Offer an authorized agent handoff. On accepted request creation, continue at P09. Unavailable handles expose no host-private information. |
| P09 | `/booking/[bookingId]` | Request-scoped credential for private content; generic recovery available without prior access | Requester conversation, reviewed edits, optional Calendar availability, candidate selection, current-proposal agreement and status. Offer verified-contact access recovery, alternatives and withdrawal before booking begins. Email and personal-agent continuations return here; after confirmation, show the permitted booking receipt and join link. |
| P10 | `/connect/authorize` | Authenticated host plus a validated personal-agent OAuth authorization transaction | Identify the client, show requested application permissions and allow grant/deny. Preserve transaction state across sign-in. This is a logical consent surface; final OAuth-server routing is part of backend design. It does not grant calendar access, host eligibility or meeting approval. |

`/app` is the host's agent chat page. It does not redirect to separate access, setup, inbox, request-detail or settings pages. Page IDs P04–P07 are intentionally unused; their responsibilities belong to P03, while requester and consent IDs remain stable.

- Before setup is complete, show setup rather than booking links or request controls. A suspended host sees a neutral unavailable state without private agent history or host operations; keep sign-out and narrowly authorized grant revocation available.
- During setup, resume the saved conversation and draft with Calendar connection/selection, scheduling rules, optional iMessage linking and explicit settings review. Show booking/skill links only after server-confirmed readiness.
- Once ready, continue the host-agent conversation. Surface pending requests as selectable cards or a contextual picker with search/status filters, empty/loading states and delivery problems. Selecting a request loads its authorized discussion and current proposal in `/app`.
- Review proposals, approve, request changes, decline and inspect private rule/travel explanations in context. Each action names its request and current proposal revision. Show one shared or private discussion at a time; changing the visible discussion never merges their histories.
- Open labeled in-page dialogs for exact rules, calendars, timezone and personal-agent grants. Keep iMessage linking in inline conversation cards. Keep these controls usable during model failures and return focus to the conversation after closing.

Authentication and provider consent may use their dedicated routes, then return to `/app` and restore the server-authorized context. Notification entry and reload must recover the intended request only after checking ownership; the route itself grants no request access.

## Requester booking destination

`/[handle]` is the public entry for starting a new request. After creation, `/booking/[bookingId]` is the stable, protected destination for that scheduling conversation and its eventual receipt. It reuses the conversation shell rather than introducing a separate management dashboard. Hosts review the selected request inside `/app`.

Here, `bookingId` identifies the user-facing scheduling record from intake onward. It resolves server-side to the domain request; it is not the later calendar event ID or booking-attempt ID. Naming the page “booking” does not mean an event exists. Show the authoritative lifecycle explicitly: gathering/negotiating, awaiting host approval, booking pending or uncertain, confirmed, or another terminal state.

The same destination is used by **View booking** in confirmation email and calendar descriptions. Request IDs/booking IDs alone grant no access. A private requester email can carry the approved request-scoped continuation mechanism; a calendar description shared with attendees must not contain a credential that unlocks conversation history. Without existing authorized access, the link reveals no protected details. Hosts review private content through their authenticated host workspace.

S4 must provide labeled, keyboard-operable access-recovery controls here even in a browser without prior access. Accept the known request identifier and email with the same generic issuance feedback for unknown requests, wrong or unverified contacts, closed requests and delivery uncertainty. Only an active request's previously verified current contact can receive a recovery link. Follow the [private recovery contract](../../openspec/specs/meeting-requests/spec.md#requirement-accessible-private-recovery-continuation), including bounded issuance, proof expiry and atomic credential replacement. Redemption exchanges the fragment secret for a request-specific HttpOnly cookie and removes it immediately; secrets never enter query strings, browser storage or model context. Old credentials, pending contact proofs and linked channels lose authority after replacement. Access recovery is separate from conversation-runtime recovery and creates no agreement, approval or booking.

After closure, the existing unexpired requester credential permits only minimal terminal status and the confirmed receipt under the [meeting-request contract](../../openspec/specs/meeting-requests/spec.md). Keeping the URL stable does not extend credential lifetime, reopen negotiation or expose historical transcripts. Follow the [invitation design](03_interfaces.md#booking-confirmation-email-and-calendar-invitation) for receipt content and actions. No legacy requester-route redirects are required for this pre-launch rebuild.

## In-chat cards and actions

These names describe product components, not existing framework APIs. Cards receive validated application data and permitted actions; model prose cannot create an authorized button.

| Card | Where | Actions and result |
|---|---|---|
| Guest identity | P08, P09 | **Continue with Google** or **Continue without Google**; inline name/email entry, verified identity prefill and separate contact verification when required. Callback resumes this intake/request. Identity sign-in alone grants no Calendar permission or access to other requests. |
| Guest timezone | P08, P09 | Show detected IANA timezone and date-specific offsets with a selector. Preserve explicit choices; no separate confirmation prompt unless ambiguity needs resolving. |
| Contact verification | P09 | **Send verification code**, a labeled six-digit field, **Verify email**, and explicit **Request a new code** after the cooldown. Show delivery separately from proof, recover unknown actions with the same request, and keep codes outside chat. No login or meeting approval is granted. |
| Requester access recovery | P09, including without prior access | Labeled request/email fields and **Send recovery link** return generic issuance feedback without disclosing existence, contact status or delivery outcome. Only valid proof restores that request's access; exact retries preserve operation identity. No credential-paste field or login is required. |
| Calendar connection | P03, P09 | **Connect Google Calendar**, reconnect, skip where optional, or disconnect. Browser consent returns to the same host draft/request; show connected only after server verification. Requester access remains availability-only. |
| Calendar selection | P03; requester variant in P09 | Recommend actual host calendars with reasons, account/access labels and editable selections; distinguish conflict checking from writable booking destination. Saving the confirmed selection automatically starts the disclosed first scan; **Analyze again** is an explicit refresh/recovery action. Requesters choose availability calendars only; they do not receive host setup inference. |
| Onboarding suggestions | P03 | Private calendar-based meeting windows in a weekly preview and mode/location cards, with evidence, scope and uncertainty. **Use**, **Adjust**, **Choose my own**, or manual setup changes the draft only. Never present failed reads or inferred places as confirmed preferences. |
| Setup review | P03 | Show proposed settings and missing values; **Confirm settings** or **Edit**. A typed preference creates a draft, not silently saved policy. |
| Channel link | P03 | **Connect iMessage** expands inline phone entry and **Send code** within chat, then a protected code field and **Confirm and link**, then verified connection status. Offer **Maybe later**, retry/change-number and unlink as appropriate. Show masked recipient, expiry, delivery state and resend limits. Never return the sent code from the server or add the entered code to the transcript/model context. No settings dialog or separate linking page is required. |
| Candidate times | P09; authorized host view in P03 | Show date, time, named timezone, duration and mode/location; **Choose this time** or request alternatives. Selection is not booking or host approval. |
| Proposal review | P03, P09 | Show exact shared details and revision. Requester sees **Agree to this proposal**; host sees **Approve this proposal**, **Request changes**, **Decline**. Host-only exceptions stay private. Stale actions refresh the current proposal. |
| Rule/travel review | P03 | Show private constraints, travel estimates, buffers and any unresolved inputs. Confirm a manual allowance or permitted preference exception explicitly; never offer a hard-constraint bypass. |
| Decision and booking status | P03, P09 | Distinguish awaiting agreement/approval, booking, uncertain result, confirmed booking and delivery failure. A receipt appears only for a confirmed calendar event; show final details and **Join meeting** when a valid online meeting URL exists. |
| Share links / client connection | P03; public handoff in P08 | Copy the valid booking/skill link; inspect or revoke an authorized personal-agent connection. Reading a skill document does not connect or authorize a client. |

The proposed host iMessage link flow uses authenticated phone entry, a six-digit code delivered to that private iMessage sender, and verification in the initiating browser. An iMessage-first introduction may lead to authenticated browser linking; it grants no private access by itself. The [implementation plan](../technical_specification/04_implementation_plan.md) assigns this proposed browser/proof flow to the setup and iMessage slices. Implementation, live delivery and actual Google/iPhone acceptance are pending before main-spec promotion.

## Supporting routes and surfaces

| Surface | Purpose and boundary |
|---|---|
| `/auth/callback` | Complete verified host authentication and redirect to an allowlisted relative destination. Invalid/expired state returns a readable sign-in error. |
| `/connections/google/callback` | Complete Calendar consent using a server-bound host or requester transaction, then return to its source page. Never derive the actor or return destination from unchecked query parameters. |
| `/booking/[bookingId]#…` | Exchange the request-bound secret for browser access, remove it from the URL and resume P09. The [meeting-request contract](../../openspec/specs/meeting-requests/spec.md) limits credentials to thirty days, removes mutation/OAuth/recovery authority on closure and permits only minimal terminal receipt reads while the credential remains valid. Recovery requires verified original contact. |
| `/SKILL.md`, `/[handle]/SKILL.md` | Public agent discovery documents. They expose public instructions, supported connection paths and host information only. These are resources, not chat pages. The `/` and `/[handle]` HTML pages make them discoverable: an in-page agent section with the link, `<link rel="alternate" type="text/markdown">`, a root `llms.txt`, and Markdown for `Accept: text/markdown` requests to the same URL. |
| Settings/selection dialogs | Host rule editing and Calendar selection open inside `/app`; iMessage phone/code verification uses inline chat cards. Preserve the conversation and restore focus when closed. |
| Unauthorized, not-found and unavailable views | Reveal no protected request details. At the booking destination, offer the same generic verified-contact recovery controls when access is missing, without disclosing whether the request exists or is recoverable. No token-paste control; closed requests cannot regain authority. |

Reserve `app`, `booking`, `auth`, `connect`, `connections`, `api`, `eve`, `SKILL.md`, `llms.txt`, framework assets and operational routes before resolving a public handle. Provider webhooks, MCP transport, OAuth protocol endpoints and internal agent APIs are backend endpoints, not navigation pages. Final deployment routing must prevent the public handle route from intercepting them.

## Page states and recovery

- Every protected page distinguishes loading, authorized content, expired access, unavailable data and retryable failure. Do not flash cached private content before authorization completes.
- P03 resumes a saved draft after sign-in or consent; Calendar denial and optional iMessage failure do not fabricate readiness or block unrelated edits.
- P09 resolves missing details and no-match results through clarification or alternatives. An unavailable Calendar is not treated as free time. Show explicit timezones and resolve ambiguous daylight-saving times before agreement.
- P03/P09 refresh stale proposals before accepting decisions. Accepted revisions clear outdated decision controls. Duplicate clicks reuse one action identity; an uncertain request outcome triggers status lookup before retry.
- During booking, show that an event may already exist. A requester withdrawal cannot imply cancellation of a dispatched write. Booked requests direct users to their calendar for post-booking changes; automated rescheduling/cancellation is outside scope.
- Model/stream failure preserves draft text, committed messages and structured actions. A confirmed stopped conversation offers **Recover conversation**, separately from **Reconnect now**. Recovery keeps the current discussion and saved controls; it does not approve a meeting or create an extra message. Uncertain responses offer **Retry same recovery** and **Check recovery status**. Reload checks authoritative status; accepted pending text remains readable, while an unsent draft remains in component memory only. Unknown state and exhausted allowance explain why new assistant input cannot continue. Notification failure is distinct from booking failure.
- If conversation access ends, remove protected history and controls while keeping locally typed text in a read-only **Your draft text** panel. Offer **Select draft text** and **Discard draft**; explain that it lasts only on this page and that an uncertain send must be checked before resending.
- On phones and at 200% zoom, keep actions and composer reachable. Use visible focus, meaningful labels, keyboard-operable menus/dialogs, restored focus, restrained live announcements and status text beyond color.

## Scope and acceptance mapping

| Pages | Product coverage | Essential checks |
|---|---|---|
| P01–P03 | FR-01–04, FR-33, FR-35 | Open host sign-in, interrupted setup, explicit settings review, revoked Calendar and ready-only links |
| P08–P09 | FR-05–15, FR-19, FR-23, FR-32, FR-34, FR-36 | Account-free access, scoped continuation, clarification, availability/privacy, current agreement, withdrawal and authorized final receipt |
| P03 | FR-16–23, FR-27–28 | Private/shared separation, exact-proposal decisions, stale/concurrent actions, uncertain booking and channel recovery |
| P03, P10 | FR-24–26, FR-29–31 | Verified channel/client linking, distinct permissions, revocation and browser consent |
| All interactive pages | Chat workspace spec; PRD privacy/reliability | Keyboard/mobile access, authorization, reload, reconnect, model failure and no private cross-user cache |

Requester email and host iMessage are required channels; neither requires a general-purpose messaging inbox page. MCP, CLI and named personal-agent compatibility remain release requirements outside this page inventory, with connection/revocation surfaces included here. Private host email remains a proposed extension, not added scope. Operator suspension, restoration and diagnostics use the administrator CLI and do not require a new public admin dashboard in this design.
