# Acceptance Record

Status: Phase 1 (`application-foundation`) and Phase 2 (`host-onboarding`) evidence recorded; Phase 3 (`requester-intake-and-feasibility`) release recorded, its acceptance evidence pending; Phase 4 (`host-review-and-booking`) released and checked on production; the guest's inbox check pending; Phase 5 (`agent-access`) local evidence recorded, named-client and production evidence pending; open gaps listed below

Date: 2026-10-23

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

Change: [`host-review-and-booking`](../../openspec/changes/host-review-and-booking/tasks.md). Evidence list: [Phase 4](06_implementation_plan.md#phase-4--host-review-and-booking). Environments as in Phase 1, with the local Google stand-in extended to `events.insert` and `events.get` (fixed event IDs, `409` on a duplicate, lost responses before and after creation) and the local Cloudflare stand-in recording `reply_to` and attachments. Only the release steps below ran against production.

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

### Production deployment

Run by the implementing session on 2026-10-22, at the user's request, against the **production** deployment `findmeatime-release`.

| Step | Revision and deployment | Command | Result |
|---|---|---|---|
| Shared project before the push | `708381cb` | `supabase migration list --linked`, then `supabase db push --linked --dry-run` | The 21 Phase 1 to 3 migrations applied; only `20261022021159_host_review_and_booking.sql` listed |
| Migration | `708381cb` | `supabase db push --linked`, `supabase migration list --linked` | Applied; 22 listed, none pending |
| PR #30 merged (admin bypass) | `708381cb` | `gh pr merge 30 --squash --admin` | Merged after CI passed 7 of 7 |
| Deployment | `708381cb`, `dpl_7LXD9swHWQEXkBHC8LtX7adjMte3` | `vercel deploy --prod` from a clean checkout of `origin/main` | Ready; aliased to `findmeatime.com` and `release.findmeatime.com` |
| Smoke test | `708381cb` | `curl` of `/`, `/app`, `/app?view=requests`, `release.findmeatime.com/SKILL.md`, an unknown `/booking/{uuid}`, and `/api/host/requests` signed out | 200 for each page; the host requests API answers 401 without a session |

### Production acceptance check

Run by the implementing session on 2026-10-22, at the user's request, in the built-in browser against `https://findmeatime.com` (`708381cb`): host Dodo Park (`/dodo41142727`), signed in by the user; the guest address `dodo4114@snu.ac.kr`, a team member's own inbox, given by the user. Request `70de0d77-e596-4428-a3d7-c2cf769a486e`.

| Step | Result |
|---|---|
| Guest thread on `/dodo41142727` | The first message started a draft; the assistant drafted the details and called the identity card; **Continue without Google** identified the guest, the address bar moved to the booking link in place and the creation email was recorded |
| Tuesday 27 Oct 14:00–17:00 | No times: outside the host's Tuesday hours (10:00–14:00); the guest saw the authored no-match message |
| Monday 26 Oct 15:00–17:00, Thursday 29 Oct 14:00–22:00 | No times: every slot overlaps an all-day event on the host's primary calendar spanning 12 Oct to 2 Nov, which counts as busy under the agreed rule; the host's private view named the reason, the guest's did not. The second turn of the guest conversation ended after `read_request` without drafting, so the windows were set through **Edit details** |
| Monday 2 Nov 10:00–13:00 | One feasible slot, held back from the guest because that week already had the host's limit of 6 meetings (D8); the host's rule and travel review showed the hold |
| **Allow this request beyond my weekly limit** | The host's evaluation then offered Mon 2 Nov 10:00 to the guest |
| **Choose this time**, **Agree to this proposal** | Version 1 agreed; the guest saw "Waiting for Dodo Park to approve" |
| **Approve this proposal** in `/app?request=…` | Booked within about 20 seconds; the host receipt shows the organizer from Google, the guest, **Join meeting** and **Open in Google Calendar** |
| Host's Google Calendar | Event `cd6da3e53fca4f558834313ac1bcf740` (the booking ID's hex) on `dodo41142727@gmail.com`, 10:00–10:30 Asia/Seoul, the guest as the only attendee, a Google Meet link, and a description without the booking link |
| Guest's booking link | Only "Your meeting is booked" and the receipt, with **Join meeting** and no calendar link |
| Host's confirmation | Delivered to the host's Gmail: subject "Review the Phase 4 booking flow between Dodo Park and Dohyeon Park", the four blocks in Asia/Seoul, **View booking** to `/app?request=…` with no booking link, **Join meeting**, and an `invite.ics` `text/calendar` attachment |

Found: the receipt shows the organizer as "address <address>" when Google returns no organizer name; fixed in a follow-up pull request.

### Known gaps

- **Guest's inbox.** The guest's confirmation copy and Google's own invitation in `dodo4114@snu.ac.kr` were not read by the session; a team member checks them.
- **Outlook.** The `text/calendar` attachment arrived in Gmail; Outlook is unchecked.
- **Reminders** are deferred by D3.

## Phase 5 — `agent-access`

Change: [`agent-access`](../../openspec/changes/agent-access/tasks.md). Evidence list: [Phase 5](06_implementation_plan.md#phase-5--agent-access). Environments as in Phase 1. A scripted MCP client over plain `fetch` and the CLI `fmat` stand in for agents; no named client ran, and nothing here ran against production. Per-client results belong in [personal-agent clients](09_agent_clients.md).

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local`, then `supabase test db` | 2026-10-22 | `dada09ac` | Local stack | Chain rebuilt with `20261022132708_agent_access.sql`; 7 files, 100 pgTAP tests passed, including `agent_access.test.sql` |
| `npm test` | 2026-10-22 | `15a1e43e` | Local stack | 44 files, 421 tests passed |
| `npm run test:integration` | 2026-10-22 | `15a1e43e` plus the join test | Local stack | 52 files, 538 tests passed |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-22 | `15a1e43e` | Local stack | Each exit 0; lint reports only the three warnings that were already on `main` |
| `npm run test:e2e` | 2026-10-23 | `15a1e43e` plus the join commit's test changes | Local stack | With the default workers, at a load average near 68 from other work on the machine, 24 passed, 10 passed on retry and 5 failed on timeouts; the 5 passed when rerun with `--last-failed --workers=2`, and a full rerun with `--workers=2` passed all 39 tests |

### Evidence by item

Local evidence only; each names the test that shows it.

| Item | Evidence |
|---|---|
| AC-14, scripted | `tests/integration/agent-join.test.ts`: a requester MCP client and the host's CLI on one request see the same state and proposal version, a retried agreement replays, the host decision tool books nothing, the host's own approval made twice books one event, and both lose access on revocation |
| AC-15, scripted | `tests/integration/agent-mcp-requester.test.ts` "creates exactly one request, emails its link, and binds the grant to it" and "finds times, refuses a stale version and agrees to the current one"; the join test reads the booked receipt after the host approves |
| AC-19 | `tests/e2e/agent-connect.test.ts` at 390 and 1280 px: narrowed consent, the agent's code, **Connected agents** and **Revoke**; "a denied connection returns access_denied and connects nothing"; `tests/integration/agent-mcp-host.test.ts` "lists only the tools the permissions allow and challenges a missing one" |
| AC-20 | `lib/server/agent-tokens.test.ts` (wrong key, issuer, audience, type, expiry, changed claim, `alg: none`, token-supplied key); `agent-mcp-host.test.ts` "challenges a missing, foreign or wrong-audience token" and "prepares a decision only for the current version and never approves" |
| AC-21 | `agent-mcp-requester.test.ts`: another host's booking link is refused at consent, the bound grant reaches only its request, an unbound grant expires after 24 hours; `agent-mcp-host.test.ts` "reads only the host's own requests in the host projection" |
| AC-22 | `tests/integration/agent-cli.test.ts`: headless login, JSON output, an exact retry by the printed key, a conflicting reuse and a refused refresh asking for a new login; the join test uses MCP and the CLI on one request |
| AC-23 to AC-25, documents only | `lib/server/entry-documents.test.ts` and `tests/integration/entry-documents.test.ts` for instruction version 3; `agent-mcp-requester.test.ts` "refuses a resource for an unknown host" |
| Authorization server | `tests/integration/agent-authorization.test.ts` (19): discovery, registration and its bound, the validation order, metadata documents, consent and the sign-in return, concurrent and replayed codes, refresh rotation and replay, a missing signing key, revocation and suspension |

### Known gaps

- **Named clients.** Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code have not run in either role; AC-14, AC-15 and AC-19 to AC-25 stay open for each until [personal-agent clients](09_agent_clients.md) records them. An unresolved client is a release blocker.
- **Production.** The migration, the signing keys and the deploy are pending (decision log, "Blocked on the user").
- **The CLI's system stores.** The macOS Keychain and Secret Service paths were not exercised by the suites, which use the file store.

