# Find Me a Time — Decision Log

Status: started in Phase 3; later phases append to their own section\
Date: 2026-10-22\
Companions: [Implementation plan](06_implementation_plan.md), [acceptance record](07_acceptance_record.md)

This log lists every decision point taken while implementing each phase, so that any of them can be revisited later. For each decision it gives the choice, the alternatives considered, where the decision is recorded, and how to change it. The owning documents stay authoritative: a change starts there, in the phase's OpenSpec change and delta specs, and is then reflected here. The "Blocked on the user" section lists steps that were not taken because they are irreversible or can only be done in a provider console.

## Phase 3 — `requester-intake-and-feasibility`

The [proposal](../../openspec/changes/requester-intake-and-feasibility/proposal.md#decisions) records D1–D13, the [design](../../openspec/changes/requester-intake-and-feasibility/design.md) records the reasoning, and [product decisions](../../openspec/changes/requester-intake-and-feasibility/product_decisions.md) is the review checklist. Dohyeon Park decided D1–D13 on 2026-10-21 and 2026-10-22, before teammate review.

### Product decisions

| # | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| D1 | Routes wherever Google returns one, with no country list. Each leg checks the nearest commitment on the same local day, whatever the gap. Estimates are reused for 24 hours | A country allowlist; South Korea only; a 3-hour adjacency horizon | Design 9; `meeting-feasibility` delta "Route estimates, geography and freshness" | Edit both, then `lib/server/routes-client.ts` (`ROUTE_ESTIMATE_TTL_HOURS`) and the adjacency logic in `lib/server/feasibility.ts` |
| D2 | A manual travel allowance covers one leg of one candidate, 5–240 minutes in 5-minute steps, for host and requester legs | Per request and endpoint pair; a standing host rule | Design 10; `meeting-feasibility` delta "Manual travel allowance scope" | Edit both, then `travel_allowances` (schema) and `lib/server/request-proposals.ts` (`request.allow_trip`) |
| D3 | Contact confirmation is optional. The creation email carries the booking link and a confirmation link, and pressing **Confirm this address** confirms it. Resend goes only to a confirmed address. Sends: 60 s apart, 5 per request and 10 per address per hour, 1,000 per day, counting every creation email | Six-digit codes required before attendee use | Design 6; `meeting-requests` delta "Optional contact confirmation", "Recoverable confirmation email" | `CONFIRMATION_LIMITS` in `lib/server/contact-confirmation.ts` |
| D4 | The Cloudflare REST API with an `Email Sending: Edit` token. Evidence is recipient acceptance plus an `X-Fmat-Dispatch-Id` | A Worker relay with the `send_email` binding | Design 5; `email-delivery` delta | `lib/server/cloudflare-email.ts` |
| D5 | `evaluate_candidates` runs as a durable application job; the tool waits up to 20 s | Evaluating inside the eve tool step | Design 8 | `lib/server/evaluation.ts`, `lib/server/request-tools.ts` |
| D6 | Online meetings get a Google Meet with the event when the destination allows it, otherwise a link the requester supplies | A host-saved link; requester links only | Design 11; `meeting-requests` delta "Online meeting link plan" | `lib/server/request-proposals.ts`; Phase 4 creates the conference |
| D7 | Drafts and requests: 5 per source per hour, 20 per day, 500 per day service-wide, no per-host cap | A per-host cap of 30 a day; looser numbers | Design 2; `meeting-requests` delta "Bounded request creation" | `CREATION_LIMITS` and `DRAFT_LIMITS` in `lib/server/request-start.ts` |
| D8 | Requester Google consent requests calendar-list and read-only event scopes, used privately for busy rules and the requester's own travel. The button is always shown. Grants are delete-only and reuse the host OAuth client by default (2026-10-22) | Free/busy only; hiding the button until publication; revoking at Google on closure with a separate client | Design 3; `requester-calendar-access` delta; PRD FR-12 and §5 | Scopes in `lib/server/requester-google.ts`; client fallback in it and in `lib/server/requester-calendar.ts`; closure in `lib/server/requester-grants.ts` |
| D9 | Local messaging sends only toward a loopback stand-in | Admitting local sends; denying them entirely | Design 13; `messaging-environments` delta | `messagingAdmitted` in `lib/server/messaging.ts` |
| D10 | The booking link is looked up by hash and kept as a sealed copy | Rotating the link on every resend | Design 7; `meeting-requests` delta "Protected request continuation" | `lib/server/booking-links.ts` |
| D11 | An assistant conversation on `/{handle}`, at first under a separate anonymous intake. Revised by D13 | A static intake page | Design 2 | See D13 |
| D12 | Verification before agreement. Withdrawn by D3 | — | Proposal | — |
| D13 | One guest thread from the first message. The message creates a hidden draft request, deleted after 24 h if the guest never identifies. One assistant session runs to agreement. Every card sits inside the thread, with one actionable card at a time. The address bar changes to `/booking/{id}` in place on identification | Stitching a separate intake session to the request | Design 2 and 12; `meeting-requests` delta "Continuous guest conversation"; `chat-workspaces` delta | `lib/server/request-start.ts`, `lib/server/guest-thread.ts`, `apps/web/app/_components/guest/guest-workspace.tsx` |

### Implementation decisions

| Decision | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| Anonymous model spend | A request with no confirmed contact and no Google identity, drafts included, gets USD 3 per 24 h and counts toward a USD 50 anonymous pool | Full USD 30 for every request | Design 2; `meeting-requests` delta | `MODEL_LIMITS` in `lib/server/model-limits.ts` (`anonymousPrincipalWindowUsd`, `anonymousWindowUsd`) |
| Draft message cap | 30 messages before identification | No cap; a model-spend cap only | Design 2 | `DRAFT_LIMITS` in `lib/server/request-start.ts` |
| Evaluation bounds | A running evaluation at the same revisions is reused. At most 10 new evaluations per request per hour, travel checked for up to 40 candidates, and ranking of the first 20 | Unbounded | Design 8; `meeting-feasibility` delta "Bounded evaluations per request" | `EVALUATIONS_PER_HOUR` and `RANKING_LIMIT` in `lib/server/evaluation.ts`; `CANDIDATE_LIMIT` in `lib/server/feasibility.ts` |
| Shared deadline | 18 s across token refresh, Calendar, Routes and ranking | — (set by the main spec) | `meeting-feasibility` main spec | `EVALUATION_DEADLINE_MS` in `lib/server/evaluation.ts`, after changing the spec |
| Conversation admission | 20 per minute and 100 per hour per host or request; 200 per minute and 2,000 per hour service-wide | — (set by the main spec) | `chat-workspaces` main spec | `ADMISSION_LIMITS` in `lib/server/conversation-admission.ts`, after changing the spec |
| Link resend | 1 per minute and 5 per hour per request, 5 per hour per recipient, 120 per minute and 600 attempts per minute service-wide. The public answer is constant and the matching is queued | — (set by the main spec) | Design 7 | `LINK_RESEND_LIMITS` in `lib/server/link-resend.ts` |
| Revisions | Choosing a time, the automatic move to negotiating and identification do not advance the request revision; pending reviews follow identification | Advancing on every change | Design 4 and 12 | `lib/server/request-proposals.ts`, `lib/server/request-lifecycle.ts`, `lib/server/request-start.ts` |
| Details while awaiting the host | Locked once the requester agrees | Editable with fresh agreement | Product decisions | `lib/server/request-reviews.ts` |
| Weekly limit | Orders candidates only. Every candidate is offered even when all fall in full weeks | Holding them back until the host waives the limit (main spec "Only full weeks"), which needs Phase 4 | Product decisions | `lib/server/feasibility.ts`; resolve against the main spec before archive |
| Identity card trigger | A requester tool `ask_for_identity` records when identity was asked for. The card also appears on `identity_required` and at the message cap | A flag on `draft_request_review` | Design 12 | `agent/tools/request.ts`, `lib/server/guest-thread.ts` |
| Skip for now | Stored on the request (`calendar_settled_at`) | Per tab | Design 12 | `request.set_manual_availability` |
| Redaction | Removes bearer values of at least 8 characters with a digit or punctuation, linking proofs, credential URL parameters, booking links, and bare UUIDs in guest input | Removing every bearer word; removing bare UUIDs everywhere | Design 14 | `lib/server/redaction.ts` |
| Cloudflare 429 | Recorded as rejected, not uncertain | Uncertain, with no resend | Design 5 | `lib/server/cloudflare-email.ts` |
| Eval-only auth | `createEvalRequesterAuth` admits stubbed requester evals only with `FMAT_EVAL_AUDIENCE=requester`, outside Vercel, inside `eve dev` | No offline evals | Agent configuration | `lib/server/eve-auth.ts` |
| Ranking model | `gpt-5.6-terra` through the model limits; live quality untested | Another model | Design 8 | `lib/server/evaluation.ts` |
| Retired intake | Intake tables and `public_intake` values kept so the earlier test request still shows its transcript; nothing new is written | Dropping them now | Design 2 | A later migration drops `intakes` once no open request refers to one |

### Operational decisions

| Decision | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| Review bypass | PRs #26, #27 and #28 were squash-merged with `--admin`, without a teammate approval, at the user's request | Waiting for approval | The squash commit messages | Teammates review afterwards using [product decisions](../../openspec/changes/requester-intake-and-feasibility/product_decisions.md) |
| Migration path | The five Phase 3 migrations went to `anelszynxtvxoxqvzgqt` with `supabase db push --linked`, each time after a dry run and with the user's approval, from a worktree linked to that project: three after PR #26 on 2026-10-22, and `guest_draft_requests` and `guest_calendar_step` after PR #28 on 2026-10-22. The main checkout stays linked to the reserved `mriseqztcwmezvtawnbo` and was not used | The `Deploy shared Supabase` workflow, which fails because its secrets are unset | This log; [acceptance record](07_acceptance_record.md#production-deployment-2) | Set the workflow's repository secrets so later migrations go through CI |
| Production deploy | `vercel deploy --prod` from a clean checkout of `origin/main`, linked to `findmeatime-release`, after each of PRs #26, #27 and #28; the guest-thread code went live only after its migrations | Git-integrated deploys (not configured) | This log; [acceptance record](07_acceptance_record.md#production-deployment-2) | Connect the Vercel project to the repository if automatic deploys are wanted; until then, push migrations before deploying a change that needs them |

### Blocked on the user

These steps were not taken because they need a provider console, a person's own account or a real inbox, or because they cannot be undone:

- **Google Cloud Console:** the three `/connections/google/callback` redirect URIs and the `calendar.events.readonly` scope were added on 2026-10-22, and the redirect URIs check out from outside. **Still open:** confirm that the **Routes API** is enabled for `GOOGLE_MAPS_API_KEY`, and submit Google app verification for the sensitive Calendar scopes.
- **Cloudflare sender verification:** the Email Sending DNS records for `findmeatime.com` exist, but no message has been sent to a controlled inbox yet.
- **Phase 3 production evidence (task 7.1):**
  - the creation email and confirmation, and a resent link, in a team-controlled inbox;
  - the flow up to agreement;
  - **Continue with Google** with a test user (AC-27);
  - keyboard and phone-width checks;
  - recording all of it in the [acceptance record](07_acceptance_record.md).
- **Live Seoul routing check (task 5.2)** and **real-model evals (task 6.4):** they cost money and were not run without the user's go-ahead.
- **Teammate review** of D1–D13 and of the implementation decisions, then `openspec archive` of the change.
- **Shared-project data:** the earlier test intake and request remain. Deleting them is a data change on the shared project and was not done.

## Phase 4 — `host-review-and-booking`

The [proposal](../../openspec/changes/host-review-and-booking/proposal.md#decisions) records D1–D12. The implementing session took them on 2026-10-22, under the user's instruction to log every decision and keep it changeable; none has had teammate review yet.

### Product decisions

| # | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| D1 | The event is created with the host's own Google grant in the host's confirmed booking destination calendar, so the organizer is that calendar's owner as Google reports it. The requester is the only attendee | A service-owned calendar that invites both parties | Proposal | The proposal and the event builder |
| D2 | A booking still unconfirmed 15 minutes after its first dispatch sends the requester one "still in progress" email | 5 minutes; 1 hour | Proposal | The proposal |
| D3 | Reminders are deferred: no reminder or follow-up email from the service; the event keeps the calendar's default reminders | A service reminder email 24 hours before | Proposal; PRD section 10 | The proposal, then a new job and template |
| D4 | The event ID is derived from the booking ID and stored before dispatch, so Google refuses a second insert and reconciliation reads the event by ID | Google-assigned IDs | Proposal | The proposal and the event builder |
| D5 | Google sends its own invitation (`sendUpdates=all`); our confirmation email follows | `sendUpdates=none` with only our calendar part | Proposal | The proposal and the event builder |
| D6 | The host's **Shared** view is the requester conversation, read-only, with the proposal and status; the host acts there only through cards | Relaying host messages into the requester thread | Proposal | The proposal and the host request view |
| D7 | **Request changes** and `propose_shared_changes` create one pending suggestion; **Share revised details** applies it, checks the time and writes the next proposal version | Sharing without a feasibility check | Proposal | The proposal and the shared-changes module |
| D8 | When every candidate falls in a full week, nothing is offered until the host waives the weekly limit for the request or the requester widens the window (main spec "Only full weeks"); replaces Phase 3's ordering-only behavior | Keeping ordering only | Proposal | The proposal and the requester projection in the evaluation job |
| D9 | After dispatch may have begun, the job only reconciles by event ID and re-inserts the frozen payload under the same ID; no feasibility revalidation; 8 attempts, then **Booking in progress** with **Check booking status** | Revalidating before every retry | Proposal | The proposal and the booking job |
| D10 | Both parties get a confirmation. Requester's Reply-To: the host's Google email; host's Reply-To: the requester's contact address, confirmed or not | Reply-To only after confirmation | Proposal; `email-delivery` delta | The proposal and the confirmation builder |
| D11 | Status emails go to the requester's contact address, confirmed or not | Confirmed addresses only | Proposal; `email-delivery` delta | The proposal and the notification module |
| D12 | The host opens a request at `/app?request={requestId}`; the booking UUID never reaches the host | `/app?request={bookingId}` as the interfaces document said | Proposal; interfaces | The proposal and the host workspace |

### Implementation decisions

| Decision | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| Revalidation scope | Booking revalidation rechecks the host side only: fresh host Calendar reads, route estimates under an hour old, the host's other dispatching and confirmed bookings as busy. The requester's calendar is not read again, since they agreed to the time | Rereading the requester's calendar, which would block a booking on a requester read failure | Design 6 | `checkInterval` options in `lib/server/bookings.ts` (`requesterCalendar: false`) |
| Booking locks | The request row, then a per-host advisory lock `app.booking_host:{hostId}`, held across revalidation (up to 18 s) and the dispatch mark | No host lock, relying on the calendar alone | Design 6 | `lockHost` in `lib/server/bookings.ts` |
| Booking attempts | 8 attempts with the queue's doubling backoff, then **Booking in progress** until **Check booking status**; at most 3 booking jobs per worker batch | Unlimited retries | Design 7 | `BOOKING_ATTEMPTS` in `lib/server/bookings.ts`; `JOB_BATCH_LIMITS` in `lib/server/job-handlers.ts` |
| Repeated approval | A second approval of the same version, with any retry key, returns the live booking | Rejecting it as stale | `calendar-booking` delta | `approveCommand` in `lib/server/bookings.ts` |
| Stale decision at booking | An approval or agreement that no longer names the latest version fails the booking as `stale_decision` and returns the request to awaiting approval | Treating it as a conflict | Design 7 | `claimBooking` in `lib/server/bookings.ts` |
| Unknown errors after dispatch | A failed token refresh or transport error after the dispatch mark is treated as uncertain and reconciled, never as "not sent" | Treating it as definitive | Design 7 | `write` in `lib/server/bookings.ts` |
| Event ID constraint | `^[0-9a-v]{5,}$` with a length check of at most 1024, because Postgres regular expressions cap repetition counts at 255 | `{5,1024}` in the pattern | `supabase/schemas/app/tables/bookings.sql` | The schema file and a new migration |
| New error category | `booking_pending` for a withdrawal, decline or change after dispatch may have begun | Reusing `request_closed` | `lib/contracts/command-errors.ts` | The contract and the route status maps |
| Notices without a link | A status email or confirmation is not recorded when the requester's sealed booking link cannot be opened (a retired key), so the domain change still commits | Failing the change | `lib/server/booking-notices.ts` | `requesterBookingUrl` there |
| Shared-change check | A shared suggestion is checked by an ordinary evaluation job with a fixed interval, whose one candidate becomes the next proposal | A separate check job | Design 4 | `settleSharedChange` in `lib/server/shared-change-settle.ts`; the `interval` payload in `lib/server/evaluation.ts` |
| Host discussion scope | `/api/chat/*` takes an optional `request` (a UUID); another host's request, a draft, an unknown or malformed ID all answer 404 `request_unavailable` | A separate `/api/host/requests/{id}/messages` route | Design 2 | `requestScope` in `lib/server/chat-routes.ts`; `lockHostDiscussion` in `lib/server/conversations.ts` |
| Host-review admission | Host-review messages count against the same per-host admission windows as setup | Separate windows per request | Design 2 | `recordInput` in `lib/server/conversations.ts` |
| Host model projection | The requester's name and purpose reach the model as quoted strings, contact email as `present`, times in the host's timezone | Raw values | Design 12 | `hostModelProjection` in `lib/server/host-review-tools.ts` |
| Request view navigation | The menu gains **Requests**; `/app?view=requests` is the inbox and `/app?request={requestId}` a request, inside the same `/app` page. An unknown or foreign request returns to the inbox with "That request is not available." | Separate `/app/requests` routes | Design 3; page list | `HostWorkspace` in `apps/web/app/_components/host-workspace.tsx` |
| Discussion switch | Two tabs, **Private with Thyme** and **Shared with {requester}**, switched with the arrow keys; the shared tab is the requester history read from its recorded events, not followed live | A live-following shared view | Design 2 | `RequestView` and `SharedConversation` in `apps/web/app/_components/host/host-requests.tsx` |
| Open card order | One actionable card: a pending or checking suggestion, then a booking in flight or a retryable failure, then the rule and travel review while it has a hold or an unresolved trip, then the proposal review | Showing every card at once | Design 3 | `nextHostStep` in `apps/web/app/_components/host/host-request-cards.tsx` |
| Suggestion editor | Times entered in the host's zone, durations of 15 to 480 minutes in 5-minute steps; a skipped local time is refused in the browser and a repeated one takes the earlier instant | Free-text times | Design 4 | `SuggestionEditor`; `instantFromLocal` in `lib/contracts/timezone.ts`; `sharedChangesSchema` in `lib/server/shared-changes.ts` |
| Settling poll | The request view polls every 3 s while a booking, a suggestion check or an evaluation is pending | Push updates | Design 3 | `SETTLING_POLL_MS` in `host-requests.tsx` |
| Requester while booking | The thread's status line becomes **Booking in progress** with **Check booking status**; a booked request's link shows only the status and the receipt in the requester's timezone | Keeping the conversation open after booking | Design 10 | `AwaitingLine` in `apps/web/app/_components/requester/cards.tsx`; `Closed` in `apps/web/app/booking/[bookingId]/page.tsx` |
| Email reply line | The confirmation says that replying reaches the other participant, instead of a support address, since none is decided | A support address | Design 9 | `LABELS` in `lib/server/booking-emails.ts` |
| Host copy language | The host's confirmation is in English, in the host's timezone | The requester's language | Design 9 | `enqueueConfirmations` in `lib/server/booking-notices.ts` |

### Operational decisions

| Decision | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| Lane B as one commit | The three Lane B plan items landed in one commit, because the reservation, the dispatch and reconciliation are one module and one job; the commit also carries the server modules for Lane A's shared changes and exceptions, which the evaluation job imports, and the host discussions' request scope, which the new discussions key requires | Three commits with stubbed halves | This log; the commit message | Split the module if a later change needs it |
| Lane A cards as one commit | The selection cards and switch, the proposal and suggestion cards and the rule and travel review landed together, since they share one view, one card module and one browser test | Three commits | This log | — |
| Reference followed for event creation | OpenInstinct `agent/lib/google-workspace/calendar.ts` at `0c2a7c6e`: a 32-hex event ID, `sendUpdates: "all"` with attendees, and `409` read back with `events.get` | Google-assigned IDs | The pull request | — |

### Blocked on the user

These steps were not taken because they cannot be undone by a revert, need a provider console, or send to people outside the team:

- **Shared-project migration:** `20261022021159_host_review_and_booking.sql` is not on `anelszynxtvxoxqvzgqt`. It needs a shown dry run, then the deploy workflow or `supabase db push --linked` with the user's approval. All 21 earlier migrations, Phase 3's included, are already applied there (acceptance record, Phase 3), so it is the only pending one; push it before deploying this branch.
- **Production deploy** of this branch once merged.
- **Controlled Google Calendar evidence:** a booking in a team-controlled Google Calendar. `sendUpdates=all` makes Google email the attendee, so the requester address must be a team inbox.
- **Controlled inbox evidence:** both confirmation copies and a status email in team inboxes, including whether the `text/calendar` attachment shows as an invitation in Gmail and Outlook.
- **Merge:** the pull request needs a teammate's approval; no admin bypass was used.
- **Teammate review** of D1–D12 and the implementation decisions, then `openspec archive` of the change.

## Phase 5 — `agent-access`

No decisions yet.

## Phase 6 — `host-imessage-channel`

No decisions yet.

## Phase 7 — `requester-email-channel`

The [proposal](../../openspec/changes/requester-email-channel/proposal.md#decisions) records D1–D11; the plan assigns D1–D4 to this phase and the design raised D5–D11. The implementing session took them on 2026-10-22, under the user's instruction to log every decision and keep it changeable; none has had teammate review yet.

### Product decisions

| # | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| D1 | A custom eve channel, `agent/channels/agentmail.ts`, hosts only the signed receiver. The application job forwards verified text as an accepted input of the request's existing requester discussion, so email and web share one session | The Chat SDK bridge (a Gmail adapter, no AgentMail adapter); a channel-owned eve session per thread | Proposal; design 1; agent configuration | The proposal and design 1, then the channel and `lib/server/email-receipts.ts` |
| D2 | One product inbox, `findmeatime@agentmail.to`, for every host and request. A new thread names its host by `@handle` in the subject; the public host page offers a prefilled `mailto:` link | An inbox per host (three at most, irreversible per host); an inbox per request; plus-addressing (undocumented) | Proposal; design 2; provider setup | `AGENTMAIL_INBOX_ID`, and the handle parsing in `lib/server/email-receipts.ts` |
| D3 | A link code binds only as the first message of a new thread from the confirmed contact with authenticated sender evidence before it expires; any other arrival voids it silently. A bound thread forwards only its bound address. Booking links and codes are redacted before the model | Binding on the From address alone | Proposal; design 5; `requester-email-threads` delta | The proposal, then `lib/server/email-receipts.ts` and `lib/server/redaction.ts` |
| D4 | Receipts kept 30 days with locators and a payload hash only; bindings stop on closure and are deleted 30 days after the request's creation; final replies hold no text or secret. Provider-side threads stay in AgentMail until Phase 8 | Keeping receipts indefinitely; deleting provider threads now | Proposal; design 9; `requester-email-threads` delta | `app.cleanup_email_records` in the schema and a new migration |
| D5 | A message counts only as a `message.received` without the `unauthenticated` or `spam` labels whose `authentication_results` show `dmarc: pass`, or `dkim: pass` with `dkim_domain` equal to the From domain | Trusting the From header; AgentMail's label alone | Proposal; design 5; `requester-email-threads` delta | `senderAuthenticated` in `lib/server/agentmail.ts` |
| D6 | An authenticated new thread naming a ready host creates an identified request: the sender's name and address as unconfirmed contact, the host's timezone, Korean when the text has Hangul; the Phase 3 creation email follows. Creation bounds count per keyed sender hash | A draft that waits for identity, which email cannot collect | Proposal; design 3; `meeting-requests` delta | `startByEmail` in `lib/server/email-receipts.ts` |
| D7 | **Continue by email** needs a confirmed contact. Code `FMAT-` plus ten Crockford base32 characters, valid 30 minutes, hashed and sealed, at most 5 per request per hour; binding replaces the earlier thread; the linking message never reaches the model | Codes without a confirmed contact; longer validity | Proposal; design 4; `meeting-requests` delta | `EMAIL_LINK_LIMITS` in `lib/server/email-links.ts` |
| D8 | One plain-text reply per forwarded message after its turn ends, with the turn's final text, frozen first and sent with `Idempotency-Key` equal to the reply ID; an uncertain dispatch is retried with the same key for 23 hours, then recorded uncertain | Streaming partial replies; replying without an idempotency key | Proposal; design 6; `email-delivery` delta | `REPLY_RETRY_HOURS` in `lib/server/email-replies.ts` |
| D9 | **Unlink email** ends the binding in the database only, so it works during an AgentMail outage | Notifying the thread on unlink | Proposal; design 4 | `request.email_link.unlink` in `lib/server/email-links.ts` |
| D10 | The operator CLI registers a receiver with the secret's fingerprint and disables the inbox's previous one; the webhook URL carries the receiver ID; creating the webhook at AgentMail stays an operator step | One unversioned webhook URL | Proposal; design 1; `requester-email-ingress` delta | `email-receiver` commands in `lib/server/operator.ts` |
| D11 | Over-long messages and closed requests get one fixed reply; attachments are never fetched; our own messages are ignored; admission limits delay a receipt instead of dropping it | Truncating long messages; dropping mail at the limit | Proposal; design 5 | `lib/server/email-receipts.ts` |

### Implementation decisions

| Decision | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| Signature verification | Svix's scheme written in `lib/server/svix.ts` (HMAC-SHA256 over `{id}.{timestamp}.{body}`, any listed `v1` signature, five-minute window) | The `svix` package, a new dependency for one function | Design 1 | `verifySvixSignature` in `lib/server/svix.ts` |
| Where the receiver runs | The agent service, as the custom channel's route; `vercel.ts` routes `^/agentmail/(.*)$` to the generated `eve` service before the web catch-all | A Next.js route in the web service | Design 1 | `vercel.ts` and `agent/channels/agentmail.ts` |
| Refusal codes | An unknown, disabled, replaced or re-keyed receiver, an unconfigured deployment or another inbox's message answer `404`; a bad or stale signature `401`; an over-large body (256 KiB) `413`; a changed retry `409`; other event types `204` | Distinguishing a disabled receiver from an unknown one | `lib/server/agentmail-receiver.ts` | `receiveAgentMailWebhook` there |
| Receipt identity | The provider `event_id`, with the delivery and message IDs also unique; a duplicate must match event, inbox, thread, message and payload hash, so a second subscription's delivery of the same event is still a duplicate | Keying on the Svix ID, which differs per subscription | `email_receipts` schema | `storeReceipt` in `lib/server/agentmail-receiver.ts` |
| Receipt job attempts | 10, so an admission window or an AgentMail outage delays a message by up to about three hours of backoff before the job is left exhausted and visible | The default 5 | `lib/server/agentmail-receiver.ts` | `EMAIL_RECEIPT_ATTEMPTS` |
| Receiver audit | The receiver rows themselves record who registered and disabled each one and in which environment; registration takes a per-inbox advisory lock | A separate audit table | `email_receivers` schema; `app.operator_register_email_receiver` | The schema and a new migration |
| Forwarding path | The receipt job forwards through `acceptGuestMessage` with the receipt ID as the client input ID, so redaction, admission, the session index and model limits apply as on the web, and a retried job finds the same input | A separate email input path | `lib/server/email-receipts.ts` | `forward` there |
| Binding and creation first | Starting by email creates, identifies and binds in one committed transaction under a per-thread advisory lock before the message is forwarded; a retry recognizes its own binding by `bound_by_receipt_id` | Creating the request inside the job's transaction, which the conversation path's own connection cannot see | `email_threads` schema | `start` in `lib/server/email-receipts.ts` |
| Email request defaults | The host's timezone (UTC when unset) and Korean when the subject or text contains Hangul, otherwise English; the name is the From display name, else the address's local part | Asking for a timezone by email first | Design 3 | `start` and `messageLanguage` in `lib/server/email-receipts.ts` |
| First message text | `Subject: …` and a blank line before the extracted new text, so the subject's meaning reaches the assistant | Dropping the subject | `lib/server/email-receipts.ts` | `forward` there |
| Turn reply timing | The reply job is due 30 seconds after forwarding and retries while the turn runs; the session-owner hook brings it forward when the turn ends, and the per-minute sweep sends it. 12 attempts, then a waiting reply is suppressed | A reply sent from the hook itself, which runs in the agent service and cannot fail a turn | Design 6 | `TURN_REPLY_DELAY_SECONDS` and `REPLY_ATTEMPTS` in `lib/server/email-replies.ts`; `agent/hooks/session-owner.ts` |
| Reply text | The turn's `message.completed` texts that do not end in tool calls, joined, then a two-line footer pointing to the booking link sent by email; 20,000 characters at most | Streaming every interim message | Design 6 | `turnReplyText` and `withFooter` in `lib/server/email-replies.ts` |
| Reply answers | `200` with a message ID is accepted; `409` (key reused with other text) is recorded uncertain at once; `429`, `5xx`, timeouts and lost responses retry with the same key; other `4xx` are rejected | Treating `429` as a refusal | `lib/server/agentmail.ts` | `classifyReplyResponse` there |
| Gate placement | Both email jobs check messaging admission before reading any receipt or reply, as well as in the worker's claim and in every transport call | Checking only in the transport | `lib/server/email-receipts.ts`, `lib/server/email-replies.ts` | The handlers |
| Link codes in text | Redaction removes `FMAT-` codes from every conversation input, host and requester alike | Redacting them only in email | `lib/server/redaction.ts` | `LINK_CODE` there |
| Instruction | One requester-instruction line: email replies show no cards, so the assistant names the card and says it is on the booking page, never writing a link | A separate email audience | `agent/instructions/requester.ts` | The fragment |
| Linking commands | `request.email_link.create` and `request.email_link.unlink` run on the booking page's existing commands route; `GET /api/requests/{bookingId}/email-link` serves only the status. The saved command outcome holds the link ID, never the code | A separate POST route per action | Design 4 | `requesterCommands` and `createEmailLinkStatusHandler` in `lib/server/requester-routes.ts` |
| Pending before linked | A pending code is shown even while another thread is linked, so sending it moves the conversation; **Cancel** on the code passes `pendingOnly` and keeps the linked thread | Hiding codes while linked | Design 4 | `readEmailLinkStatus` and `unlinkEmailCommand` in `lib/server/email-links.ts` |
| Unconfirmed contact | Creating a code answers `invalid_input`; the card says to confirm the address first and shows no button | A new error category | Design 4 | `createEmailLinkCommand` in `lib/server/email-links.ts`; `EmailLinkLine` in `apps/web/app/_components/requester/cards.tsx` |
| Card placement | **Continue by email** is a quiet line under the status line; the pending code opens as one conversation card with **Open email**, **Copy**, **Check email link** and **Cancel**; a lost command answer shows **Retry same linking action** with the same retry key | A standing settings panel | Design 4; DESIGN.md conversation card | `EmailLinkLine` |
| Email start on the public page | "Prefer email? Write to {inbox}" with a `mailto:` whose subject is `Meeting with @{handle}`, shown only when `AGENTMAIL_INBOX_ID` is set | Showing it always | Design 2 | `apps/web/app/[handle]/page.tsx` |
| Link confirmation text | "This thread is now linked to your request with {host}. Reply here to continue." in the request's language | Echoing the code | `lib/server/email-links.ts` | `CONFIRMATION` there |
| Thread notice copy | `enqueueStatusNotice` records one thread reply per notice and binding, from the email's template and parameters, replying to the binding's latest message, with the booking link sealed until dispatch; the confirmation email stays Cloudflare-only | Sending the confirmation into the thread too | Design 7 | `enqueueStatusNotice` in `lib/server/booking-notices.ts` |
| Notice currency | A thread notice is checked at dispatch by the same rule as its email (`noticeStillCurrent`), and suppressed when its binding is no longer active | Checking only the binding | Design 7 | `noticeStillCurrent` in `lib/server/email-delivery.ts`; `createEmailReplyHandler` |
| Codes in bound threads (review) | A code binds only an unbound thread. In a bound thread, where a reply's `Re:` subject or quoted text repeats the linking code, a still-pending code is voided and the message is forwarded with codes redacted; the binding message itself is never forwarded on a retry | Treating every code as a linking attempt, which dropped every reply after linking | Design 5 | `processReceivedMessage` in `lib/server/email-receipts.ts` |
| Notice text at rest (review) | A notice stores no rendered text while dispatching; each send renders it again from the sealed parameters, giving the same payload for the same key | Freezing the rendered text, which held a usable booking link for up to 23 hours | Design 6 | `renderNotice` in `lib/server/email-replies.ts` |
| Failed sessions and redaction (review) | A turn reply whose session failed for good sends the fallback at once (the hook wakes it); turn text is redacted before it is sent | Waiting out the attempts and suppressing it | Design 6 | `turnText` and `wakeTurnReplies` in `lib/server/email-replies.ts` |
| Exhausted receipts and ordering (review) | Exhausted receipts are recorded ignored, and a thread their message started gets one fixed reply; a reply that overtakes its thread's unprocessed first message retries; non-retryable input refusals are ignored | Leaving the outcome empty | Design 5 | `createEmailReceiptHandler` in `lib/server/email-receipts.ts` |
| Auto-replies and DMARC alignment (review) | `Auto-Submitted`, `Precedence: bulk/junk/list/auto_reply` and `X-Autoreply` are ignored; a DMARC pass counts only when `dmarc_domain`, if given, is the From domain | Relying on admission limits against reply loops | Design 5 | `autoSubmitted` in `lib/server/email-receipts.ts`; `senderAuthenticated` in `lib/server/agentmail.ts` |
| Retention completeness (review) | The cleanup also voids expired pending codes and deletes non-final replies and any-state links past 30 days | Final-state rows only | Design 9; migration `20261022143811_email_review_fixes.sql` | `app.cleanup_email_records` |
| Linking lock order (review) | Linking locks the request before the link row, as the card's commands do | Link row first, which could deadlock against **Continue by email** or **Cancel** | `lib/server/email-links.ts` | `bindByCode` |
| Receiver input (review) | The webhook body is read as a stream with the 256 KiB cap, and the inbox ID is compared case-insensitively | Trusting `Content-Length` | `lib/server/agentmail-receiver.ts` | `readBody` and `receiverConfigFromEnvironment` |

### Operational decisions

| Decision | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| Local stack | This branch's tests ran on a separate local Supabase stack (`project_id` `fmat-phase7`, ports 553xx, selected with `SUPABASE_WORKDIR` and `TEST_DATABASE_URL`), because the Phase 5 session shares the default local stack and a `db reset` with this branch's migrations would break its runs | Resetting the shared default stack | This log; the acceptance record | — (local only) |
| References followed | eve memory agent template at `7fa24384`: `agent/lib/integrations/slack/{channel,identity}.ts` with their tests and `agent/lib/testing/slack.ts` (identity resolved in application code before any turn, unverified or self-authored messages dropped with no fallback principal, typed fixtures for tests). eve chat template at `3c25e62d`: `agent/channels/slack.ts` (a one-file default-export channel) | — | The pull request | — |
| Lane A test fix | The Lane A pgTAP test, written before the receivers' `environment` column, was fixed in the first Lane B commit | Amending the Lane A commit, which rewrites history | The Lane B commit message | — |
| Independent review | A separate reviewer agent read the branch before the pull request; its high finding (replies after linking dropped) and the confirmed medium and low findings were fixed in one commit with regression tests and one new migration | Opening the pull request first | This log (rows marked "review"); the fix commit | — |

### Blocked on the user

These steps were not taken because they cannot be undone by a revert, need a provider console, or send to people outside the team:

- **AgentMail inbox:** `findmeatime@agentmail.to` is not created; the account is at its three-inbox limit, and freeing or creating an inbox is irreversible.
- **AgentMail webhook:** no webhook is registered at AgentMail, and no receiver is registered in the shared project.
- **Shared-project migration and production deploy** of this branch.
- **Real multi-turn inbox delivery** with a team-controlled address (the Phase 7 evidence), which needs the inbox, the webhook and the deploy.
- **Teammate review** of D1–D11, then `openspec archive` of the change.

## Phase 8 — `operations-and-release`

No decisions yet.
