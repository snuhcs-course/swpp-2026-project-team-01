# Acceptance Record

Status: Phase 1 (`application-foundation`) and Phase 2 (`host-onboarding`) evidence recorded; Phase 3 (`requester-intake-and-feasibility`) release recorded, its acceptance evidence pending; Phase 4 (`host-review-and-booking`) local evidence recorded, production evidence pending; Phase 7 (`requester-email-channel`) local evidence recorded, inbox and production evidence pending; open gaps listed below

Date: 2026-10-22

This record lists the evidence each phase of the [implementation plan](06_implementation_plan.md) produced, against the evidence list of that phase. Every entry names the command, the date, the revision and the environment it ran in. Fixture and local-stack runs prove logic; only the entries marked **production** prove the deployed integration. Tokens, secrets, email addresses and personal message text are kept out of this record.

## Phase 1 — `application-foundation`

Change: [`application-foundation`](../../openspec/changes/application-foundation/tasks.md). Evidence list: [Phase 1](06_implementation_plan.md#phase-1--application-foundation).

### Environments

| Name | What it is |
|---|---|
| Local stack | Supabase CLI 2.119.0 local stack (PostgreSQL 17) on macOS with Node.js 24.21.0, migrations applied by `supabase db reset --local`; eve dev, the web service and a local OpenAI stand-in started by the suites |
| CI | GitHub Actions `Check` workflow on `ubuntu-latest` with Node.js 24: jobs `application`, `database` (local stack, then integration and browser tests) and `documentation` |
| Production | Vercel project `findmeatime-release` (Production, functions in `cle1`) on `https://findmeatime.com` and `https://release.findmeatime.com`, backed by the shared Supabase project `anelszynxtvxoxqvzgqt` |

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local` | 2026-10-19 | `8c6b474b` | Local stack | Rebuilt the full migration chain, exit 0 |
| `supabase test db` | 2026-10-19 | `8c6b474b` | Local stack | 3 files, 47 pgTAP tests passed |
| `npm run build`, `npm run lint`, `npm run typecheck` | 2026-10-19 | `8c6b474b` | Local stack | Each exit 0 |
| `npm test` | 2026-10-19 | `8c6b474b` | Local stack | 10 files, 79 tests passed |
| `npm run test:integration` | 2026-10-19 | `8c6b474b` | Local stack | 16 files, 174 tests passed |
| `npm run test:e2e` | 2026-10-19 | `8c6b474b` | Local stack | 17 Playwright tests passed, the first-reply journey against the local OpenAI stand-in |
| `npm run check` | 2026-10-19 | `8c6b474b` | Local stack | Documentation links and `openspec validate --all --strict` passed |
| `Check` workflow, [run 39247520591](https://github.com/snuhcs-course/swpp-2026-project-team-01/actions/runs/39247520591) | 2026-10-19 | `8c6b474b` | CI | All three jobs passed: unit 10 files / 79 tests, pgTAP 3 files / 47 tests, integration 16 files / 174 tests, browser 17 tests |

Revision `8c6b474b` is also the one deployed to production. Commits after it on this branch change documentation only.

### Evidence by item

Each item names the test file and test titles that carry it. All ran in the suite runs above (local stack and CI) unless the entry says otherwise.

**Two-host isolation.** `tests/integration/conversations.test.ts`: "keeps one host out of another host's session". `tests/integration/recovery.test.ts`: "serves no history to another host". `tests/integration/eve-channel-auth.test.ts`: "denies a foreign or unindexed session ID".

**Unauthorized raw runtime routes.** `tests/integration/eve-channel-auth.test.ts`, run under `eve dev` and under `eve build` plus `eve start`: "denies a request with no credential", "denies a current-project Vercel OIDC token", "denies a browser POST /eve/v1/session", "denies a browser POST /eve/v1/session/:sessionId", "denies an expired or tampered internal bearer", "denies a foreign or unindexed session ID", "denies a stale generation", "denies a signed-out session", "denies a fixture-suspended host", and "lets a read bearer read only the session it names"; each denial asserts no model work and no recorded event. `tests/integration/eve-surface.test.ts`: "reports health without revealing configuration". `tests/integration/data-api-exposure.test.ts` and `supabase/tests/app_grants.test.sql` show `anon` and `authenticated` reach no application table or function.

**Cancelled and replayed sign-in.** `tests/integration/google-sign-in.test.ts`: "establishes no session when Google sign-in is cancelled", "establishes no session when the code is replayed", "establishes no session when the callback arrives in another browser", "returns a completed sign-in to /app with a session, ignoring a supplied destination", "rejects an email sign-in request without sending mail", and, for more than one origin, "starts and finishes sign-in on the origin the request came to" and "refuses an unlisted host, whether in the URL or a forwarded header, without redirecting". Google's own leg is simulated against local Supabase Auth.

**Reconnect versus terminal recovery.** `tests/integration/recovery.test.ts`: "reads history in order across a recovered conversation, from any cursor" (reconnect from an old cursor), "creates one successor for concurrent and repeated recovery", "refuses uncertain runtime state", "recovers a recorded model-authentication failure after the key is corrected, keeping prior charges", "denies the model when allowance is exhausted during recovery, keeping history readable", "denies recovery when authority is revoked while it waits for its lock", "denies a retired generation a model reservation" and "continues input accepted after the failure with its original identity". `tests/e2e/workspace.test.ts`: "Restart Thyme recovers a failed conversation and keeps the message once".

**Model limit exhaustion.** `tests/integration/model-limits.test.ts`: "reserves only the principal's remaining capacity under concurrent work", "reserves only the service's remaining capacity under concurrent work", "caps a conversation input at eight attempts", "denies an unattributable call before any provider request or reservation", "enforces the output cap, storage off and the standard tier over the caller's options" and the deadline tests. `tests/integration/conversations.test.ts`: "reserves every provider call of a turn with a forced retry and a forced compaction". `tests/e2e/workspace.test.ts`: "saved history stays readable after the model allowance is exhausted".

**Preview messaging and worker denial.** `lib/server/messaging.test.ts`: "refuses %s before any network call" and "leaves delivery state untouched when %s wakes a delivery worker", for preview, Vercel development and contradictory deployment metadata. `tests/integration/job-worker.test.ts`: "refuses on %s before touching job state" for seven non-production environments, and "leaves a preview-produced job unclaimed and visible while production work runs".

**AC-26, first half.** `tests/integration/host-admission.test.ts`: "creates one active host account on first sign-in", "returns the same account on a repeated sign-in" and "creates one account for two concurrent callbacks of one identity"; "rejects a suspended host's operation without changing host data" covers the guard. The same file's "lets an active host operate but gives an unready host no public profile" passes trivially in Phase 1: no host can complete setup and no public profile route exists, so readiness is always false. The publish-before-setup and suspension halves of AC-26 are Phase 2 evidence.

**The chain rebuilds.** `supabase db reset --local` in the suite runs above, and the CI `database` job's "Start the local stack and apply the migration chain" step.

**First reply from the live model.** `E2E_LIVE_MODEL=1 npm run test:e2e` on 2026-10-19 at revision `223152a5`, local stack with the real `gpt-5.6-terra`: `tests/e2e/first-reply.test.ts` "a new host signs in, lands on /app with an empty setup session and gets Thyme's first reply" passed. The browser signed in through the real `/auth/sign-in` and `/auth/callback` routes, landed on `/app` with an indexed, empty generation-1 setup session, and received a streamed reply (16 appended message events) with one model reservation. Without the flag the same journey runs against the local stand-in in every browser run.

### Production deployment

Run by the lead on 2026-10-19 against the **production** deployment of revision `8c6b474b`.

| Check | Command | Result |
|---|---|---|
| Shared project before the push | `supabase migration list --linked`, a read of `pg_namespace` | No application schema and no remote migrations |
| Migrations | `supabase db push --linked --dry-run`, then `supabase db push --linked` | 14 migrations listed and applied; `supabase migration list --linked` shows 14 |
| Schema drift | `supabase db diff --linked` | Only `CREATE EXTENSION pgmq`, preinstalled on the project and not declared by the chain; no application drift |
| Auth configuration | `supabase config push`, then `supabase config diff` | Site URL `https://findmeatime.com` and the three callback URLs applied; no remaining updates; Google provider unchanged |
| Worker wake-up | Vault entries and the `app-jobs-sweep` cron history | Worker URL on the canonical origin; the every-minute sweep succeeds |
| Function region | `vercel inspect` on the production deployment | Functions in `cle1` |
| Domains | `vercel domains inspect findmeatime.com` | `findmeatime-release` serves `findmeatime.com` and `release.findmeatime.com` |
| DNS | `dig +short A findmeatime.com @1.1.1.1` and the same for `release.findmeatime.com` | Both resolve to the address Vercel requires; Cloudflare records are DNS only |
| HTTPS, both origins | Requests to `/`, `/app`, `/eve/v1/health` | 200 each |
| Raw runtime route | Unauthenticated `POST /eve/v1/session` | 401 |
| Worker route | `POST /api/internal/jobs` with no secret, a wrong secret, the right secret | 401, 401, 200 with nothing claimed |
| Sign-in start | `GET /auth/sign-in` on each origin | 303 to Supabase Auth with that origin's `/auth/callback`, PKCE S256, offline access and the three Calendar scopes |
| Headers | Response headers | Content Security Policy and HSTS present |
| Signed-in turn | A real Google sign-in by a team member on `https://findmeatime.com`, then one message in `/app` | Landed on `/app`; Thyme's reply streamed. The database held one host account, one Google identity, one provider grant with the three Calendar scopes and one sealed refresh token, one indexed session, the input completed, and one model reservation |

### Known gaps

- **Deploy workflow secrets.** The `Deploy shared Supabase` workflow's repository secrets and variables are not set, so it has never run; task 2.3 stays open. The one push so far was by hand, as [provider setup](03_provider_setup.md#environments-and-collaboration) records.
- **Second origin sign-in.** No person has signed in on `https://release.findmeatime.com`; only its redirect and allowlist entry are verified.
- **Google OAuth publishing status** is not recorded, and the sandbox callback registration of task 2.8 is open.
- **`pg_net` grants.** The platform grants `PUBLIC` access to `net.http_request_queue` and `net._http_response`, and `postgres` cannot revoke it. The application keeps `net` outside the Data API (`tests/integration/data-api-exposure.test.ts`), but queued wake-ups carry the worker secret briefly. Not inspected on the hosted project.
- **Sign-up budget.** Any Google account that completes sign-in becomes an active host with its own model allowance, so many sign-ups can drain the shared cap. The OAuth app's testing audience limits this today; Phase 2 adds admission control before the app is published.
- **Stale Vercel variables.** Variables left by the earlier prototype remain on `findmeatime-release`, unused; remove them.

## Phase 2 — `host-onboarding`

Change: [`host-onboarding`](../../openspec/changes/host-onboarding/tasks.md). Evidence list: [Phase 2](06_implementation_plan.md#phase-2--host-onboarding). Environments as in Phase 1; the browser and integration suites also run a local Google stand-in (`tests/e2e/support/fake-google-server.ts`, `tests/integration/support/fake-google.ts`) for the token endpoint and Calendar API.

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local`, then a declarative sync | 2026-10-19 | `beff3899` | Local stack | Chain rebuilt; the sync generated no migration (no drift) |
| `supabase test db` | 2026-10-20 | `3aa0ad86` | Local stack | 4 files, 59 pgTAP tests passed |
| `npm run build`, `npm run lint`, `npm run typecheck` | 2026-10-20 | `3aa0ad86` | Local stack | Each exit 0 (three lint warnings in Phase 1 files) |
| `npm test` | 2026-10-20 | `3aa0ad86` | Local stack | 232 tests passed |
| `npm run test:integration` | 2026-10-20 | `3aa0ad86` | Local stack | 281 tests passed |
| `npm run test:e2e` | 2026-10-20 | `3aa0ad86` | Local stack | 28 Playwright tests passed, against the local OpenAI and Google stand-ins |
| `npm run check` | 2026-10-20 | `3aa0ad86` | Local stack | Documentation links and `openspec validate --all --strict` passed |

### Evidence by item

**AC-26, web and direct API paths.**
- *One account, no duplicate:* the Phase 1 tests in `tests/integration/host-admission.test.ts` still pass.
- *No publication before setup:* `tests/integration/setup-tools.test.ts` "returns links only once the host is ready"; `tests/integration/setup-confirm.test.ts` "rejects a stale review by revision or by proposal, saving nothing"; `tests/integration/entry-documents.test.ts` "gives the same neutral 404 for invalid, reserved, unknown, released, unready and suspended hosts". The direct API path is `/api/setup/commands` (`tests/integration/setup-state.test.ts` "serves the signed-in host's state privately and runs card commands with their revisions", "refuses a signed-out request and a cross-site command").
- *Setup completes:* `tests/e2e/host-setup.test.ts` "a new host completes setup from the authored messages to working public pages"; `tests/integration/setup-confirm.test.ts` "makes the host ready with its links on the configured origin".
- *Suspension and restoration:* `tests/integration/operator.test.ts` "suspends a host: hosting is refused and the public profile disappears, with an audit row", "restores a host by account ID with its saved setup and public profile", "denies the operator function to Data API roles"; `tests/integration/setup-tools.test.ts` "denies a retired generation, a suspended host and another audience before reading".
- *Abuse limits:* `tests/integration/signup-limits.test.ts` (all three); `tests/integration/handles.test.ts` (all seven).
- *Pending:* MCP and CLI paths (Phase 5, where those interfaces first exist; none can publish today because none exists), and the requester calendar connection and account-free contact of an active host (Phase 3).

**AC-28.**
- *Calendars from actual metadata with reasons; duplicate names; read-only destination:* `tests/integration/google-calendar.test.ts` "lists actual calendars by provider identity, keeping two with the same name apart"; `tests/integration/calendar-roles.test.ts` "rejects a read-only destination and keeps the previous roles"; `tests/integration/setup-state.test.ts` "lists the live calendars with recommendations while choosing calendars".
- *Analysis of selected calendars, partial and failed reads, revoked access:* `tests/integration/calendar-analysis.test.ts` "stores the evidence dimensions of the saved conflict calendars", "discloses a partial failure, stores no evidence and commits the failure", "records a revoked grant as a failed scan and marks the grant invalid", "does not scan again on reload or redelivery"; `tests/integration/setup-state.test.ts` "reports a revoked grant instead of an empty calendar list", "asks a ready host whose Google access was revoked to connect Calendar again".
- *Suggestions first, labels, sparse evidence, corrections respected:* unit tests in `lib/server/analysis.test.ts` and `lib/server/setup.test.ts` (small-sample fallback, precedence); `tests/integration/setup-commands.test.ts` "refuses Use this as stale when the proposed value is no longer the one shown"; `tests/integration/setup-tools.test.ts` "writes values unaccepted and labeled, and rejects a stale revision".
- *Stale review:* `tests/e2e/host-setup.test.ts` "a stale review is rejected and nothing is saved".
- *Resume after browser return:* `tests/e2e/host-setup.test.ts` "declined Calendar scopes show Connect Google Calendar with the consent link"; production check of the consent redirect below.
- *Mobile and keyboard:* `tests/e2e/host-setup.test.ts` "the review card works by keyboard alone" and the 390 and 1280 pixel layout assertions in the journey; the reduced-motion reveal test.
- *Pending:* the inline iMessage connection or skip (Phase 6).

**FR-04 checks from the onboarding checklist.**
- *Mode, location and transport are explicit; online-only skips transport:* `tests/integration/setup-tools.test.ts` "cannot answer mode, location or transport without source stated, or replace the host's answer"; `tests/e2e/host-setup.test.ts` "a mode the assistant recorded shows as You said and counts only after Use this"; `tests/integration/setup-state.test.ts` "moves to confirmation once the host answers the mode, and writes on read only the first browser zone".
- *Defaults never described as observed:* the starter-default reasons in `lib/server/analysis.test.ts` and the source badges in `apps/web/app/_components/setup/format.test.ts`.
- *Links only after readiness:* see AC-26 above.
- *Analysis evidence expires and adopted values remain:* `tests/integration/analysis-cleanup.test.ts` "removes expired rows in bounded passes and keeps recent ones", "skips a row another transaction holds and removes it on a later pass", "leaves adopted draft and confirmed values untouched".

**Conversation-access scenarios deferred from Phase 1.** "Tool result lost after commit": `tests/integration/setup-tools.test.ts` "replays a call with the same call ID without a second write" and "replays the saved outcome after the host accepted the drafted value on its card". "Committed tool result before failure": "does not advance the revision for identical values under a new call ID". Per-audience registration: `tests/integration/eve-channel-auth.test.ts` asserts the host setup model request carries `read_setup_state`, `draft_settings` and the host-setup fragment under `eve dev` and the build; `npx eve info` lists `tools/setup.ts` as a dynamic resolver.

### Production deployment

Run by the lead on 2026-10-20 against the **production** deployment of revision `3aa0ad86` (`dpl_42ZqP3jUaHC25Y4VFFhrnwRvv4XK`).

| Check | Command | Result |
|---|---|---|
| Shared project before the push | `supabase migration list --linked` | The 14 Phase 1 migrations applied, the 2 Phase 2 migrations pending |
| Migrations | `supabase db push --linked --dry-run`, then `supabase db push --linked` | `20261019144149_host_onboarding.sql` and `20261019144158_schedule_analysis_cleanup.sql` listed, then applied; `supabase migration list --linked` shows 16 |
| Schema drift | `supabase db diff --linked` | Only the preinstalled `pgmq` extension, as in Phase 1 |
| Deployment | `vercel deploy --prod`, `vercel inspect` | Ready; aliased to `findmeatime.com` and `release.findmeatime.com` |
| Entry documents, both origins | `curl` of `/SKILL.md`, `/llms.txt`, `/nobody-here/SKILL.md`, `/app/SKILL.md` | 200 Markdown, 200 text, 404, 404; `cache-control: no-store`; no `set-cookie` |
| Markdown negotiation | `curl -H "Accept: text/markdown" /` on both origins | 200 `text/markdown`, `Vary: Accept`, no cookie |
| Renewed Calendar consent | `GET /auth/sign-in?consent=calendar` on both origins | 303 to Supabase Auth with that origin's callback, `prompt=consent`, `include_granted_scopes=true`, offline access, PKCE S256 |
| Setup API | Unauthenticated `GET /api/setup/state`; cross-site `POST /api/setup/commands` | 401; 403 |

The manual push is the exception recorded in the [design](../../openspec/changes/host-onboarding/design.md#migration-plan): the user approved it again on 2026-10-20, because the deploy workflow's secrets are still not set.

### Known gaps

- **Signed-in setup on production.** A team member's real Google sign-in on `https://findmeatime.com` that completes setup and opens the resulting `/{handle}` and `/{handle}/SKILL.md` is pending. It also confirms that the Vercel Production `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, which predate this change, are the client Supabase Auth uses; a mismatch shows as Calendar unavailable on the calendar card.
- **Google app verification.** The OAuth app is in **Testing** (reported by the user on 2026-10-20): only listed test users can sign in, and refresh tokens expire after seven days, which invalidates stored Calendar grants weekly (hosts then see **Connect Google Calendar**). Moving it to **In production** and submitting the sensitive Calendar scopes for verification are console steps for the project owner.
- **Real Google Calendar data.** Analysis and roles are verified against the stand-in only until the signed-in production check runs.
- **Handle check rate.** `/api/setup/handle` has no rate limit; recorded as a risk in the design.
- **Host page status code.** The unavailable `/{handle}` page renders the neutral not-found view with status 200 and `noindex`, because the streamed page cannot change its status; the `SKILL.md` routes return a real 404.

## Phase 3 — `requester-intake-and-feasibility`

The change was merged and released in three pull requests. Its acceptance evidence (task 7.1) is not recorded yet; this section records the release so far. Every decision behind it is in the [decision log](08_decision_log.md#phase-3--requester-intake-and-feasibility).

### Production deployment

Run by the lead on 2026-10-22 against the **production** deployment `findmeatime-release`.

| Step | Revision and deployment | Command | Result |
|---|---|---|---|
| PR #26 merged (admin bypass) | `5f2681ea` | `supabase migration list --linked`, then `supabase db push --linked --dry-run` | The 16 Phase 1 and 2 migrations applied; `20261021110927_requester_intake_and_feasibility.sql`, `20261021110942_request_expiry_schedule.sql` and `20261021135225_model_reservation_anonymous.sql` listed. `supabase db diff --linked` showed only the Phase 3 objects and the preinstalled `pgmq` extension |
| Migrations | `5f2681ea` | `supabase db push --linked` | The three applied; 19 listed |
| Deployment | `5f2681ea`, `dpl_HboMKsV1Lhgn31p1hvwWAiioGYUe` | `vercel deploy --prod` from a clean checkout of `origin/main` | Ready; aliased to `findmeatime.com` and `release.findmeatime.com` |
| PR #27 merged (admin bypass) | `fdccf26e`, `dpl_MoVx2TjuyxmyjtseY3GzK4javxKx` | `vercel deploy --prod` | Ready; no migration |
| PR #28 merged (admin bypass) | `9415fe11` | `supabase db push --linked --dry-run` | `20261021191248_guest_draft_requests.sql` and `20261021194840_guest_calendar_step.sql` listed |
| Migrations | `9415fe11` | `supabase db push --linked`, `supabase migration list --linked` | Both applied; 21 listed, none pending |
| Deployment | `9415fe11`, `dpl_3PDifXmnhwYn59rdBdSo3cBYwdxM` | `vercel deploy --prod` from a clean checkout of `origin/main` | Ready |
| Smoke test, after each deployment | `9415fe11` | `curl` of `/`, `release.findmeatime.com/`, `/app`, `/SKILL.md`, `/llms.txt`, a ready host's `/{handle}` and `/{handle}/SKILL.md`, an unknown `/booking/{uuid}` | All 200. The booking view sends `referrer-policy: no-referrer`, `x-robots-tag: noindex`, `cache-control: no-store` and offers **Resend my booking link**. The retired `/api/intake/{handle}/messages` returns 404. The host document says requests are accepted |
| Public page | `9415fe11` | Browser, no message sent | The host header, the collapsed agent and resend sections, the timezone line and an empty thread with the composer; no form outside the thread |
| Google redirect URIs | — | Google's authorization endpoint with the host client and each callback, no sign-in | The three `/connections/google/callback` URIs reach the sign-in page; an unregistered one gets `redirect_uri_mismatch` |

The manual pushes repeat the exception from Phases 1 and 2: the user approved each on 2026-10-22, because the deploy workflow's secrets are still not set. Local suites on the merged revisions are listed in the pull requests: 384 unit and 459–460 integration tests, the guest Playwright journey, the build and `npm run check`.

### Known gaps

- **Acceptance evidence (task 7.1).** AC-01 through intake and candidates, AC-02, AC-03 requester side, AC-12, AC-13 withdrawal and AC-27 on production, and the controlled Cloudflare delivery of a creation email with its confirmation link and of a resent link, are pending. No message was sent in production.
- **Routes API.** Not confirmed enabled for `GOOGLE_MAPS_API_KEY`; the live Seoul routing check (task 5.2) has not run.
- **Real-model evals (task 6.4).** Not run.
- **Requester Google consent.** The redirect URIs are registered; consent with a test user has not been completed.
- **Shared-project data.** An earlier test intake and request remain; they were not deleted.

## Phase 4 — `host-review-and-booking`

Change: [`host-review-and-booking`](../../openspec/changes/host-review-and-booking/tasks.md). Evidence list: [Phase 4](06_implementation_plan.md#phase-4--host-review-and-booking). Environments as in Phase 1, with the local Google stand-in extended to `events.insert` and `events.get` (fixed event IDs, `409` on a duplicate, lost responses before and after creation) and the local Cloudflare stand-in recording `reply_to` and attachments. Nothing here ran against production.

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local`, then a declarative sync | 2026-10-22 | `b45b794d` | Local stack | Chain rebuilt with `20261022021159_host_review_and_booking.sql`; the sync generated no further migration |
| `supabase test db` | 2026-10-22 | `70f5fb63` | Local stack | 6 files, 92 pgTAP tests passed, including `host_review_booking.test.sql` |
| `npm test` | 2026-10-22 | `70f5fb63` | Local stack | 404 tests passed (41 files) |
| `npm run test:integration` | 2026-10-22 | `70f5fb63` | Local stack | 495 tests passed (47 files), after updating the two closed-view assertions for the receipt |
| `npm run test:e2e` | 2026-10-22 | `70f5fb63` | Local stack | 34 of 35 Playwright tests passed; the Phase 3 requester journey at 1280 px missed a heading focus under the parallel run, and passed when rerun alone |

### Evidence by item

Fixture and local-stack evidence only; each names the test that shows it.

| Item | Evidence |
|---|---|
| AC-01 in full | Phase 3's `tests/e2e/requester-intake.test.ts` to agreement, then `tests/e2e/host-review.test.ts` "the host approves from the inbox and both sides see the receipt" at 390 and 1280 px: inbox, approval, the booking job, the host receipt with **Join meeting** and the requester's receipt at the booking link |
| AC-03 | `tests/integration/host-requests.test.ts` "holds every candidate in a full week until the host waives the limit" and "applies a host allowance for an unresolved trip of one candidate": the requester projection carries no rule, limit or allowance |
| AC-04 | `host-requests.test.ts` "shares a feasible later time as a checked new version": the old version can no longer be approved; the requester agrees and the host approves again |
| AC-06 web-only | `tests/integration/bookings.test.ts` "returns the same booking to a second approval with another retry key" |
| AC-07 | `bookings.test.ts` "stops at revalidation when a busy event appeared" and "dispatches only one of two competing bookings for the same host" |
| AC-08 | `bookings.test.ts` "reconciles a lost response by reading the event, never inserting twice" and "inserts the same frozen payload again when the first insert never arrived" |
| AC-09 | `bookings.test.ts` "fails definitively on a refused write and lets the host retry", "records revoked Calendar access"; `tests/integration/booking-emails.test.ts` "keeps the booking confirmed when a copy bounces, and sends nothing twice" |
| AC-10 web-only | `tests/integration/host-review.test.ts`: "Approve it and book it." in the private discussion records nothing, and the session lists only the host-review tools; the requester side is Phase 3's |
| AC-13 | `bookings.test.ts` "lets the requester withdraw a reserved booking", "refuses withdrawal and decline once dispatch may have begun", "declines with the requester's status email" (a late approval answers `request_closed`), "cancels a reserved booking whose request expired" |
| Confirmation consistency | `booking-emails.test.ts` "sends each party a copy with the host's name, Reply-To the other party and the matching calendar part"; `lib/server/booking-emails.test.ts` for both languages and the calendar part |

### Known gaps

- **Controlled Google Calendar and inbox.** A confirmed event in a team-controlled Google Calendar and its confirmation, with the calendar part, in a team-controlled inbox are pending: the migration is not on the shared project and production is not redeployed (decision log, "Blocked on the user").
- **Cloudflare attachments.** Whether Cloudflare's REST API delivers a `text/calendar` attachment that Gmail and Outlook treat as an invitation is unverified.
- **Reminders** are deferred by D3.


## Phase 7 — `requester-email-channel`

Change: [`requester-email-channel`](../../openspec/changes/requester-email-channel/tasks.md). Evidence list: [Phase 7](06_implementation_plan.md#phase-7--requester-email-channel). Environments as in Phase 1, except that the local stack was a separate one (`project_id` `fmat-phase7`, ports 553xx) so the parallel Phase 5 session's stack was never reset ([decision log](08_decision_log.md#phase-7--requester-email-channel)), and a local AgentMail stand-in (`tests/integration/support/fake-agentmail.ts`) served the message API, recorded replies and honored `Idempotency-Key`. No inbox exists and nothing ran against AgentMail or production.

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local`, then a declarative sync | 2026-10-23 | `ea295024` | Separate local stack | Chain rebuilt with `20261022132547_email_ingress.sql`, `20261022133116_email_threads.sql` and `20261022143811_email_review_fixes.sql` |
| `supabase test db` | 2026-10-23 | `ea295024` | Separate local stack | 7 files, 106 pgTAP tests passed, including `email_channel.test.sql` |
| `npm test` | 2026-10-23 | `ea295024` | Local | 429 tests passed (43 files) |
| `npm run test:integration` | 2026-10-23 | `ea295024` | Separate local stack | 547 tests passed (52 files), after the review fixes. An earlier run at `aef1a9e8` passed 535 of 538; its 3 failures were `email-receiver.test.ts` reusing fixed Svix IDs on a database kept between runs, since fixed |
| `npm run test:e2e` | 2026-10-23 | `ea295024` | Separate local stack | 38 Playwright tests passed, 34 first time and 4 on retry under the parallel run (host setup twice, the workspace at 390 px, the Phase 3 requester journey at 390 px); none is an email test. At `aef1a9e8`, 37 of 38 passed first time. An earlier full run showed that the card needs a longer first wait while other suites compile pages, and that the public page's email line repeated the host's handle text; both were fixed |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-23 | `ea295024` | Local | Passed; lint reports only warnings that predate this change |

### Evidence by item

Fixture and local-stack evidence only; each names the test that shows it.

| Item | Evidence |
|---|---|
| Signed, deduplicated ingress | `tests/integration/email-receiver.test.ts`: one receipt and one job before `204`; four concurrent deliveries and a lost-response retry resolve to one; a reused event, message or delivery with other evidence answers `409` and changes nothing; disabled, replaced, unknown and re-keyed receivers and bad or stale signatures store nothing; the receipt holds no body, sender or subject. `tests/integration/eve-surface.test.ts` refuses the unsigned route on the built agent service |
| Start by email | `tests/integration/email-journey.test.ts` "is answered in the thread, continues at the booking link in the same session, and hears the decline": the signed webhook reaches the `eve dev` channel route, the request is created with the sender as unconfirmed contact and the creation email, the turn runs in eve, the session-owner hook makes the reply due, and the reply carries the turn's text in the same thread |
| AC-05 | The same test: an email choosing "option 2" of an earlier message records no agreement and creates no second request; the reply directs to the booking page |
| AC-11 | The same test: after confirmation, a booking-page message lands in the one session that served the email messages. "links a thread and continues the same conversation by email" covers the other direction, and the linking code never reaches the model |
| Sender authenticity and forwarded links (D3, D5) | `tests/integration/email-threads.test.ts` (spoofed, spam-labelled, own-inbox and copied-recipient messages forward nothing) and `tests/integration/email-links.test.ts` (forwarded, unauthenticated and in-thread codes void the code) |
| Review fixes | `email-links.test.ts` "forwards later replies whose subject or quoted text repeats the code, with the code removed"; `email-threads.test.ts` "holds a reply that arrives before its thread's first message is processed", "answers a started thread once when its first message could not be processed", "sends the fallback when the session failed for good, and redacts the turn's text", "ignores auto-replies and bulk mail"; `email-notices.test.ts` "keeps the booking link sealed while a notice may be sent again" |
| Replies (D8) | `email-threads.test.ts` "retries a lost response with the same key and sends one email", "records uncertain without sending once the retry horizon passed", "records a refusal as rejected", "is refused before any provider call in a preview" |
| Continue by email | `email-links.test.ts`; `tests/e2e/email-link.test.ts` by keyboard at 390 and 1280 px |
| Thread notices | `tests/integration/email-notices.test.ts` |
| Retention (D4) | `supabase/tests/email_channel.test.sql` |

### Known gaps

- **Real multi-turn inbox delivery** with an authorized recipient is pending: `findmeatime@agentmail.to` is blocked by the three-inbox limit, no webhook is registered, and the migrations are not on the shared project (decision log, "Blocked on the user").
- **AgentMail behavior assumed from its documentation:** `authentication_results`, `extracted_text`, the reply endpoint's `Idempotency-Key` semantics and Svix signing are exercised only against the stand-in.
- **Real model replies by email** were not graded; the journey used the OpenAI stand-in.
