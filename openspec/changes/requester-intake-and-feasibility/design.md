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

**Goals:** a requester opens `/{handle}`, continues with or without Google, describes the meeting in English or Korean, reviews extracted details, verifies a manual address, sees feasible candidates, chooses one and agrees to the exact proposal version; the request then waits for host approval. Withdrawal and expiry close it. Conversation admission and credential redaction protect every conversation.

**Non-goals:** host review, approval, booking, the confirmation email and requester status notifications (Phase 4); the host's manual allowance and exception controls (Phase 4); MCP and CLI requester access and the one-future-request grant (Phase 5); requester email (Phase 7); messaging receipts (Phases 6 and 7).

## Decisions

Decisions D1–D10 in the proposal are recommendations awaiting team sign-off. The sections below design the recommended option and name what a different choice would change.

### 1. Records

| Table | Holds | Authoritative for |
|---|---|---|
| `requests` | Host, state, `revision`, details JSON (purpose, duration, mode, location or link plan, windows, requester timezone, language), requester display name and contact email, `contact_verified_email`, `created_at`, `expires_at`, `closed_at` | The request and its lifecycle |
| `booking_links` | SHA-256 of the booking UUID (the lookup key), the UUID sealed with `TOKEN_ENCRYPTION_KEY`, request, `created_at`, `expires_at` (creation plus 30 days) | The requester credential. The sealed copy is opened only to resend the link or to finish the requester's Google return (decision 7) |
| `request_creations` | Keyed source hash, host, time | Creation bounds; deleted after 24 hours |
| `requester_oauth_transactions` | Hash of `state`, hash of the browser binding, PKCE verifier sealed, purpose (`intake` or `request`), host, the request for an existing request, the intake draft (purpose text, timezone, language), `expires_at` (10 minutes), `consumed_at` | One Google consent round trip |
| `requester_grants` | Request, kind (`identity` or `calendar`), Google subject hash, granted scopes, sealed refresh token (calendar only), selected calendar IDs, `revoked_at` | Request-bound Google grants |
| `request_reviews` | Request, the base revision, declared intent, the patch, authored clarifications, state (`pending`, `applied`, `superseded`, `rejected`) | Extracted changes awaiting explicit application |
| `proposals` | Request, version number, exact shared details (start and end instants, display timezones, duration, participants, mode, location or link plan), the evaluation it came from, `created_at` | Immutable proposal versions |
| `agreements` | Proposal, request revision, retry identity, `agreed_at` | Requester agreement to one version |
| `evaluations` | Request, the request and settings revisions it read, state (`pending`, `completed`, `incomplete`, `failed`), deadline, candidates with their bases, the requester projection, the ranking, failure category | One feasibility run |
| `travel_allowances` | Request, direction, origin and destination endpoint hashes, mode, minutes, confirming host, `confirmed_at`, `invalidated_at` | Host-confirmed manual allowances (decision 10); written from Phase 4 |
| `route_estimates` | Origin and destination text hashes and resolved place IDs, mode, departure slot, duration, `fetched_at`, outcome (`route`, `no_route`, `failed`) | Cached Google Routes results |
| `verification_challenges` | Request, contact email, code hash, `expires_at`, failed attempts, state, delivery | Contact codes |
| `email_deliveries` | Kind, frozen sender, recipients, subject and bodies, dispatch ID, state (`queued`, `dispatching`, `accepted`, `rejected`, `uncertain`), provider evidence | Every transactional email |
| `link_resend_issuances` | Request (when one matched), keyed recipient hash, retry identity, time | Resend limits |
| `admission_windows` | Scope (`host`, `request`, `service`), scope key, window kind (`minute`, `hour`), start, count | Conversation admission budgets |
| `resend_budget` | Minute slot and count, fixed-size ring of 2 slots | The 600-per-minute attempt budget that stores no caller address or claim |

`discussions.audience` gains `requester`, and `conversation_inputs` gains `protected_fingerprint` for redaction retry semantics (decision 14).

Rejected: keeping only the hash. The contract resends the *current* link, and the PRD defers rotation, so the service must be able to rebuild the link for its verified contact (D10, decision 7).

### 2. Request creation and the booking link

`/{handle}` is a static intake page, not a model conversation: no eve session or model call exists before a request does, so an anonymous visitor spends no model allowance. It shows the host's public identity, a composer for "What is the meeting about?", the guest identity card and the timezone line. The first explicit continuation creates the request:

- **Continue without Google** submits name, email, timezone and the composed text to `POST /api/intake/{handle}`.
- **Continue with Google** starts the consent round trip (decision 3); the callback creates the request.

`request.create` runs through `runCommand` with the browser's retry key. In one transaction it reads host standing through the shared guard (unready, suspended or unknown hosts get the neutral unavailable result), checks the creation bounds under advisory locks, inserts the request in `gathering` with `expires_at` at creation plus seven days, inserts the hashed booking link, creates the requester discussion and records the composed text as the first accepted conversation input, charged to the new request's admission budget. The response carries the UUID once; the browser replaces the location with `/booking/{uuid}`. An exact retry returns the same UUID from the command outcome, which is stored sealed for the retry window and then cleared.

Creation bounds (D7): 5 per keyed source address per rolling hour and 20 per rolling day, 30 per host per rolling day, 500 service-wide per rolling day. Past a bound the page shows a generic temporary-limit message and nothing is created. The source key is the same HMAC as sign-up bounds, so no raw address is stored.

`/booking/[bookingId]` hashes the path segment and looks it up. A malformed, unknown or expired identifier renders the generic unavailable view with **Resend my booking link** (decision 7) and nothing else. Every response from this route and its APIs sends `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: no-store`; request logs record the route template, never the path. A closed request with an unexpired link renders only status and, from Phase 4, the receipt.

Request APIs live under `/api/requests/{bookingId}/*`, authenticated by hashing the identifier from the path. `appAuth` gains a requester branch: the application route has already resolved the link, and the signed internal bearer carries `principalId: request:{requestId}` and `audience: requester`.

Rejected: an intake draft cookie before creation. It adds a second credential before the request exists. Rejected: creating the request at the first keystroke. Abandoned visits would fill hosts' requests.

### 3. Requester Google consent

The host path cannot be reused: Supabase Auth creates an `auth.users` row and `completeGoogleSignIn` creates a host account. Requesters get an application-owned OAuth 2.0 flow against Google directly, on the same OAuth client with its own redirect URI.

| Step | Behavior |
|---|---|
| Start | `POST /connections/google/start` with the purpose (`intake` with handle and draft, or `request` with the booking identifier from the page), which proves the link for an existing request. It creates a transaction with a random `state`, a PKCE verifier and a random browser binding, sets the binding in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `/connections/google` for 10 minutes, and redirects to Google with `openid email profile` plus the Calendar scopes (D8), `access_type=offline`, `prompt=consent`, `include_granted_scopes=false` and the S256 challenge |
| Callback | `GET /connections/google/callback` requires an unconsumed, unexpired transaction for the `state` and a matching binding cookie; otherwise it consumes nothing and shows a readable failure with a link back to `/{handle}`, without revealing any request. It exchanges the code with the verifier, reads the ID token claims (`sub`, `email`, `email_verified`, `name`) from the token endpoint response, reads granted scopes from Google's token information endpoint, and consumes the transaction |
| Intake | Creates the request as in decision 2 from the transaction's draft, with the Google name and email; a verified Google email is the verified contact |
| Existing request | Rechecks the request is open and its link unexpired, then records the grants and returns to the booking page, whose link it rebuilds from the sealed copy (decision 7); **Use verified Google email** sets the verified contact only when the Google address equals the request's current contact |
| Cancel | A denied consent marks the transaction consumed and returns to `/{handle}` with the draft restored from the transaction, or to the booking page |

Identity and Calendar access are separate `requester_grants` rows even though one screen asked for both: an unchecked Calendar part still records identity. The refresh token is sealed with the context `requester_grant:{requestId}`. A grant is used only by evaluations of its own request; an API call for another request never reads it. Closure, expiry of the request or the link, and **Disconnect** revoke the grant at Google's revocation endpoint (best effort, recorded) and delete the sealed token in the same transaction.

Scopes (D8): `calendar.events.freebusy` for `freebusy.query` and `calendar.calendarlist.readonly` so the requester can choose which calendars count; the primary calendar is preselected. Event contents are never read. With option (b) the calendar list step disappears and only the primary calendar is queried.

Testing-mode gating (D8): while the Google app is in Testing only listed test users can consent. `REQUESTER_GOOGLE_ENABLED` must be `true` for **Continue with Google** and **Connect Google Calendar** to render; otherwise the page offers **Continue without Google** and manual availability only. Refresh tokens from a Testing app expire after seven days, which the request lifetime already bounds.

The redirect URIs are `{origin}/connections/google/callback` for `https://findmeatime.com`, `https://release.findmeatime.com` and `http://localhost:3000`. `connections` is already a reserved handle.

Rejected: a second Supabase project or anonymous Supabase users for requesters. Either creates product accounts, which the contract forbids. Rejected: putting the booking UUID in `state`. `state` appears in Google's logs and the browser history.

### 4. Lifecycle, expiry and withdrawal

| Transition | Command or job |
|---|---|
| `gathering` → `negotiating` | A completed evaluation with at least one candidate while required details are complete |
| `negotiating` → `gathering` | An applied review that changes details, or an evaluation that needs clarification |
| `negotiating` → `awaiting_host_approval` | `request.agree` on the current proposal version |
| any actionable → `withdrawn` | `request.withdraw` with the expected revision |
| any actionable → `expired` | The `request_expiry` job |

`expires_at` is the earlier of creation plus seven days and the end of the latest requested window, recomputed whenever windows are applied. A `pg_cron` schedule every 5 minutes publishes one `request_expiry` job that closes due requests in batches of 200 with `FOR UPDATE SKIP LOCKED`, and every command also rejects a request whose `expires_at` has passed, so a late sweep never lets a decision through. Closure revokes requester grants, invalidates verification challenges and supersedes pending reviews in the same transaction. Withdrawal from `awaiting_host_approval` is allowed; Phase 4 adds the booking guard.

### 5. Cloudflare email adapter

`lib/server/cloudflare-email.ts` posts to `https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/email/sending/send` with `Authorization: Bearer {CLOUDFLARE_EMAIL_TOKEN}`, sender `Find Me a Time <no-reply@findmeatime.com>`, `to`, `subject`, `html`, `text` and the header `X-Fmat-Dispatch-Id`. The base URL is injectable; on the production deployment it is fixed. Every send goes through `gateTransport` (decision 13).

Delivery is a durable `email_delivery` job. The domain transition that needs an email inserts the frozen `email_deliveries` row and publishes the job in one transaction. The handler:

1. rechecks that the recipient is still current for the purpose (the challenge is still live, the request still open, the contact unchanged); otherwise marks the delivery `suppressed`;
2. moves the row to `dispatching` and commits before any network call;
3. sends once with a 10-second timeout;
4. records `accepted` only when every intended recipient appears in `result.delivered` or `result.queued`, with the dispatch ID and the provider's lists as evidence; `permanent_bounces` or an error response records `rejected`; a timeout, a lost response or a 5xx records `uncertain`.

A row found in `dispatching` by a later attempt is marked `uncertain` and never sent again. The REST response documents no message ID, so the evidence is the application dispatch ID plus recipient acceptance (D4 (ii)); if a live response does return an ID, it is stored too. Option (b), a Worker relay, would return a `messageId` but adds a deployment.

Setup (D4): onboard `findmeatime.com` in **Compute › Email Service › Email Sending**, which adds MX, SPF and DKIM records on `cf-bounce.findmeatime.com` and a `_dmarc` record. Before onboarding, list existing records with `cf dns records list --zone findmeatime.com` and keep unrelated mail and verification records; an existing `_dmarc` record is reconciled by hand. Create one account-scoped API token with **Email Sending: Edit** only. The account must be on the Workers Paid plan to send to recipients other than verified destination addresses.

### 6. Contact verification

A manually entered or changed address must be verified before it is trusted as attendee or resend recipient; a Google-verified address equal to the contact needs no code. Values (D3): six digits, valid 10 minutes, at most five failed guesses, a 60-second cooldown between codes, 5 codes per request per rolling hour and 10 per recipient per rolling hour. A new code, a contact change or closure invalidates earlier codes.

`verification.request_code` (retry identity from the card) creates the challenge, stores only an HMAC of the code and inserts the delivery in one transaction; an exact retry returns the saved status with no second challenge or email. `verification.confirm` with its retry identity compares in constant time under the challenge lock; a distinct wrong code consumes one attempt, an exact retry consumes nothing, and a correct code sets `contact_verified_email`. The card shows queued, sent, rejected, uncertain, expired and verified from the challenge and delivery rows, never the code. Codes never pass through the conversation: the card posts directly to `/api/requests/{bookingId}/verification`.

### 7. Link resend

`POST /api/booking-links/resend` takes an email address and a retry key and always answers with the same generic acceptance. Behind that answer, in one transaction:

1. charge the fixed-size 600-per-minute attempt budget, which stores only a minute slot and a count; exhausted, stop;
2. find open requests whose `contact_verified_email` equals the address, with unexpired links; none, stop;
3. per matching request, apply one per minute and five per hour per request, five per hour per recipient across requests and 120 per minute service-wide;
4. open the sealed link and insert a frozen delivery carrying it, with the retry key as its identity, so a concurrent or retried call creates at most one delivery and changed input cannot replace a pending one.

Recommended (D10): `booking_links` keeps the UUID sealed with `TOKEN_ENCRYPTION_KEY` (context `booking_link:{requestId}`) beside its hash. Lookup always uses the hash, so a database read without the key yields no usable link, and only resend and the requester's Google return (decision 3) open the seal. Option (b), rotating the link on every resend, would silently break a link the requester's agent or another browser still holds, and the PRD defers rotation. Option (c), dropping resend until rotation exists, leaves the contract's resend requirement unmet.

### 8. Evaluation runs as an application job

Recommended (D5): `evaluate_candidates` publishes an `evaluation` job keyed by `tool:{callId}` for the current request and settings revisions, then waits up to 20 seconds for the evaluation row to leave `pending` and returns the requester projection. A still-pending evaluation returns its ID and the card fills in when the row completes. The **Find times** card action publishes the same job, so candidates are reachable without the model. Phase 4's host review uses the same job with the host projection. Option (b) would run the evaluation inside the tool step, which replays provider calls on recovery and keeps the result out of the domain.

The job runs the deterministic engine in `lib/server/feasibility.ts` with one `AbortController` and a deadline 18 seconds after the job starts work. Every provider call receives the shared signal; pagination, extra calendars and the second party do not reset it.

1. Load the request, the host's confirmed settings and the requester grants at their revisions.
2. Read host busy intervals: `events.list` on the confirmed conflict calendars over the requested windows plus the adjacency horizon, with iteration 1's F02 rules (busy unless cancelled, declined or transparent; copies merged by provider identity; all-day events block time and never anchor travel; note-like exclusions removed).
3. Read requester busy intervals with `freebusy.query` on the selected calendars when a calendar grant exists. A failed or revoked read pauses evaluation as `requester_calendar_unavailable`, offering reconnection or manual availability; it never counts as free.
4. Build candidate intervals from the host's weekly windows (overnight windows owned by their starting weekday, ambiguous or nonexistent boundaries yielding no candidate), intersected with the requester's windows, the requested duration and the 15-minute start grid.
5. Remove candidates overlapping busy or focus intervals after applying buffers before and after.
6. For in-person candidates, check both travel legs (decision 9). Unresolved legs exclude the candidate from requester output and are recorded for the host.
7. Order by the weekly limit preference: weeks below the limit first.
8. Rank the first 20 valid candidates with the model (2,048 output tokens, two attempts, the remaining deadline). The ranking may only reorder IDs it was given; an unknown or duplicated ID discards the ranking and keeps the deterministic order.
9. Under the request lock, recheck that the request and settings revisions are unchanged and the deadline has not passed, then publish. Otherwise the evaluation becomes `incomplete` and publishes nothing.

Explanations are code-computed sentences from the candidate's basis (iteration 1's F09), never model text. The requester projection contains instants, display times, duration, mode and location plan; no rule, buffer, travel estimate or event detail.

### 9. Travel legs and Google Routes

For an in-person candidate, the adjacent commitments are the nearest busy timed host events that end before it and start after it on the same local day within a 3-hour horizon. Beyond the horizon, or with no such event, the leg is not checked. An adjacent event's endpoint is its location text; an event without a physical location (empty, a conference link only, or both a place and a link) has an unknown endpoint, so the leg is unresolved, as the PRD forbids inferring home or office.

Each leg calls `computeRoutes` with address waypoints, the host's confirmed mode (`DRIVE`, `TRANSIT` or `WALK`; **Depends on the trip** makes the leg unresolved until the host chooses), and the departure time (the previous event's end for the inbound leg, the candidate's end for the outbound one), with `TRAFFIC_AWARE` for driving. A leg fits when the route duration plus the host's buffer and extra travel buffer fits the gap.

Geography and freshness (D1): no country list. A response with no route, an unsupported mode or a failure leaves the leg unresolved. Lane C records, against the live API, which modes return routes for a Seoul origin and destination, because Google restricts driving and walking directions in South Korea; if only transit works there, Korean hosts with driving or walking will see unresolved legs until Phase 4's allowance control, which the acceptance record notes. Estimates are cached in `route_estimates` for 24 hours per origin, destination, mode and 15-minute departure slot; a changed event location changes the key. Phase 4's booking revalidation refetches estimates older than one hour. Endpoints are stored as keyed hashes plus Google place IDs, never as cleartext event locations beyond the evaluation.

Route calls use a server key restricted to the Routes API, held in `GOOGLE_ROUTES_API_KEY`, with the field mask `routes.duration,routes.distanceMeters` to stay in the basic billing tier.

### 10. Manual travel allowances

Recommended (D2): an allowance is bound to one request, one direction (inbound or outbound), the origin and destination endpoints and the mode, in 5-minute steps from 5 to 240 minutes. It resolves every candidate leg with the same binding and is invalidated when an endpoint, the mode or the request's location changes. The engine reads confirmed allowances from `travel_allowances`; Phase 4's rule and travel review card creates them. Phase 3 tests the engine with fixture allowances. Option (a) makes the host confirm each candidate separately; option (c) turns a one-off estimate into a standing rule the contract does not ask for.

### 11. Online meeting link plan

Recommended (D6): the proposal's `link_plan` is `google_meet` (a Meet conference created with the event in the host's booking destination) or `requester_link` (a URL the requester supplied, validated as `https:` and shown in the proposal). An online request offers `google_meet` when the destination calendar's `conferenceProperties.allowedConferenceSolutionTypes` includes `hangoutsMeet`, read with the calendar list at evaluation; otherwise the requester is asked for a link. Agreement and Phase 4's approval cover the plan; Phase 4 creates the conference with `conferenceDataVersion=1`. Option (b) needs a new setup field and confirmation in Phase 2's flow.

### 12. Requester conversation

`agent/tools/requester.ts` is a `defineDynamic` resolver that returns `read_request`, `draft_request_review`, `evaluate_candidates` and `read_booking_status` only when the principal's audience is `requester`, and `agent/instructions/requester.ts` resolves `requester.md` the same way. Each tool checks the fence first: the request is open, its link unexpired and the session is the discussion's current generation. Host tools are absent from requester sessions.

| Tool | Behavior |
|---|---|
| `read_request` | Requester projection: details with contact presence indicators, the pending review, the current proposal, agreement and status |
| `draft_request_review` | Declares `details`, `availability`, `question` or `unknown`. Question and unknown carry no patch and at least one authored clarification category. Details and availability carry a patch whose windows start in the future and fit the known duration. Creates a pending review against the base revision; supersedes the earlier pending review. Retry key `tool:{callId}` |
| `evaluate_candidates` | Decision 8 |
| `read_booking_status` | Status from domain records; until Phase 4, awaiting approval at most |

Clarification categories (`missing_date`, `missing_time`, `missing_timezone`, `ambiguous_local_time`, `missing_duration`, `missing_mode`, `missing_location`, `unclear_location`, `missing_purpose`) each have one authored English and one authored Korean question in `lib/contracts/clarifications.ts`. The language is the request's, set from the browser and changed only by the requester.

Cards on `/booking/[bookingId]`, each posting to `/api/requests/{bookingId}/commands` with the expected revision and a retry key:

| Card | Command |
|---|---|
| Review extracted details: **Apply these details**, **Dismiss** | `request.apply_review`, `request.dismiss_review` |
| Calendar connection: **Connect Google Calendar**, **Skip for now**, **Disconnect** | Decision 3; `request.set_manual_availability` |
| Contact verification | Decision 6 |
| Candidate times: **Choose this time**, **Find other times** | `request.choose_candidate` creates the next proposal version from a candidate of the current evaluation; `request.evaluate` |
| Proposal: **Agree to this proposal** | `request.agree` names the proposal version; rejected unless it is the current version, its start is still in the future after the lock, the contact is verified and the request is open |
| Status: **Withdraw request** | `request.withdraw` |

A message such as "yes" records nothing: agreement exists only as an `agreements` row written by `request.agree`.

### 13. Local messaging

Recommended (D9): `messagingAdmitted` admits production as today and admits local execution only when the transport's configured base URL resolves to a loopback host (`localhost`, `127.0.0.1`, `::1`). Local runs therefore reach a stand-in provider, like the local OpenAI stand-in, and a real `CLOUDFLARE_EMAIL_TOKEN` in `.env.local` sends nothing. The gate takes the transport's endpoint as an argument; transports call it before any network access. This lands, with the `messaging-environments` delta's scenarios as tests, before the Cloudflare adapter.

### 14. Conversation admission and redaction

Both run in the application message route before eve sees anything, for host and requester discussions alike.

Admission follows the existing contract numbers: 20 per minute and 100 per hour per host account or request, 200 per minute and 2,000 per hour service-wide. Each scope and window is one `admission_windows` row whose window starts at the first accepted message after expiry. Under row locks taken in a fixed order (scope, then service), the route charges every applicable window and records the accepted input in one transaction; any exhausted window rejects the whole input with HTTP 429 and the safe temporary-limit message, and the browser keeps the unsent text. An exact retry of an accepted input returns its receipt without charging.

Redaction in `lib/server/redaction.ts` replaces, before persistence, `Bearer` values, `LINK <UUID> <proof>`, and URL parameters or fragments whose percent-decoded, case-folded name is one of `token`, `code`, `state`, `secret`, `proof`, `recovery`, `invitation`, `credential` or ends in `_token`, with `[removed credential]`. The booking link's own path is not a credential parameter and stays. The input's retry fingerprint is computed over the original text and stored only as an HMAC (`protected_fingerprint`), so a changed secret under the same retry key conflicts while the plaintext is gone.

### 15. Timezone

The browser's IANA zone is the initial display zone, stored per tab in `sessionStorage` once the requester chooses one explicitly, and sent with each command that interprets local times. The request stores the requester's zone for window interpretation; changing only the display zone converts the same instants. Local inputs that are ambiguous or nonexistent in their zone produce the `ambiguous_local_time` clarification. Times render with the date-specific offset (`Mon 3 Nov, 10:00 GMT+9`).

### 16. Tests

| Layer | Covers |
|---|---|
| Unit (beside modules) | Engine: full intervals, buffers, overnight windows, DST gaps and overlaps, focus blocks, the weekly limit order, both travel legs, unknown endpoints, allowances, the deadline with a fake clock; redaction patterns and encodings; clarification wording per category and language; window validation |
| Integration (`tests/integration/`) | Request creation, bounds and the unavailable result; booking link expiry and closure; reviews with stale revisions and retries; agreement on a superseded or started proposal; withdrawal and expiry; verification codes, attempts, cooldown and lost responses; link resend limits and generic answers; the Cloudflare adapter against a fake server, including lost responses and bounces; the OAuth callback with replay, wrong browser and cancellation against a fake Google; requester Calendar failure; evaluation against fake Calendar and Routes servers with a stalled page; admission concurrency; messaging denial for local with a real endpoint |
| Database (`supabase/tests/`) | `anon` and `authenticated` reach no new table or function |
| Browser (`tests/e2e/`) | A requester goes from `/{handle}` to agreement against fake Google, fake Routes, fake Cloudflare and the OpenAI stand-in; keyboard use and 390-pixel width; the unavailable view with resend |
| Evals (`evals/`) | Injection asking for calendar contents or approval; "yes" or "book it"; an ambiguous time producing the authored question in Korean; the requester tool list containing no host tool |

## Risks / Trade-offs

- **Testing-mode Google app.** Until the app is published, requester Google consent works only for listed test users, so AC-27's live evidence uses test-user accounts. Mitigation: `REQUESTER_GOOGLE_ENABLED` and manual availability.
- **Driving and walking routes in South Korea.** If Google returns no route, every in-person candidate with an adjacent commitment is unresolved for Korean hosts until Phase 4's allowance control. Mitigation: the Lane C check records it and the decision can move to D1 (b) before launch.
- **Sealed booking link.** A database dump plus the encryption key yields live links. Mitigation: the key lives only in Vercel Production, links expire after 30 days, and only two operations open the seal.
- **No idempotency at Cloudflare.** A lost response cannot be retried safely. Mitigation: uncertain is a terminal delivery state; the requester can ask for a new code after the cooldown.
- **Evaluation latency.** A full evaluation with ranking can take most of 18 seconds. Mitigation: the tool returns a pending evaluation and the card completes from the record.

## Migration Plan

One declarative sync generates the table migration; the expiry schedule goes in its own `supabase migration new` migration mirrored under `supabase/schemas/app/cron/`. `supabase db reset --local` must rebuild the chain. The shared project receives the migrations through the `Deploy shared Supabase` workflow if its secrets are set by then; otherwise, as in Phases 1 and 2, by `supabase db push --linked` after a shown dry run and with the user's explicit approval, recorded in the acceptance record. The Google redirect URIs, the Routes key, the Cloudflare onboarding and token, and the Vercel variables are configured before the evidence run. Rollback: the tables are additive; reverting the deployment returns `/{handle}` to "not accepting requests".

## Open Questions

- Team sign-off on D1–D10; the plan's **Teammate review** box tracks it.
- Whether a live Cloudflare REST response carries a message identifier; Lane B's first controlled send answers it.
- Google app verification for the requester Calendar scopes, which the host submission should include.
