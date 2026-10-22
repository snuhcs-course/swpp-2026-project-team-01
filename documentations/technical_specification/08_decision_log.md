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
| Review bypass | PRs #26 and #27 were squash-merged with `--admin`, without a teammate approval, at the user's request | Waiting for approval | The squash commit messages | Teammates review afterwards using [product decisions](../../openspec/changes/requester-intake-and-feasibility/product_decisions.md) |
| Migration path | The three Phase 3 migrations were pushed to `anelszynxtvxoxqvzgqt` with `supabase db push --linked` from a worktree linked to that project, after a dry run, at the user's approval. The main checkout stays linked to the reserved `mriseqztcwmezvtawnbo` and was not used | The `Deploy shared Supabase` workflow, which fails because its secrets are unset | This log; the acceptance record is still to be updated | Set the workflow's repository secrets so later migrations go through CI |
| Production deploy | `vercel deploy --prod` from a clean checkout of `origin/main`, linked to `findmeatime-release`, after each merge | Git-integrated deploys (not configured) | This log | Connect the Vercel project to the repository if automatic deploys are wanted |

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

### Operational decisions

| Decision | Choice | Alternatives | Recorded in | To change it |
|---|---|---|---|---|
| Lane B as one commit | The three Lane B plan items landed in one commit, because the reservation, the dispatch and reconciliation are one module and one job; the commit also carries the server modules for Lane A's shared changes and exceptions, which the evaluation job imports, and the host discussions' request scope, which the new discussions key requires | Three commits with stubbed halves | This log; the commit message | Split the module if a later change needs it |
| Reference followed for event creation | OpenInstinct `agent/lib/google-workspace/calendar.ts` at `0c2a7c6e`: a 32-hex event ID, `sendUpdates: "all"` with attendees, and `409` read back with `events.get` | Google-assigned IDs | The pull request | — |

### Blocked on the user

None yet.

## Phase 5 — `agent-access`

No decisions yet.

## Phase 6 — `host-imessage-channel`

No decisions yet.

## Phase 7 — `requester-email-channel`

No decisions yet.

## Phase 8 — `operations-and-release`

No decisions yet.
