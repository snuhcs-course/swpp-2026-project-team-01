# Acceptance Record

Status: Phase 1 (`application-foundation`) evidence recorded; open gaps listed below

Date: 2026-10-19

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
