# Acceptance Record

Status: Phase 1 (`application-foundation`) and Phase 2 (`host-onboarding`) evidence recorded; Phase 3 (`requester-intake-and-feasibility`) release recorded, its acceptance evidence pending; Phase 4 (`host-review-and-booking`) released and checked on production; the guest's inbox check pending; Phase 5 (`agent-access`) local evidence recorded, named-client and production evidence pending; Phase 6 (`host-imessage-channel`) local evidence recorded, line, device and production evidence pending; Phase 7 (`requester-email-channel`) local evidence recorded, inbox and production evidence pending; Phase 8 (`operations-and-release`) local evidence recorded; Phases 1 to 8 deployed to production on 2026-10-30 at `7c317609`, with iMessage still off; the [release summary](#release-summary) lists every scenario's state; open gaps listed below

Date: 2026-10-30

This record lists the evidence each phase of the [implementation plan](06_implementation_plan.md) produced, against the evidence list of that phase. Every entry names the command, the date, the revision and the environment it ran in. Fixture and local-stack runs prove logic; only the entries marked **production** prove the deployed integration. Tokens, secrets, email addresses and personal message text are kept out of this record.

## Release summary

Compiled on 2026-10-23 by the [`operations-and-release`](../../openspec/changes/operations-and-release/proposal.md) change (Lane D) from the phase sections below. **Local** means fixture or local-stack evidence, which proves logic; **Production** means a check against the deployed integration; **Pending** is what the [PRD](../02_product_requirements.md#9-end-to-end-release-acceptance-scenarios) still requires. A scenario with anything pending is not closed, and an unresolved named-client, device or inbox case is a release blocker, so **the release is not yet acceptable**. The zero-tolerance measures (unauthorized bookings, duplicate events, private disclosures) have no failing case in the suites run so far.

| ID | Local | Production | Pending |
|---|---|---|---|
| AC-01 | `tests/e2e/requester-intake.test.ts` to agreement, then `tests/e2e/host-review.test.ts` to one booked event ([Phase 4](#phase-4--host-review-and-booking)) | Web booking on 2026-10-22: one event on the host's real Google Calendar ([Phase 4 production check](#production-acceptance-check)) | The guest's inbox; the same journey by email, iMessage and each named client |
| AC-02 | `tests/integration/evaluation.test.ts` "checks the host's inbound trip through Routes and reuses the estimate within 24 hours" and "leaves a leg with no route unresolved and out of the requester's list"; `host-requests.test.ts` manual allowance; `bookings.test.ts` "stops at revalidation when a busy event appeared" | — | The live Routes check (Phase 3 task 5.2) and a production run |
| AC-03 | `tests/integration/host-requests.test.ts` ([Phase 4](#phase-4--host-review-and-booking)) | The weekly-limit hold and **Allow this request beyond my weekly limit** in the Phase 4 production check | — for the web path; other channels as AC-14 and AC-16 |
| AC-04 | `host-requests.test.ts` "shares a feasible later time as a checked new version" | — | A production run |
| AC-05 | `tests/integration/email-journey.test.ts` ([Phase 7](#phase-7--requester-email-channel)) | — | Real inbox delivery: the AgentMail inbox is blocked |
| AC-06 | `bookings.test.ts` (web), `imessage-commands.test.ts` (iMessage and web), `agent-join.test.ts` (agent) | — | A production run; named clients |
| AC-07 | `bookings.test.ts` "stops at revalidation when a busy event appeared" and "dispatches only one of two competing bookings for the same host" | — | A production run |
| AC-08 | `bookings.test.ts` lost-response reconciliation; `tests/integration/recovery-operations.test.ts` reconciles an uncertain booking an operator finds | — | None that can be induced safely against Google; fixture evidence stands |
| AC-09 | `bookings.test.ts` refused write and revoked access; `booking-emails.test.ts` bounced copy | — | A production run of revoked access |
| AC-10 | `tests/integration/host-review.test.ts`; `agent-mcp-host.test.ts` (an OAuth grant books nothing) | — | Named clients |
| AC-11 | `email-journey.test.ts`, `email-links.test.ts` ([Phase 7](#phase-7--requester-email-channel)) | — | Real inbox delivery |
| AC-12 | `lib/server/feasibility.test.ts` "yields nothing for a window whose end is ambiguous or does not exist"; `tests/integration/request-reviews.test.ts` "asks the authored Korean question for an ambiguous local time and records no window" | — | A production run across a daylight-saving change |
| AC-13 | `bookings.test.ts` withdrawal, decline and expiry around dispatch | — | A production run |
| AC-14 | `tests/integration/agent-join.test.ts`, scripted ([Phase 5](#phase-5--agent-access)) | — | Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code, each in both roles |
| AC-15 | `agent-mcp-requester.test.ts`, scripted | — | The seven named clients |
| AC-16 | `tests/integration/imessage-journey.test.ts` through `eve dev` ([Phase 6](#phase-6--host-imessage-channel)) | — | The Photon line, its webhook and a controlled iPhone |
| AC-17 | `imessage-journey.test.ts`, `imessage-channel.test.ts`, `imessage-commands.test.ts` | — | A controlled iPhone |
| AC-18 | `imessage-journey.test.ts`, `imessage-commands.test.ts`, `imessage-notices.test.ts` | — | A controlled iPhone with a service restart |
| AC-19 | `tests/e2e/agent-connect.test.ts`; `agent-mcp-host.test.ts` | — | Named clients; the production signing key |
| AC-20 | `lib/server/agent-tokens.test.ts`; `agent-mcp-host.test.ts` | — | Named clients |
| AC-21 | `agent-mcp-requester.test.ts`; `agent-mcp-host.test.ts` | — | Named clients |
| AC-22 | `tests/integration/agent-cli.test.ts`; the join test | — | The CLI against production |
| AC-23 | `lib/server/entry-documents.test.ts`, `tests/integration/entry-documents.test.ts`, documents only | `/SKILL.md` served on both origins (Phase 2) | Each named client pasting the plain and the `/SKILL.md` URL |
| AC-24 | The same documents tests | `/{handle}/SKILL.md` served (Phase 3 smoke test) | Each named client |
| AC-25 | The same documents tests; `agent-mcp-requester.test.ts` "refuses a resource for an unknown host" | — | Each named client, and denied consent |
| AC-26 | `tests/integration/host-admission.test.ts`, `setup-tools.test.ts`, `entry-documents.test.ts`, `operator.test.ts` ([Phase 1](#phase-1--application-foundation), [Phase 2](#phase-2--host-onboarding)) | One real sign-in on `https://findmeatime.com` creating one host account (Phase 1) | Publishing attempts through MCP and the CLI before setup; suspension on production |
| AC-27 | `tests/integration/requester-google.test.ts`; `evaluation.test.ts` "uses the requester's busy time without storing or showing their events" | — | Real requester consent, blocked while the Google app is in **Testing** |
| AC-28 | [Phase 2](#phase-2--host-onboarding) evidence by item | — | Signed-in setup on production; Google app verification |

Two earlier gaps changed since their phases were recorded: every migration is now on the shared project, the last five pushed on 2026-10-30, and production runs `7c317609`, deployed the same day, so Phases 1 to 8 are all deployed ([Phase 8 production deployment](#production-deployment-2026-10-30)). Deployment closes no scenario above by itself, and iMessage is still off on production because the Photon line and webhook are not provisioned.

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

## Phase 6 — `host-imessage-channel`

Change: [`host-imessage-channel`](../../openspec/changes/host-imessage-channel/tasks.md). Evidence list: [Phase 6](06_implementation_plan.md#phase-6--host-imessage-channel). Environments as in Phase 1, with the default local stack, and a loopback Photon stand-in (`tests/integration/support/fake-photon.ts`, and `tests/e2e/support/fake-photon-server.ts` for the browser tests) that records sends and can refuse a send or drop its answer. Inbound messages were signed with Photon's documented scheme (`tests/integration/support/photon.ts`). No Photon line exists, no webhook is registered, and nothing ran against Photon, a real phone or production. The link screens added later (PR #39, D15–D19) were also checked once against the `fmat-spike` line on the user's iPhone and Mac through a local receiver; nothing ran against production.

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local`, then a declarative sync | 2026-10-23 | `b2f6fe95` | Local stack | Chain rebuilt with `20261023024435_imessage_channel.sql` |
| `supabase test db` | 2026-10-23 | `708ac2f2` | Local stack, after a reset | 9 files, 127 pgTAP tests passed, including `imessage_channel.test.sql`. A run without a reset failed only `agent_access.test.sql`, which inserts the `fmat-cli` client that the integration run had just left behind |
| `npm test` | 2026-10-23 | `708ac2f2` | Local | 470 tests passed (51 files) |
| `npm run test:integration` | 2026-10-23 | `708ac2f2` | Local stack | 647 of 648 passed (66 files). The failure, `conversations.test.ts` "lets only one of two concurrent deliveries reconcile an overdue turn", is a timing check on `eve dev` that this change does not touch; rerun alone it passed (19 of 19) |
| `npm run test:e2e` | 2026-10-23 | `65b0dff0` | Local stack | 46 Playwright tests passed, 45 first time and 1 on retry (the Phase 3 requester journey at 1280 px, a focus wait). Earlier full runs found that the Connect iMessage card remounted and lost its state when setup finished loading, and that the menu moved focus after the test focused a button; both were fixed |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-23 | `65b0dff0` | Local | Passed; lint reports only warnings that predate this change |
| After the independent review's fixes: the iMessage, agent-surface, booking and job-worker integration suites; `supabase test db`; `npm test`; `npm run lint`; `npm run typecheck`; `tests/e2e/imessage-link.test.ts` twice with retries off | 2026-10-23 | the review-fix commit | Local stack | 122 integration tests (12 files), 127 pgTAP tests, 470 unit tests and 4 of 4 browser tests passed. A full browser run started after the fixes was cut short when the machine's disk filled (`ENOSPC`) and Docker stopped; it was not repeated, to keep the disk from filling again |
| PR #39: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | 2026-10-23 | `e49b9c65` | Local | Passed; 472 unit tests (51 files); lint reports 3 warnings that predate the change |
| PR #39: `npm run test:integration` | 2026-10-23 | `e49b9c65` | Local stack | 662 tests (67 files). The full run had one failure caused by a modified local Auth container; that file passed after restarting the stack from `config.toml` |
| PR #39: `npm run test:e2e` | 2026-10-23 | `e49b9c65` | Local stack | 51 Playwright tests. Two failed on a stale assertion; the file passed (7 of 7) after the fix |
| PR #39: `supabase test db` (2.119.0) on a fresh reset, `openspec validate --all --strict`, `npm run check:docs` | 2026-10-23 | `e49b9c65` | Local stack | Passed (22 OpenSpec items, 792 links) |
| PR #39 after merging #36: `npm run typecheck`, `npm run lint`, `npm test` | 2026-10-29 | `e7e35de2` | Local | Passed; 530 unit tests (55 files); lint reports 3 warnings that predate the change. Browser tests were not run on this revision |

### Evidence by item

Fixture and local-stack evidence only; each names the test that shows it.

| Item | Evidence |
|---|---|
| Spike and adapter (D1, D2) | [Design 1](../../openspec/changes/host-imessage-channel/design.md#1-the-transport-spike-and-the-adapter) records the comparison; `lib/server/photon-receiver.test.ts` covers the signature scheme, the sender identifier format and the payload |
| Durable signed receipt | `tests/integration/imessage-receiver.test.ts`: one sealed receipt and one job before `200`; concurrent and repeated deliveries resolve to one; a changed payload answers `409`; stale, badly signed, foreign-webhook, unconfigured and over-large deliveries store nothing. `tests/integration/eve-surface.test.ts` refuses the unsigned route on the built agent service |
| Linking (D3, D5) | `tests/integration/imessage-links.test.ts`: binding only after **Confirm and link**; unknown, expired, replayed and group codes bind nothing; one refusal a day; a sender bound to one host; the confirmation window; five codes an hour and the exact retry |
| One-tap deep link (D4) | `lib/contracts/imessage.test.ts` (platforms, `&body=` and `?body=`, the QR code's link); `tests/e2e/imessage-link.test.ts` at 390 and 1280 px (desktop shows the number, the message, **Copy** and the QR code and opens nothing) and with an iPhone user agent (the card's **Open Messages** carries the exact iOS link) |
| Fallback code (D6) | `imessage-links.test.ts` (the code never reaches the browser, spacing, resend, five wrong entries, per-host and per-line caps, a number linked elsewhere); the 390 px Playwright journey types the texted code back |
| Outbox (D9) | `tests/integration/imessage-outbox.test.ts`: accepted once, refused, unreachable then failed, a lost answer uncertain and never resent, suppressed after unlinking, nothing in a preview; `lib/server/photon.test.ts` for the transport and the gate |
| AC-16 | `tests/integration/imessage-journey.test.ts` "links, discusses, revises, approves and books from iMessage, and declines another request", through `eve dev` with the OpenAI stand-in: link by code through the agent service's webhook route, the awaiting-approval summary with its exact commands, `request <ref>`, a private question answered by the turn in iMessage, `changes` and `share <ref>-S1`, the requester's agreement to version 2, `approve <ref>-2` and the confirmed booking. The revision was recorded by the command `propose_shared_changes` runs, since the stand-in model cannot call tools. The separate decline case creates no event |
| AC-17 | The same journey: a plain "yes" and an outdated `approve <ref>-1` record nothing; "gives an unlinked sender and a group conversation nothing private"; `tests/integration/imessage-channel.test.ts` (unlinked and suspended senders, group conversations, reactions) and `imessage-commands.test.ts` (stale and unknown references) |
| AC-18 | The journey and `imessage-commands.test.ts` "approves the current proposal once, also when replayed and after a web approval": the same message delivered twice is one receipt, the receipt reprocessed as after a restart replays the saved approval, and a concurrent web approval leaves one booking; a refused delivery of the booked summary shows on the `/app` card while the request stays booked (`imessage-notices.test.ts` too) |
| Backpressure | `imessage-forwarding.test.ts` "defers a message an admission budget refuses by at least a minute, keeping later ones behind it"; `imessage-channel.test.ts` keeps a later message behind an unprocessed earlier one |
| Summaries (D12) | `tests/integration/imessage-notices.test.ts`: new request, awaiting approval (once, with commands), confirmed, not confirmed and still pending; none without a binding; an outdated version skipped |
| Setup over iMessage | `tests/integration/imessage-setup.test.ts` and `imessage-commands.test.ts` "reviews settings with their reference and saves them only for the current one" |
| Retention (D14) | `supabase/tests/imessage_channel.test.sql`; `imessage-setup.test.ts` "retention" |
| iMessage start (D15) | `tests/integration/imessage-start.test.ts`: the sender recorded for this browser only and bound after sign-in and **Confirm and link**; replaced and expired starts; a sender another host holds refused at confirmation; the per-source bound. `google-sign-in.test.ts` "gives this browser's iMessage start to the host who signs in, and clears its cookie (D15)"; `tests/e2e/imessage-link.test.ts` "the landing's iMessage start opens the send popup, and the arriving message asks for Google" |
| Link step and landing (D16–D18) | `tests/e2e/imessage-link.test.ts`: the link step at 1280 px, **Set up here in web chat**, and the link step's deep link on an iPhone; `tests/e2e/public-entry.test.ts`: the Calendar box, the iMessage start and the `lang` cookie; `google-sign-in.test.ts` "asks for identity only for ?calendar=0, and for Calendar with any other value"; `lib/contracts/imessage.test.ts` for the Mac platform |
| Carrying on in iMessage (D19) | `imessage-start.test.ts`: the sign-in link for one host until **Confirm and link**, refused past its deadline, and carried through local Auth with the "back from Google" message; `imessage-links.test.ts` "welcomes a host still setting up into setup, Calendar first, and tells a ready host what Thyme can do" |
| Read receipts and typing | `lib/server/photon-receiver.test.ts` "does not turn an inbound read/typing signal into a message" |
| Device check (PR #39) | 2026-10-23, on the user's iPhone and Mac with the `fmat-spike` line and a local receiver (a temporary override outside the repository): the landing's **Open Messages** filled in the line and the message on iOS Safari and on the Mac; the sent code turned the page to received; a welcome arrived and a reply brought the next setup question |
| Review fixes | `imessage-forwarding.test.ts` "sends a turn reply frozen by an attempt that found Photon unavailable"; `imessage-links.test.ts` (a group-posted code voids its attempt; a double tap is one arrival; a number linked elsewhere is recorded and shown sent; a contact card can be shared again after a final outcome; an unlink waits for a message being processed); `imessage-channel.test.ts` (a later message waits on a new job and is brought forward); `imessage-commands.test.ts` (a retried approval answers from its saved outcome after the request moved on) |

### Known gaps

- **No production line, webhook or device run:** provisioning the production Photon line, setting the `PHOTON_*` variables on production, registering the webhook and the remaining checks on a controlled iPhone (the link step on a phone, the QR code from a desktop, the sender identifier a real iPhone sends, Google sign-in from a phone, the conditional welcomes on a device, AC-16 to AC-18 against production, device and client versions) are pending (decision log, "Blocked on the user"). The PR #39 device check above used the `fmat-spike` line and a local receiver only.
- **Spectrum send path assumed from the SDK:** `space.get`, `space.create`, `send` and `shareContactCard` are typed against `@spectrum-ts` 12.14.0 and exercised only through the stand-in.
- **Real model replies over iMessage** were not graded; the journey used the OpenAI stand-in.
- **Production deploy.** The migration was applied to the shared project on 2026-10-23 with `supabase db push --linked` from `873804b`, after a dry run that listed only it; a dry run afterwards reported the remote database up to date. `findmeatime-release` has not been redeployed with Phase 6.

## Phase 7 — `requester-email-channel`

Change: [`requester-email-channel`](../../openspec/changes/requester-email-channel/tasks.md). Evidence list: [Phase 7](06_implementation_plan.md#phase-7--requester-email-channel). Environments as in Phase 1, except that the local stack was a separate one (`project_id` `fmat-phase7`, ports 553xx) so the parallel Phase 5 session's stack was never reset ([decision log](08_decision_log.md#phase-7--requester-email-channel)), and a local AgentMail stand-in (`tests/integration/support/fake-agentmail.ts`) served the message API, recorded replies and honored `Idempotency-Key`. No inbox exists and nothing ran against AgentMail or production.

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local`, then a declarative sync | 2026-10-23 | `ea295024` | Separate local stack | Chain rebuilt with `20261023010000_email_ingress.sql`, `20261023010100_email_threads.sql` and `20261023010200_email_review_fixes.sql` |
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

## Phase 8 — `operations-and-release`

Change: [`operations-and-release`](../../openspec/changes/operations-and-release/tasks.md). Evidence list: [Phase 8](06_implementation_plan.md#phase-8--operations-and-release). Environments as in Phase 1; this branch ran on the default local stack, reset with its own migration chain.

### Suite runs

| Command | Date | Revision | Environment | Result |
|---|---|---|---|---|
| `supabase db reset --local` | 2026-10-23 | `4fc71283` | Local stack | The 31-migration chain rebuilt, exit 0 |
| `supabase test db` | 2026-10-23 | `4fc71283` | Local stack | 9 files, 127 pgTAP tests passed |
| `npm run build`, `npm run lint`, `npm run typecheck`, `npm run check` | 2026-10-23 | `4fc71283` | Local | Each exit 0; lint reports only warnings that predate this change |
| `npm test` | 2026-10-23 | `4fc71283` | Local | 55 files, 528 tests passed |
| `npm run test:integration` | 2026-10-23 | `4fc71283` | Local stack | 70 of 71 files passed (684 of 685 tests). `tests/integration/recovery.test.ts` "shows a re-sent input once even before its new receipt is recorded" failed once on its 2-second receipt wait and passed when the file ran alone (14 tests); at `05f1f021`, before the review fixes, all 71 files and 683 tests passed |
| `npx playwright test --workers=2` | 2026-10-23 | `4fc71283` | Local stack | 47 of 49 passed; `first-reply.test.ts` and `host-setup.test.ts` "a new host completes setup one card at a time…" missed 5-second waits early in the run and passed when run alone (9 tests). An earlier full run with the default workers failed widely because the local Docker daemon stopped mid-run |

### Evidence by item

| Item | Evidence |
|---|---|
| Diagnostics snapshot and rejection counts | `tests/integration/diagnostics.test.ts`: ten categories in a fixed order with the coverage not measured; counts over every match with an oldest-first, bounded and repeatable sample; no payload, outcome, kind or failure text in the output; an uncertain booking and email reported unchanged; an expired lease left in place; Data API roles denied; recognized command rejections counted only while enabled; the original rejection kept when collection fails or hangs; 40 concurrent increments; pruning and saturation. Unit tests in `lib/server/diagnostics.test.ts` and `lib/server/diagnostics-admin.test.ts` |
| Recovery | `tests/integration/recovery-operations.test.ts`: a requeued exhausted job completes and a stale claim is fenced out; a job that is not exhausted and an unknown job are refused; no change without `--yes` or the typed ID; a booking whose write was lost is reconciled into the existing event, with one event in the fake Google Calendar; a booking with a live job or not dispatching is refused, and so is requeueing an old booking job while its reconciliation is live; Data API roles denied; audit rows for each recovery |
| Backup restoration | `npm run restore:drill` on 2026-10-23 at `d6e470fa`, local stack: 85 tables and 415 synthetic rows compared equal after `pg_dump --format=custom` and `pg_restore` into `fmat_drill_restored`; migration history 29 records to `20261023063140` on both sides; 0 constraints not valid; the diagnostics snapshot ran on the restored copy; the local database unchanged. `tests/integration/restore-drill.test.ts` repeats the drill and shows the comparison names a changed table |
| Retention | `tests/integration/data-stewardship.test.ts`: a booked request 91 days after closure is deleted with its proposals, booking, booking link, deliveries, discussion, session and events, its model spend detached and the Calendar event kept; a request closed 89 days ago and an open 200-day-old request are kept; each operational rule at its own age; at most the row limit per rule per run; the hourly schedule |
| Deletion on request | The same file: a deleted host keeps a suspended, nameless account with its handle, which `checkHandle` reports taken; identity, grants, settings, requests, discussions and the Auth user are gone; restoring and deleting again are refused; the same Google subject gets a new account. One request is deleted with its conversation and a turn reply still waiting on it; a closed request whose booking write may exist is kept by retention; deletion is refused while a booking write may exist; Data API roles are denied every function. Unit tests in `lib/server/data-deletion.test.ts` |
| Data notice | `tests/e2e/privacy.test.ts` at 390 and 1280 px: the English and Korean notice with its sections and no horizontal scroll, and the links from `/` and a host page; `tests/e2e/requester-intake.test.ts` checks the link under **Continue with Google** |

### Production checks, read only

Run by the implementing session on 2026-10-23 (06:55 UTC) against the current **production** deployment of `findmeatime-release` (`dpl_2kZrdFKxF1eukJH1irgwH4VMM9wF`, a CLI deploy of 2026-10-23 07:02 KST that predates the Phase 6 merge). Nothing was changed.

| Check | Command | Result |
|---|---|---|
| Domains | `vercel domains inspect findmeatime.com --scope justdodos-projects` | `findmeatime-release` serves `findmeatime.com` and `release.findmeatime.com`; `findmeatime-dev` holds `dev.findmeatime.com`. Nameservers stay Cloudflare's, as intended |
| DNS records | `cf dns records list --zone findmeatime.com` | `A` records for the three names point to `76.76.21.21` with `proxied: false`; the Cloudflare Email Routing MX, SPF, DKIM and DMARC records are unchanged |
| DNS lookup | `dig +short A findmeatime.com @1.1.1.1` and the same for `release.findmeatime.com` | `76.76.21.21` for both |
| HTTPS, both origins | `curl` of `/`, `/app`, `/eve/v1/health`, `/SKILL.md`, `/llms.txt` | 200 each; HSTS and Content Security Policy present |
| Raw runtime route | Unauthenticated `POST /eve/v1/session` | 401 |
| `dev.findmeatime.com` | `curl` of `/` | 404: `findmeatime-dev` has no current deployment serving it, so staging is not live |
| Latency (D4) | `npm run perf:check -- --origin https://findmeatime.com` and `--origin https://release.findmeatime.com`, 20 sequential samples per route from Seoul | All routes pass. `findmeatime.com`: `/` p50 155 ms, p95 267 ms; `/SKILL.md` 269 and 431 ms; `/llms.txt` 255 and 286 ms; `/eve/v1/health` 250 and 470 ms. `release.findmeatime.com`: 200 and 446; 262 and 287; 250 and 831; 273 and 321 ms. Approval-to-booking and first-reply times are not measured |
| Release project | Read-only `supabase db query --linked --project-ref mriseqztcwmezvtawnbo` | Still the iteration-1 prototype ([provider setup](03_provider_setup.md#supabase-project)); not emptied |

### Production deployment, 2026-10-30

Run by a Claude Code session on 2026-10-30 (KST), at the user's request, against the **production** deployment of `findmeatime-release` and the shared project `anelszynxtvxoxqvzgqt`. The `Deploy shared Supabase` workflow could not push the migrations because the repository has no secrets set ([provider setup](03_provider_setup.md#environments-and-collaboration)), so they were pushed by hand with the user's approval. The Supabase CLI ran on an export of `origin/main`'s `supabase/` directory with `--project-ref anelszynxtvxoxqvzgqt`, because the main checkout is linked to the release project.

| Step | Revision and deployment | Command | Result |
|---|---|---|---|
| Shared project before the push | `7c317609` | `supabase migration list --linked --project-ref anelszynxtvxoxqvzgqt` | 27 applied, through `20261023024435_imessage_channel.sql`; five pending: the four Phase 8 migrations and `20261023134957_imessage_start.sql` (PR #39) |
| Dry run | `7c317609` | `supabase db push --dry-run` on the same target, with CLI 2.122.0 and again with 2.119.0 | The same five listed. Outside function bodies they only add tables, columns, constraints and indexes and schedule `app-retention`; no drop or type change |
| Migrations | `7c317609` | `npx supabase@2.119.0 db push --linked --project-ref anelszynxtvxoxqvzgqt --yes`, then `supabase migration list` | The five applied; 32 listed, none pending |
| Retention schedule | `7c317609` | Read-only `supabase db query` of `cron.job` | `app-retention` active at `17 * * * *` |
| Deployment | `7c317609`, `dpl_EqYL9C8rBa6jiefnYoAvYijkKm1a` | `vercel deploy --prod` from a clean checkout of `origin/main`, 23:39 KST | Ready; `findmeatime.com` and `release.findmeatime.com` both resolve to it |
| Smoke test | `7c317609` | `curl` of `/`, `/llms.txt`, `/SKILL.md`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/jwks.json` and `release.findmeatime.com/` | 200 each |
| Loopback redirect (PR #40) | `7c317609` | `GET /connect/authorize` with Claude Code's client ID metadata document and `redirect_uri` `http://localhost:54545/callback`, then `http://127.0.0.1:54545/callback` | 303 to `/connect/consent` for both; `localhost` answered 400 before PR #40 |
| Photon webhook | `7c317609` | `curl` of `/photon/webhook` | 404, as designed while `PHOTON_WEBHOOK_ID` and `PHOTON_WEBHOOK_SECRET` are unset |

Not checked on this deployment: signed-in pages, the job worker's wake-ups and the latency budget. iMessage stays off. The Photon project `findmeatime` is on the free tier with no line of its own (`photon spectrum lines list` lists none) and no webhook, and Vercel Production does not set `PHOTON_WEBHOOK_ID`, `PHOTON_WEBHOOK_SECRET`, `PHOTON_LINE_NUMBER`, `PHOTON_FALLBACK_DAILY_LIMIT` or `DIAGNOSTICS_REJECTIONS`. So the receiver answers 404, the **Connect iMessage** card says iMessage is unavailable, and rejection counts are not collected.

