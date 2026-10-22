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

No decisions yet.

## Phase 5 — `agent-access`

No decisions yet.

## Phase 6 — `host-imessage-channel`

No decisions yet.

## Phase 7 — `requester-email-channel`

No decisions yet.

## Phase 8 — `operations-and-release`

No decisions yet.
