# Design

## Context

See [proposal.md](proposal.md). Phases 1 and 2 left these pieces to build on:

- a private `app` schema reached only by server code as the owner role, with row-level security and no client grants;
- `discussions` that already admit a `requester_request` principal, the application session index, `appAuth` with an `audience` attribute, and eve sessions created only by application routes;
- the command pipeline (`runCommand`), durable jobs with a production-only worker and `npm run jobs:dev` locally, model limits reserved per host account or requester request, and the messaging gate in `lib/server/messaging.ts`;
- confirmed `host_settings` (timezone, weekly windows including overnight ones, duration, buffers, weekly limit, note-like exclusions, mode, location, transport, extra travel buffer, conflict calendars and booking destination), the readiness guard and handles;
- the host Google Calendar client in `lib/server/google-calendar.ts`, built from the stored grant with injectable base URLs;
- sealed tokens (`sealToken`, `openToken`) keyed by `TOKEN_ENCRYPTION_KEY`, and the keyed source hash used for sign-up bounds.

Before designing each module, read the reference files the plan names for Phase 3: the Vercel chatbot's composer, greeting, suggested actions and their browser tests; the eve chat template's `rate-limit.ts` and `chat/limits.ts`; iteration 1's F02 normalization, F08 symmetric travel legs, F09 code-computed basis sentences and the idempotent operation hook; and cal.diy's booking page and timezone screens, for design only. The pull request names the revisions.

## Goals / Non-Goals

**Goals:** a requester opens `/{handle}`, talks to the assistant, continues with or without Google, describes the meeting in English or Korean, reviews extracted details, can confirm their address from the creation email, sees feasible candidates, chooses one and agrees to the exact proposal version; the request then waits for host approval. Withdrawal and expiry close it. Conversation admission and credential redaction protect every conversation.

**Non-goals:** host review, approval, booking, the confirmation email and requester status notifications (Phase 4); the host's manual allowance and exception controls (Phase 4); MCP and CLI requester access and the one-future-request grant (Phase 5); requester email (Phase 7); messaging receipts (Phases 6 and 7).

## Decisions

Decisions D1–D12 in the proposal were decided on 2026-10-21; D12 was withdrawn by D3. The sections below design the chosen options and record the rejected ones.

### 1. Records

| Table | Holds | Authoritative for |
|---|---|---|
| `intakes` | Host, hash of the intake token, keyed source hash, the intake discussion, the structured draft (purpose, duration, mode, location, windows, timezone, language), `created_at`, `expires_at` (24 hours), the request it became | One anonymous intake conversation before a request exists |
| `requests` | Host, state, `revision`, details JSON (purpose, duration, mode, location or link plan, windows, requester timezone, language, requester travel mode), requester display name and contact email, `contact_confirmed_email`, `created_at`, `expires_at`, `closed_at` | The request and its lifecycle |
| `booking_links` | SHA-256 of the booking UUID (the lookup key), the UUID sealed with `TOKEN_ENCRYPTION_KEY`, request, `created_at`, `expires_at` (creation plus 30 days) | The requester credential. The sealed copy is opened only to resend the link or to finish the requester's Google return (decision 7) |
| `request_creations` | Keyed source hash, host, time | Creation bounds; deleted after 24 hours |
| `requester_oauth_transactions` | Hash of `state`, hash of the browser binding, PKCE verifier sealed, purpose (`intake` or `request`), host, the request for an existing request, the intake draft (purpose text, timezone, language), `expires_at` (10 minutes), `consumed_at` | One Google consent round trip |
| `requester_grants` | Request, kind (`identity` or `calendar`), Google subject hash, granted scopes, sealed refresh token (calendar only), selected calendar IDs, `revoked_at`, `provider_revocation` (always `not_needed`: closing deletes the token and never calls Google) | Request-bound Google grants. Requester event contents are read inside an evaluation and never stored |
| `request_reviews` | Request, the base revision, declared intent, the patch, authored clarifications, state (`pending`, `applied`, `superseded`, `rejected`) | Extracted changes awaiting explicit application |
| `proposals` | Request, version number, exact shared details (start and end instants, display timezones, duration, participants, mode, location or link plan), the evaluation it came from, `created_at` | Immutable proposal versions |
| `agreements` | Proposal, request revision, retry identity, `agreed_at` | Requester agreement to one version |
| `evaluations` | Request, the request and settings revisions it read, state (`pending`, `completed`, `incomplete`, `failed`), deadline, candidates with their bases, the requester projection, the ranking, failure category | One feasibility run |
| `travel_allowances` | Request, party (`host` or `requester`), the candidate interval, direction, origin and destination endpoint hashes, mode, minutes, confirming party, `confirmed_at`, `invalidated_at` | Manual allowances for one candidate leg (decision 10) |
| `route_estimates` | Origin and destination text hashes and resolved place IDs, mode, departure slot, duration, `fetched_at`, outcome (`route`, `no_route`, `failed`) | Cached Google Routes results |
| `contact_confirmations` | Request, contact email, hash of the single-use confirmation token, `created_at`, `consumed_at`, `superseded_at`, delivery | Confirmation links sent with the creation email |
| `email_deliveries` | Kind, frozen sender, recipients, template and language, non-secret template parameters, any secret parameter (a code or booking link) sealed with `TOKEN_ENCRYPTION_KEY`, dispatch ID, state (`queued`, `dispatching`, `accepted`, `rejected`, `uncertain`, `suppressed`), provider evidence | Every transactional email. Secret parameters are rendered only at dispatch and deleted once the delivery reaches a final state, so a stored row never holds a usable code or link |
| `link_resend_issuances` | Request (when one matched), keyed recipient hash, retry identity, time | Resend limits |
| `link_resend_attempts` | Keyed address hash, the address sealed, retry identity, `created_at` | Queued resend work, so the public answer never waits on matching; deleted once processed |
| `admission_windows` | Scope (`host`, `request`, `service`), scope key, window kind (`minute`, `hour`), start, count | Conversation admission budgets |
| `resend_budget` | Minute slot and count, fixed-size ring of 2 slots | The 600-per-minute attempt budget that stores no caller address or claim |

`discussions.principal_type` gains `public_intake` and `discussions.audience` gains `public_intake` and `requester`, and `conversation_inputs` gains `protected_fingerprint` for redaction retry semantics (decision 14).

Rejected: keeping only the hash. The contract resends the *current* link, and the PRD defers rotation, so the service must be able to rebuild the link for its confirmed contact and the creation email (D10, decision 7).

### 2. One guest thread from the first message

Chosen (D13, revising D11): the guest has one conversation, in one assistant session, from the first message on `/{handle}` to agreement. There is no separate anonymous intake.

**Draft request.** The first message on a ready host's `/{handle}` runs `request.start`, which creates a request in the new state `draft`, its booking link (hashed and sealed, decision 7), the requester discussion and eve session, and records the message as the first accepted input. The page keeps the booking UUID in `sessionStorage` for that tab and sends it with each call; the address bar stays at `/{handle}` until the guest is identified. A draft:

- is invisible to the host: every host projection, list and count filters `draft` out;
- expires 24 hours after creation unless the guest is identified, and is then deleted with its discussion by the expiry job;
- accepts at most 30 messages;
- spends under the unconfirmed-request model cap (USD 3 per 24 hours, counted toward the USD 50 anonymous window), which already applies because a draft has no confirmed contact.

| Bound | Value |
|---|---|
| Drafts created per keyed source address | 5 per rolling hour, 20 per rolling day |
| Drafts created service-wide | 500 per rolling day, no per-host bound (D7) |
| Messages per draft | 20 per minute and 100 per hour (the request numbers), and 30 in total before identification |

**Identification.** The assistant asks for name and email in the thread and calls `ask_for_identity` in the same turn (decision 12), and the identity card appears there with **Continue with Google** and **Continue without Google**. `request.identify` (with name, email and timezone) or the Google callback moves the request from `draft` to `gathering`, sets `expires_at` to the earlier of creation plus seven days and the latest window end, sends the creation email (decision 6), and the page calls `history.replaceState` to `/booking/{bookingId}`. Nothing reloads and the session is the same, so the assistant keeps the whole conversation as context. After a Google return the booking page loads the same thread from its stored events.

**While a draft.** `read_request` and `draft_request_review` work, so the assistant can gather purpose, duration, mode, place and windows before identity. `evaluate_candidates`, **Find times**, **Choose this time** and **Agree to this proposal** answer `identity_required`, which the assistant meets by showing the identity card. The tools are the same requester set, `ask_for_identity` included; the draft state is checked inside each operation (layer 3), not by withholding tools, because the audience is the same.

`request.start` runs through `runCommand` with the browser's retry key (a nonce kept with the tab), so a retried first message creates at most one draft; its actor is the anonymous starter, identified by the nonce's hash.

`/booking/[bookingId]` hashes the path segment and looks it up. A malformed, unknown or expired identifier, or a draft opened from another tab, renders the generic unavailable view with **Resend my booking link** (decision 7) and nothing else. Every response from this route and its APIs sends `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: no-store`; request logs record the route template, never the path. A closed request with an unexpired link renders only status and, from Phase 4, the receipt.

Request APIs live under `/api/requests/{bookingId}/*`, authenticated by hashing the identifier, with the same headers as the page; `/{handle}` uses them too once the draft exists. `appAuth`'s requester branch carries `principalId: request:{requestId}` with `audience: requester`. The browser never calls `/eve/v1/*`: history and the live stream come from the application-proxied `/api/requests/{bookingId}/events` route.

**Retired intake.** The `intakes` table, the `public_intake` audience and `read_intake`/`draft_intake` stop being created or registered. Existing rows from before D13 stay readable only so a request that came from an intake still shows that transcript above its thread; a later migration drops them once no open request refers to one.

Rejected: stitching a separate intake session to the request session, which keeps the seam under the hood. Rejected: identifying first and talking second (a static page), which D11 already rejected. Rejected: issuing the address-bar link before identification, which would put a credential in the URL while the guest may still leave.

### 3. Requester Google consent

The host path cannot be reused: Supabase Auth creates an `auth.users` row and `completeGoogleSignIn` creates a host account. Requesters get an application-owned OAuth 2.0 flow against Google directly. It uses the host sign-in web OAuth client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) unless `GOOGLE_REQUESTER_CLIENT_ID` and `GOOGLE_REQUESTER_CLIENT_SECRET` name another client in the same Google Cloud project. Sharing the client is safe because requester grants are delete-only (below): the service never calls Google's revocation endpoint, which revokes per user and client and would otherwise also remove the same person's host Calendar grant.

| Step | Behavior |
|---|---|
| Start | `POST /connections/google/start` with the purpose (`intake` with the intake token, or `request` with the booking identifier from the page), which proves the link for an existing request. It creates a transaction with a random `state`, a PKCE verifier and a random browser binding, sets the binding in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `/connections/google` for 10 minutes, and redirects to Google with `openid email profile` plus the Calendar scopes (D8), `access_type=offline`, `prompt=consent`, `include_granted_scopes=false` and the S256 challenge |
| Callback | `GET /connections/google/callback` requires an unconsumed, unexpired transaction for the `state` and a matching binding cookie; otherwise it consumes nothing and shows a readable failure with a link back to `/{handle}`, without revealing any request. It exchanges the code with the verifier, reads the ID token claims (`sub`, `email`, `email_verified`, `name`) from the token endpoint response, reads granted scopes from Google's token information endpoint, and consumes the transaction |
| Intake | Creates the request as in decision 2 from the intake, with the Google name and email; a verified Google email is the confirmed contact |
| Existing request | Rechecks the request is open and its link unexpired, then records the grants and returns to the booking page, whose link it rebuilds from the sealed copy (decision 7); **Use verified Google email** confirms the contact only when the Google address equals the request's current contact |
| Cancel | A denied consent consumes the transaction, records no grant or request, and returns to `/{handle}` with the intake conversation intact, or to the booking page |
| Headers | The callback's responses, whose `Location` can carry a booking link, send `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `X-Robots-Tag: noindex`, and request logs record the route without its query |

Identity and Calendar access are separate `requester_grants` rows even though one screen asked for both: an unchecked Calendar part still records identity. A new consent replaces the request's earlier grants, deleting their tokens like any other closure. **Choose calendars** accepts only IDs on the requester's live calendar list, read with the request's grant; an unknown ID is rejected. The refresh token is sealed with the context `requester_grant:{requestId}`. A grant is used only by evaluations of its own request; an API call for another request never reads it. Closure, expiry of the request or the link, and **Disconnect** delete the sealed token and mark the grant revoked in the same transaction, and nothing else: requester grants are delete-only (D8). The service holds the only copy of the refresh token, sealed, so deleting it ends the service's access; Google expires unused grants itself, after 7 days while the app is in Testing and after about 6 months of disuse once it is published. Until then, or until the requester removes it, the grant may stay listed in the requester's Google third-party access. `provider_revocation` records `not_needed` for every closure.

Rejected: revoking at Google on closure. On a shared client it would also revoke the same person's host Calendar grant, and a separate client added setup for little gain.

Scopes (D8): `calendar.calendarlist.readonly` so the requester can choose which calendars count, and `calendar.events.readonly` so evaluation can read their events. The primary calendar is preselected. Event contents are read inside an evaluation only, for two purposes: busy intervals under the host-style F02 rules (cancelled, declined and transparent events do not block; all-day events block time but never anchor travel), and the requester's own travel legs (decision 9). Titles, attendees, descriptions and locations are never stored, never put in a tool result or model context, and never shown to the host or any agent; the requester projection names an adjacent event only as "your earlier event" or "your next event". This replaces PRD FR-12's availability-only wording, which the PRD and the requester consent copy are corrected to match.

The button is always shown (D8). While the Google app is in Testing, Google refuses consent for unlisted users with its own error page; the requester can go back and use **Continue without Google**. Refresh tokens from a Testing app expire after seven days, which the request lifetime already bounds.

Rejected: free/busy access only. It cannot tell a declined or transparent event from a busy one and gives no locations for travel. Rejected: hiding the button until publication.

The requester OAuth client (the host sign-in client unless a separate one is configured) needs the redirect URIs `{origin}/connections/google/callback` for `https://findmeatime.com`, `https://release.findmeatime.com` and `http://localhost:3000`. `connections` is already a reserved handle.

Rejected: a second Supabase project or anonymous Supabase users for requesters. Either creates product accounts, which the contract forbids. Rejected: putting the booking UUID in `state`. `state` appears in Google's logs and the browser history.

### 4. Lifecycle, expiry and withdrawal

| Transition | Command or job |
|---|---|
| `gathering` → `negotiating` | A completed evaluation with at least one candidate while required details are complete |
| `negotiating` → `gathering` | An applied review that changes details, or an evaluation that needs clarification |
| `negotiating` → `awaiting_host_approval` | `request.agree` on the current proposal version |
| any actionable → `withdrawn` | `request.withdraw` with the expected revision |
| any actionable → `expired` | The `request_expiry` job |

`expires_at` is the earlier of creation plus seven days and the end of the latest requested window, recomputed whenever windows are applied. The automatic `gathering` → `negotiating` transition runs in the evaluation's publishing transaction, after its revision check, and does not advance the request revision, so the evaluation that caused it stays current; every other transition does. A `pg_cron` schedule every 5 minutes publishes one `request_expiry` job that closes due requests in batches of 200 with `FOR UPDATE SKIP LOCKED`, and every command also rejects a request whose `expires_at` has passed, so a late sweep never lets a decision through. Closure deletes the requester grants' tokens (decision 3), supersedes confirmation tokens and pending reviews in the same transaction. Withdrawal from `awaiting_host_approval` is allowed; Phase 4 adds the booking guard.

### 5. Cloudflare email adapter

`lib/server/cloudflare-email.ts` posts to `https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/email/sending/send` with `Authorization: Bearer {CLOUDFLARE_EMAIL_API_TOKEN}`, sender `Find Me a Time <{CLOUDFLARE_EMAIL_FROM}>` (`no-reply@findmeatime.com` in production), `to`, `subject`, `html`, `text` and the header `X-Fmat-Dispatch-Id`. The base URL comes from `CLOUDFLARE_EMAIL_API_URL` for stand-ins and is ignored on the production deployment, like `GOOGLE_OAUTH_TOKEN_URL`. Every send goes through `gateTransport` (decision 13).

Delivery is a durable `email_delivery` job. The domain transition that needs an email inserts the frozen `email_deliveries` row and publishes the job in one transaction. The handler:

1. rechecks that the recipient is still current for the purpose (the challenge is still live, the request still open, the contact unchanged); otherwise marks the delivery `suppressed`;
2. moves the row to `dispatching` and commits before any network call;
3. renders the template, opening any sealed secret parameter, and sends once with a 10-second timeout;
4. records `accepted` only when every intended recipient appears in `result.delivered` or `result.queued`, with the dispatch ID and the provider's lists as evidence; `permanent_bounces` or an error response records `rejected`; a timeout, a lost response or a 5xx records `uncertain`; every final state deletes the sealed secret parameters.

A row found in `dispatching` by a later attempt is marked `uncertain` and never sent again. The REST response documents no message ID, so the evidence is the application dispatch ID plus recipient acceptance (D4 (ii)); if a live response does return an ID, it is stored too. Option (b), a Worker relay, would return a `messageId` but adds a deployment.

Setup (D4): onboard `findmeatime.com` in **Compute › Email Service › Email Sending**, which adds MX, SPF and DKIM records on `cf-bounce.findmeatime.com` and a `_dmarc` record. Before onboarding, list existing records with `cf dns records list --zone findmeatime.com` and keep unrelated mail and verification records; an existing `_dmarc` record is reconciled by hand. Create one account-scoped API token with **Email Sending: Edit** only. The account must be on the Workers Paid plan to send to recipients other than verified destination addresses.

### 6. Contact confirmation

Chosen (D3): confirmation is optional and nothing waits on it. Intake, candidates, agreement and, from Phase 4, host approval, the invitation and status emails all go ahead with an unconfirmed address; the host sees whether it is confirmed.

When a request is created, and whenever its contact address changes, the same transaction inserts a `contact_confirmations` row with a random single-use token (stored as a hash and sealed as the delivery's secret parameter) and the **creation email**: the booking link and **Confirm this address**, which opens `/booking/confirm/{token}`. Opening it confirms nothing, so a mail scanner or link preview that fetches the URL cannot confirm for the recipient: the page shows a **Confirm this address** button, which posts the token to `POST /api/contact-confirmations` under the same-origin check of every POST route. The press, in any browser, marks that address confirmed if the token is unconsumed, not superseded and the request's contact still equals it, and the page then shows the result. A changed address supersedes earlier tokens; closure supersedes all. A Google-verified address equal to the contact is confirmed without the email, and a request created through Google with a verified address sends the creation email without the confirmation link.

**Send the email again** on the booking page (`contact.resend_confirmation`, retry identity from the card) sends a fresh creation email to the current address. Every creation email, including the one request creation sends and those a contact change sends, counts toward one set of bounds: one per 60 seconds per request, 5 per request and 10 per address per rolling hour, and 1,000 across the service per rolling day, checked under the request lock, then the address's and the service's advisory locks. A resend past a bound returns when it may be sent again; a contact change past one (`request.update_details` or `request.apply_review`) is rejected with `rate_limited` and writes nothing, so the address field cannot mail the booking link to arbitrary addresses. An exact retry returns the saved status with no second email. The card shows queued, sent, rejected, uncertain and confirmed from the delivery and confirmation rows.

Trade-off accepted: a mistyped address receives the booking link, and therefore the request, as with Calendly and Cal.com. Host approval still stands between that and any invitation.

Rejected: six-digit codes, with confirmation required before trusted attendee use. They add a step for little gain when host approval already stops invitation spam.

### 7. Link resend

`POST /api/booking-links/resend` takes an email address and a retry key and always answers with the same generic acceptance after doing the same work for every address: it charges the fixed-size 600-per-minute attempt budget, which stores only a minute slot and a count, and, when the budget allows, records a `link_resend_attempts` row with the keyed address hash, the sealed address and the retry key, and publishes a `link_resend` job. Nothing in the answer or its timing depends on whether the address matches a request. The job then:

1. finds open requests whose `contact_confirmed_email` equals the address, with unexpired links; none, it deletes the attempt and stops;
2. per matching request, applies one per minute and five per hour per request, five per hour per recipient across requests and 120 per minute service-wide;
3. inserts one frozen delivery per matching request whose identity is the request plus the attempt's retry key, carrying the sealed link as its secret parameter, so a concurrent or retried call creates at most one delivery per request and changed input cannot replace a pending one.

Chosen (D10): `booking_links` keeps the UUID sealed with `TOKEN_ENCRYPTION_KEY` (context `booking_link:{requestId}`) beside its hash. Lookup always uses the hash, so a database read without the key yields no usable link, and only resend and the requester's Google return (decision 3) open the seal. Option (b), rotating the link on every resend, would silently break a link the requester's agent or another browser still holds, and the PRD defers rotation. Option (c), dropping resend until rotation exists, leaves the contract's resend requirement unmet.

### 8. Evaluation runs as an application job

Chosen (D5): `evaluate_candidates` publishes an `evaluation` job keyed by `tool:{callId}` for the current request and settings revisions, then waits up to 20 seconds for the evaluation row to leave `pending` and returns the audience projection; a still-pending evaluation returns its identity and the card fills in when the row completes. Agent configuration's tool table is corrected to say both. The **Find times** card action publishes the same job, so candidates are reachable without the model. Under the request lock, both paths return a pending evaluation at the same request and settings revisions instead of creating another, and a request gets at most 10 new evaluations per rolling hour; past that, publishing is `rate_limited` and the tool tells the requester to try later. A trip allowance always starts a new evaluation, within the bound, because a pending run may have read the allowances before it. Phase 4's host review uses the same job with the host projection. Option (b) would run the evaluation inside the tool step, which replays provider calls on recovery and keeps the result out of the domain.

The job runs the deterministic engine in `lib/server/feasibility.ts` with one `AbortController` and a deadline 18 seconds after the job starts work. Every provider call receives the shared signal; pagination, extra calendars and the second party do not reset it.

1. Load the request, the host's confirmed settings and the requester grants at their revisions.
2. Read host busy intervals: `events.list` on the confirmed conflict calendars over the requested windows plus the adjacency horizon, with iteration 1's F02 rules (busy unless cancelled, declined or transparent; copies merged by provider identity; all-day events block time and never anchor travel; note-like exclusions removed).
3. Read requester events with `events.list` on the selected calendars when a calendar grant exists, keeping only busy intervals under the F02 rules and the endpoints of the requester's adjacent events for decision 9, in memory. A failed or revoked read pauses evaluation as `requester_calendar_unavailable`, offering reconnection or manual availability; it never counts as free.
4. Build candidate intervals from the host's weekly windows (overnight windows owned by their starting weekday, ambiguous or nonexistent boundaries yielding no candidate), intersected with the requester's windows, the requested duration and the 15-minute start grid.
5. Remove candidates overlapping busy or focus intervals after applying buffers before and after.
6. For in-person candidates, check both host travel legs and, with a requester grant, both requester legs (decision 9). Unresolved legs exclude the candidate from requester output and are recorded for the host.
7. Order by the weekly limit preference: weeks below the limit first.
8. Rank the first 20 valid candidates with the model (2,048 output tokens, two attempts, the remaining deadline). The ranking may only reorder IDs it was given; an unknown or duplicated ID discards the ranking and keeps the deterministic order.
9. Under the request lock, recheck that the request and settings revisions are unchanged and the deadline has not passed, then publish. Otherwise the evaluation becomes `incomplete` and publishes nothing.

Explanations are code-computed sentences from the candidate's basis (iteration 1's F09), never model text. The requester projection contains instants, display times, duration, mode and location plan; no rule, buffer, travel estimate or event detail.

### 9. Travel legs and Google Routes

For an in-person candidate, the adjacent commitments are the nearest busy timed host events that end before it and start after it on the same local day in the host timezone, whatever the gap (D1). A candidate in an overnight window uses the window's starting day and the following morning up to the window's end, so a 01:00 candidate still checks the event that ended at 23:30. With no such event, the leg is not checked. An adjacent event's endpoint is its location text; an event with no location or only a conference link has an unknown endpoint, so the leg is unresolved, as the PRD forbids inferring home or office. An event with both a place and a link is also unresolved, following iteration 1's rule that place plus link never decides attendance.

When the requester connected Google Calendar, the requester's own adjacent events are found the same way in the requester's timezone, with the requester's travel mode, which the meeting details card asks for on in-person requests (**Driving**, **Public transit** or **Walking**). A requester leg that does not fit excludes the candidate; an unresolved requester leg keeps the candidate out of the list and shows the requester "We could not estimate your trip from your earlier event" with a per-leg allowance control (decision 10). Requester legs use no host buffer. Without a requester Calendar grant, no requester leg is checked.

Each leg calls `computeRoutes` with address waypoints, the host's confirmed mode (`DRIVE`, `TRANSIT` or `WALK`; **Depends on the trip** makes the leg unresolved until the host chooses), and the departure time (the previous event's end for the inbound leg, the candidate's end for the outbound one), with `TRAFFIC_AWARE` for driving. A leg fits when the route duration plus the host's buffer and extra travel buffer fits the gap.

Geography and freshness (D1): no country list; a country allowlist and a 3-hour horizon were rejected. A response with no route, an unsupported mode or a failure leaves the leg unresolved. Lane C records, against the live API, which modes return routes for a Seoul origin and destination, because Google restricts driving and walking directions in South Korea; if only transit works there, Korean hosts with driving or walking will see unresolved legs until Phase 4's allowance control, which the acceptance record notes. Estimates are cached in `route_estimates` for 24 hours per origin, destination, mode and 15-minute departure slot; a changed event location changes the key. Phase 4's booking revalidation refetches estimates older than one hour. Endpoints are stored as keyed hashes plus Google place IDs, never as cleartext event locations beyond the evaluation.

Route calls use a server key restricted to the Routes API, held in the existing `GOOGLE_MAPS_API_KEY`, with `GOOGLE_ROUTES_API_URL` for stand-ins (ignored on production), with the field mask `routes.duration,routes.distanceMeters` to stay in the basic billing tier.

### 10. Manual travel allowances

Chosen (D2): an allowance covers one leg of one candidate: the party (host or requester), the candidate interval, the direction, the origin and destination endpoints and the mode, in 5-minute steps from 5 to 240 minutes. It is void when that candidate's interval, either endpoint or the mode changes. The engine reads confirmed allowances from `travel_allowances`. Host allowances are confirmed in Phase 4's rule and travel review card; requester allowances for the requester's own legs are confirmed on the requester's candidate card in this change, and the requester projection never shows a host allowance. Rejected: an allowance per request and endpoint pair, which would apply one estimate to trips at different times of day; a standing host rule, which the contract does not ask for.

### 11. Online meeting link plan

Chosen (D6): the proposal's `link_plan` is `google_meet` (a Meet conference created with the event in the host's booking destination) or `requester_link` (a URL the requester supplied, validated as `https:` and shown in the proposal). An online request offers `google_meet` when the destination calendar's `conferenceProperties.allowedConferenceSolutionTypes` includes `hangoutsMeet`, read with the calendar list at evaluation; otherwise the requester is asked for a link. Agreement and Phase 4's approval cover the plan; Phase 4 creates the conference with `conferenceDataVersion=1`. Option (b) needs a new setup field and confirmation in Phase 2's flow.

### 12. Requester conversation

`agent/tools/request.ts` is one `defineDynamic` resolver for request discussions. In this change it returns `read_request`, `draft_request_review`, `ask_for_identity`, `evaluate_candidates` and `read_booking_status` only when the principal's audience is `requester`; Phase 4 adds the host-review set to the same resolver, with the shared tools returning the host projection there. Agent configuration's directory layout is corrected from one file per tool to this resolver, and `agent/instructions/requester.ts` resolves `requester.md` the same way. Each tool checks the fence first: the request is open, its link unexpired and the session is the discussion's current generation. Host tools are absent from requester sessions.

| Tool | Behavior |
|---|---|
| `read_request` | Requester projection: details with contact presence indicators, the pending review, the current proposal, agreement and status |
| `draft_request_review` | Declares `details`, `availability`, `question` or `unknown`. Question and unknown carry no patch and at least one authored clarification category. Details and availability carry a patch whose windows start in the future and fit the known duration. Creates a pending review against the base revision; supersedes the earlier pending review. Retry key `tool:{callId}` |
| `ask_for_identity` | Called in the turn in which the assistant asks a draft's guest for a name and email. It only records when identity was first requested (`requests.identity_requested_at`), which anchors the identity card after that message; it reads nothing else and does nothing once the guest is identified |
| `evaluate_candidates` | Decision 8 |
| `read_booking_status` | Status from domain records; until Phase 4, awaiting approval at most |

Clarification categories (`missing_date`, `missing_time`, `missing_timezone`, `ambiguous_local_time`, `missing_duration`, `missing_mode`, `missing_location`, `unclear_location`, `missing_purpose`) each have one authored English and one authored Korean question in `lib/contracts/clarifications.ts`. The language is the request's, set from the browser and changed only by the requester.

Cards appear **inside the thread** (D13): each is anchored after the assistant message or tool result that calls for it, in order, and stays in the history as a record of what was offered and chosen; a superseded card shows that it is out of date and offers the current one. Only the composer sits below the thread, with a compact menu beside it holding **Edit details** and **Withdraw request** (a confirming dialog). The page shows no form, panel or card outside it.

**One thing at a time** ([design principle 4](../../../documentations/03_design_principles.md#4-one-thing-to-think-about-at-once)). At most one actionable card is open: the one for the current next step, in the order identity, review, Calendar connection or selection, candidate times, proposal; while the request awaits the host's approval none is. The server computes the step with the thread (`lib/server/guest-thread.ts`), and every other card is a one-line receipt: answered (**Your details** · name · email, **Calendar** · Skipped, **Times** · Chose Mon 3 Nov, 10:00 GMT+9), waiting for its step, or out of date. A receipt offers **Change** where changing is allowed: the applied details open the meeting details card, the Calendar receipt offers the Calendar card again, and the chosen time reopens the candidate times in place of the proposal. While the meeting details card is open it is the open card. The request's status is a line, not a card: after identification, where the booking link went with **Send again** (or **Use verified Google email**) and that confirming is optional; after agreement, the wait for the host. **Skip for now** is `request.set_manual_availability`, which records `requests.calendar_settled_at` on the server, as saving calendars does, so a reload or another tab does not reopen the Calendar card; **Change** clears it, and a new Calendar grant clears it so its calendars can be chosen.

**The identity signal.** The identity card must appear as soon as the assistant asks for a name and email, and the page cannot tell that from prose without parsing model text, which this design never treats as authority. Chosen: a requester tool, `ask_for_identity`, that only records the first time identity was requested. Its call sits inside the assistant message that asks, so the card is anchored right after it, it needs no input the model could get wrong, and a model that forgets it still meets the card when a gated operation answers `identity_required`, when the purpose is first applied, or at the draft's message cap. Rejected: a `request_identity` flag on `draft_request_review`'s result, which ties asking for identity to drafting details, so the card could not appear in a turn that drafts nothing, and a flag on the result reports a decision rather than recording one.

Cards post to `/api/requests/{bookingId}/commands` with the expected revision and a retry key:

| Card | Command |
|---|---|
| Review extracted details: **Apply these details**, **Dismiss** | `request.apply_review`, `request.dismiss_review` |
| Meeting details (opened from the thread with **Edit details**): purpose, duration, mode, location or meeting link, availability windows, travel mode for in-person requests, **Save details** | `request.update_details` with the same validation as a review, so details can be set when the model is unavailable. A meeting link entered here is not passed through conversation redaction |
| Calendar connection: **Connect Google Calendar**, **Skip for now**, **Disconnect**; **Change** on its receipt | Decision 3; `request.set_manual_availability` (`manual: true` settles the step, `manual: false` offers the card again) |
| Status line: **Send again**, **Use verified Google email** | Decision 6 |
| Candidate times: **Choose this time**, **Find other times**, and for an unresolved requester leg **Allow … minutes for my trip** | `request.choose_candidate` creates the next proposal version from a candidate of the current evaluation; `request.evaluate` |
| Proposal: **Agree to this proposal** | `request.agree` names the proposal version; rejected unless it is the current version, its start is still in the future after the lock, and the request is open; an unconfirmed contact does not block it (D3) |
| Thread menu beside the composer: **Edit details**, **Withdraw request** | Opens the meeting details card; `request.withdraw` |

A message such as "yes" records nothing: agreement exists only as an `agreements` row written by `request.agree`. Choosing a candidate writes a proposal version without advancing the request revision, so the evaluation it came from stays current; every change of details advances the revision, which leaves that evaluation and its proposals stale for choice and agreement.

When an evaluation finds no candidate, the requester sees the authored no-match message asking for a wider window or other details, with no rule or reason. The host-private request for an exception or revision (FR-10's host half) needs the host review audience and arrives with Phase 4; until then the request stays negotiating or gathering.

### 13. Local messaging

Chosen (D9): `messagingAdmitted` admits production as today and admits local execution only when the transport's configured base URL resolves to a loopback host (`localhost`, `127.0.0.1`, `::1`). Local runs therefore reach a stand-in provider, like the local OpenAI stand-in, and a real `CLOUDFLARE_EMAIL_API_TOKEN` in `.env.local` sends nothing. The gate takes the transport's endpoint as an argument: `gateTransport` passes the transport's configured endpoint, and `withMessagingAdmission` takes the endpoint of the transport its worker will use, so delivery workers apply the same loopback rule before claiming work. This lands, with the `messaging-environments` delta's scenarios as tests, before the Cloudflare adapter.

### 14. Conversation admission and redaction

Both run in the application message route before eve sees anything, for host and requester discussions alike.

Admission follows the existing contract numbers: 20 per minute and 100 per hour per host account or request, 200 per minute and 2,000 per hour service-wide. Each scope and window is one `admission_windows` row whose window starts at the first accepted message after expiry. Under row locks taken in a fixed order (scope, then service), the route charges every applicable window and records the accepted input in one transaction; any exhausted window rejects the whole input with HTTP 429 and the safe temporary-limit message, and the browser keeps the unsent text. An exact retry of an accepted input returns its receipt without charging.

Redaction in `lib/server/redaction.ts` replaces, before persistence, `Bearer` values, `LINK <UUID> <proof>`, and URL parameters or fragments whose percent-decoded, case-folded name is one of `token`, `code`, `state`, `secret`, `proof`, `recovery`, `invitation`, `credential` or ends in `_token`, with `[removed credential]`. A booking link (`/booking/` followed by a UUID, with or without origin) is also replaced, because the UUID is the requester's only credential, and requester and intake input also loses a bare UUID, which may be a booking identifier pasted alone; host input keeps bare UUIDs, which hosts use for calendars and events. Intake messages pass through the same route, so nothing an anonymous visitor types reaches the runtime unredacted. The input's retry fingerprint is computed over the original text and stored only as an HMAC (`protected_fingerprint`), so a changed secret under the same retry key conflicts while the plaintext is gone.

### 15. Timezone

The browser's IANA zone is the initial display zone, stored per tab in `sessionStorage` once the requester chooses one explicitly, and sent with each command that interprets local times. The request stores the requester's zone for window interpretation; changing only the display zone converts the same instants. Local inputs that are ambiguous or nonexistent in their zone produce the `ambiguous_local_time` clarification. Times render with the date-specific offset (`Mon 3 Nov, 10:00 GMT+9`).

### 16. Tests

| Layer | Covers |
|---|---|
| Unit (beside modules) | Engine: requester legs and host-style requester busy rules; full intervals, buffers, overnight windows, DST gaps and overlaps, focus blocks, the weekly limit order, both travel legs, unknown endpoints, allowances, the deadline with a fake clock; redaction patterns and encodings; clarification wording per category and language; window validation |
| Integration (`tests/integration/`) | The intake conversation's budgets and tools; request creation, its intake actor and retry, bounds and the unavailable result; the requester events route; booking link expiry and closure; reviews with stale revisions and retries; agreement on a superseded or started proposal; withdrawal and expiry; the creation email, confirmation links (single use, superseded, a changed contact), resend limits and lost responses; link resend limits and generic answers; the Cloudflare adapter against a fake server, including lost responses and bounces; the OAuth callback with replay, wrong browser and cancellation against a fake Google; requester Calendar failure; evaluation against fake Calendar and Routes servers with a stalled page; admission concurrency; messaging denial for local with a real endpoint |
| Database (`supabase/tests/`) | `anon` and `authenticated` reach no new table or function |
| Browser (`tests/e2e/`) | A requester goes from `/{handle}` to agreement against fake Google, fake Routes, fake Cloudflare and the OpenAI stand-in; keyboard use and 390-pixel width; the unavailable view with resend |
| Evals (`evals/`) | Injection asking for calendar contents or approval; "yes" or "book it"; an ambiguous time producing the authored question in Korean; the requester tool list containing no host tool |

## Risks / Trade-offs

- **Testing-mode Google app.** Until the app is published, requester Google consent works only for listed test users, and other requesters meet Google's error page (D8). AC-27's live evidence uses test-user accounts. Mitigation: **Continue without Google** and manual availability.
- **Requester event contents.** Reading requester events widens the Google verification scope and the data the service handles. Mitigation: contents are read only inside an evaluation, never stored, logged or given to the model, and the consent copy says so.
- **Anonymous model spend.** Visitors can spend up to USD 50 a day before giving any identity. Mitigation: the per-intake, per-source and anonymous service caps.
- **Mistyped addresses.** An unconfirmed typo sends the booking link to a stranger (D3). Mitigation: the host sees confirmation status; host approval gates any invitation.
- **No per-host creation cap.** A host can receive many requests from many sources (D7). Mitigation: per-source and service bounds.
- **Driving and walking routes in South Korea.** If Google returns no route, every in-person candidate with an adjacent commitment is unresolved for Korean hosts until Phase 4's allowance control. Mitigation: the Lane C check records it and the decision can move to D1 (b) before launch.
- **Sealed booking link.** A database dump plus the encryption key yields live links. Mitigation: the key lives only in Vercel Production, links expire after 30 days, and only two operations open the seal.
- **No idempotency at Cloudflare.** A lost response cannot be retried safely. Mitigation: uncertain is a terminal delivery state; the requester can ask for a new code after the cooldown.
- **Evaluation latency.** A full evaluation with ranking can take most of 18 seconds. Mitigation: the tool returns a pending evaluation and the card completes from the record.

## Migration Plan

One declarative sync generates the table migration; the expiry schedule goes in its own `supabase migration new` migration mirrored under `supabase/schemas/app/cron/`. `supabase db reset --local` must rebuild the chain. The shared project receives the migrations through the `Deploy shared Supabase` workflow if its secrets are set by then; otherwise, as in Phases 1 and 2, by `supabase db push --linked` after a shown dry run and with the user's explicit approval, recorded in the acceptance record. The Google redirect URIs, the Routes key, the Cloudflare onboarding and token, and the Vercel variables are configured before the evidence run. Rollback: the tables are additive; reverting the deployment returns `/{handle}` to "not accepting requests".

## Open Questions

- Teammate review of D1–D12, which were decided before that review; the plan's **Teammate review** box tracks it.
- Whether a live Cloudflare REST response carries a message identifier; Lane B's first controlled send answers it.
- Google app verification for the requester Calendar scopes, which the host submission should include.
