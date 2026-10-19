# Design

## Context

See [proposal.md](proposal.md) for motivation. The repository holds documents, specifications, Supabase local configuration and two scripts; there is no application package.

The shared Supabase project `anelszynxtvxoxqvzgqt` (PostgreSQL 17.6, `us-east-2`) has an empty application schema. It has `pg_cron`, `pg_net`, `pgmq`, `pgcrypto` and `supabase_vault` installed, and its `public` schema grants new objects to `anon`, `authenticated` and `service_role` by default ([provider setup](../../../documentations/technical_specification/03_provider_setup.md#supabase-project)). Local `supabase/config.toml` has migrations and seeds disabled. Teammates develop against personal hosted Supabase projects without Docker, and one teammate with Docker generates migrations ([environments](../../../documentations/technical_specification/03_provider_setup.md#environments-and-collaboration)). The shared project is changed only by CI on merge to `main`.

The architecture is already chosen in the [technical overview](../../../documentations/04_technical_specification.md), [backend](../../../documentations/technical_specification/01_backend_architecture.md), [frontend](../../../documentations/technical_specification/02_frontend_architecture.md) and [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md) documents. This design records the concrete runtime decisions those documents left to the foundation change. Facts below were checked on 2026-10-19 against npm, the `vercel/eve` repository, and the eve 0.80.1 and `ai` 7.0.143 package documentation.

Two eve facts shape the enforcement points:

- **Hooks only observe.** eve hooks run after an event is durably recorded, and a throwing hook does not veto work (eve `docs/guides/hooks.md`).
- **Route auth does not own sessions.** Route authentication accepts or rejects a request but does not enforce session ownership (eve `docs/guides/auth-and-route-protection.md`).

So nothing that must block work can be a hook.

## Goals / Non-Goals

**Goals:**

- Fix every runtime choice a later phase would otherwise reopen: template revision, versions, layout, model, data access, durable placement, configuration of the shared project, and region.
- Make the foundation's authority boundaries real from the first commit: no runtime route, job or model call proceeds unless application code decided it may, at a point that runs before the effect.
- Leave each lane of the plan's Phase 1 independently buildable and testable once the schema baseline has merged.

**Non-Goals:**

- Any scheduling tool, calendar read, readiness or publication; the setup session runs with no tools.
- Requester routes, channels, MCP and CLIs.
- A separate worker application or queue service.

## Decisions

### 1. Base template and revision

Copy `vercel/eve` `apps/templates/eve-chat-template` at commit `8c55ea7c132f` (2026-10-08, "deferred tools and skills"), the latest commit touching the template. The repository is Apache-2.0, so copied files keep their license header where present, and a root `THIRD_PARTY_NOTICES.md` records the source, commit and license.

**Keep:**

- root `vercel.ts`, `agent/agent.ts` and `agent/channels/eve.ts`,
- the chat bridge under `apps/web/app/_components/` and `apps/web/lib/chat/`,
- `apps/web/components/chat/{composer,conversation,message,markdown}.tsx`,
- the shadcn primitives under `apps/web/components/ui/`, and `components.json`.

**Remove:**

- Better Auth and password auth, Drizzle and Neon, Upstash rate limiting,
- the browser-local chat store, the sidebar and integrations menu,
- `agent/connections/*`, `agent/channels/slack.ts`, `agent/memory/profile.ts`, the sample tool and skill,
- analytics packages, the pnpm files,
- **`vercelOidc()` from the channel auth list.** It accepts any token minted for the same Vercel project, including one from a pull-request preview.

**Routes:** the template's chat home at `/` and its `/chat/[id]` pages are removed. `/app` is the only conversation route. `/` becomes a minimal public page with **Sign in with Google** until Phase 2 builds the landing page and its agent section.

- Rejected: OpenInstinct as the base. It is a complete product built around a browser subagent, a password vault and payments; see [reference repositories](../../../documentations/technical_specification/02_frontend_architecture.md#reference-repositories).
- Rejected: scaffolding with `eve add channel/web`. The template already carries the reviewed stream resume and persistence patterns the plan points to.

### 2. Runtime version

Pin `eve` exactly at `0.80.1` (published 2026-10-16), not the template's floating `^0.73.0`. eve 0.80.1 requires `ai` `^7.0.137`, so `ai` moves from the template's `7.0.128` to `7.0.143`. Its other peers (`chat`, `dd-trace`, `just-bash`, `braintrust`, `microsandbox`, `@opentelemetry/api`) are optional and not installed. eve requires Node.js 24, which matches CI.

Breaking changes between 0.73 and 0.80 touch the `load_skill` tool, the reserved `eve` namespace, sandbox handle hooks and the `parentCallId` event field. None is used by the planned [agent directory](../../../documentations/technical_specification/04_agent_configuration.md#directory-layout).

The installed `node_modules/eve/docs/README.md` is the reference for this version. A later eve upgrade is its own small pull request that reruns the full check suite.

- Rejected: staying on 0.73.0. It accumulates upgrade debt in a framework that released seven times in nine days.
- Rejected: a caret range. It gives non-reproducible builds.

### 3. Layout and package manager

Use one root npm package (`packageManager: npm@11.12.1`, already declared) containing all dependencies. Scripts run Next.js against `apps/web` and eve against `agent/`, exactly as the template does. Root `vercel.ts` uses `withEve` with the `web` service at `apps/web`, which adds the agent as its own service and routes `/eve/v1/**` to it. Shared server code lives in `lib/contracts/` and `lib/server/` and is imported by both services, following the [source organization](../../../documentations/technical_specification/02_frontend_architecture.md#source-organization).

- Rejected: npm workspaces with separate packages. Nothing is published independently, and the template's single-package shape keeps eve and Next.js builds simple.
- Rejected: keeping pnpm. The repository standard is npm.

### 4. Dependency set

All versions are exact. A version is updated deliberately in its own pull request.

| Group | Packages |
|---|---|
| Kept from the template | `react` and `react-dom` 19.2.8, `zod` 4.4.3, `tailwindcss` and `@tailwindcss/postcss` 4.3.3, `radix-ui` 1.6.7, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0, `cmdk` 1.1.1, `lucide-react` 1.33.0, `@streamdown/{cjk 1.0.3, code 1.1.1, math 1.0.2, mermaid 1.0.2}`, `shiki` and `@shikijs/{core,engine-javascript,engine-oniguruma}` 4.3.1, `use-stick-to-bottom` 1.1.6; dev `typescript` 7.0.2, `@typescript/native-preview` 7.0.0-dev.20260707.2, `@types/react` 19.2.18, `@types/react-dom` 19.2.4 |
| Changed | `next` 16.3.8, `streamdown` 2.7.0, `eve` 0.80.1, `ai` 7.0.143; dev `@types/node` 24.19.2 to match the Node.js 24 runtime |
| Added | `@supabase/supabase-js` 2.118.0, `@supabase/ssr` 0.12.7, `postgres` 3.4.9; dev `vitest` 5.0.5, `@playwright/test` 1.64.1, `oxlint` 1.88.0, the linter the eve memory agent template uses, and `tsx` 4.23.15, which runs `npm run jobs:dev` against the TypeScript worker modules |
| Removed | `better-auth`, `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`, `@upstash/redis`, `@vercel/connect`, `@vercel/analytics`, `@vercel/speed-insights`, `microsandbox` |

`next` moves from the template's 16.3.4 to 16.3.8, the lowest release outside the critical advisories GHSA-vcvr-r3jv-pc5j, GHSA-mcj8-r9mp-w47p, GHSA-3w37-wq28-93x7 and GHSA-cjq9-62q9-8jv4; eve 0.80.1 does not constrain it. `streamdown` moves from 2.5.0 to 2.7.0, which no longer depends on `mermaid` itself (an advisory path), with the same plugin API. The template's lockfile is not copied. `package-lock.json` is generated from these pins and committed.

### 5. Model route and model

Decided by the team on 2026-10-19: call OpenAI directly with the team's own API key, using `gpt-5.6-terra`.

- `agent/agent.ts` starts from eve's bundled `openai("gpt-5.6-terra")` from `eve/models/openai`. It reads `OPENAI_API_KEY` from the server environment, so no separate provider package is needed.
- `modelOptions.providerOptions.openai` sets `store: false` and `serviceTier: "default"`, the standard tier [model execution](../../specs/model-execution/spec.md) requires. eve fills the OpenAI safety identifier and prompt cache key from the session.
- `modelContextWindowTokens` is set explicitly to `32_000`, because eve cannot read a direct model's window from the Gateway catalog. `compaction.thresholdPercent` is lowered to `0.6`, so eve compacts at about 19,000 tokens plus its prompt envelope. That keeps the compaction call itself well under the spec's 128 KiB serialized-input cap, which is roughly 30,000 to 44,000 tokens for English and Korean text. The model's own 1,050,000-token window is not the binding limit.
- eve's `limits.maxTokenCostUsdPerSession` is not set. eve counts cost only from AI Gateway metadata, so it never fires on this route. Its **Continue** prompt also grants a fresh window, which the spec forbids.
- Worst case per attempt is about USD 0.14: 45,000 input tokens at $2 per million plus 4,096 output tokens at $12 per million, using Gateway list prices for the same model. That fits the USD 0.60 reservation. The model task confirms the model ID and price against the team's key and records any difference.
- **Confirmed on 2026-10-19 against the team's key.** `GET /v1/models/gpt-5.6-terra` returns the model, and Responses calls with `store: false` and `service_tier: "default"` echo both back. OpenAI's model page lists $2.00 per million input tokens, $0.20 cached input and $12.00 output, the same as the Gateway list prices above, with a 1,050,000-token window and 128,000 maximum output tokens. Reasoning tokens are part of `output_tokens` and count against `max_output_tokens`: a 40-token cap ended `incomplete` with all 40 spent on reasoning. At the default `medium` effort, a three-person scheduling question used about 120 reasoning tokens of a 300-token answer, so `agent/agent.ts` sets `reasoning: "medium"` explicitly and the 4,096-token cap leaves ample room for the answer.

The [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#model) and [provider setup](../../../documentations/technical_specification/03_provider_setup.md#model-access-and-runtime) documents and `.env.example` were reconciled to this decision in Phase 0.

- Rejected: Vercel AI Gateway with OIDC. It is the template default, but the team chose direct OpenAI billing.
- Rejected: an `OPENAI_MODEL` environment variable. The model ID belongs in versioned `agent/agent.ts` so evaluations replay against a known model.

### 6. Model limit enforcement point

The model instance passed to `defineAgent` is wrapped with the AI SDK's `wrapLanguageModel` and an application middleware that runs before every provider request. eve's own retries and its compaction calls use the same model, so every provider call passes through it. Per attempt, the middleware does the following, in order:

1. Rejects input over 128 KiB serialized, any attachment, and any provider-executed tool.
2. Clamps output to 4,096 tokens, or 2,048 for ranking work, regardless of what the caller asked for.
3. Reserves USD 0.60 durably against the work item, the principal and the service. It refuses beyond eight attempts per accepted input or two per ranking check.
4. Applies a 30-second idle deadline to generation and to each stream chunk.
5. Forces `store: false` and the standard tier.

A denial throws a typed error. eve may retry the step, but every retry hits the same denial, so no provider call is made.

**Attribution.** The wrapper attributes each call without trusting anything the model sends. eve sets the OpenAI prompt cache key to the SHA-256 hash of the session ID, encoded as base64url. The wrapper looks that hash up in the application session index to find the session, principal, generation and current accepted input. A call with no key, an unknown hash, a retired generation or no current accepted input is denied before any provider request. Ranking calls arrive in Phase 3 as application jobs outside eve. They call the wrapper directly with their work item, which selects the 2,048-token cap and the two-attempt limit.

The wrapper keeps the wrapped model's provider and model ID, so eve's OpenAI-specific safety identifier and prompt cache key still apply. A test proves this.

- Rejected: eve hooks. They run after the event is recorded and cannot veto a call.
- Rejected: eve's `limits` alone. They are per session, are reset by **Continue**, and measure cost only through the Gateway.

### 7. Call path and session ownership

Only application code creates eve sessions and sends messages. The browser never writes to `/eve/v1`.

- **Create and send.** The browser posts a message to an application route in the web service. That route authenticates the Supabase session, checks host eligibility, and records the message as the session's current accepted input in the application session index. It then calls the agent service through `eve/client` with a server-only bearer. Phase 3 adds conversation admission and credential redaction to this route, before the record is written.
- **Internal bearer.** The bearer is a short-lived token the web service signs with `EVE_INTERNAL_SIGNING_KEY`. It names the principal, discussion, session and generation, and the accepted input or work item. It also names the deployment environment that signed it and, for a send, the SHA-256 of its message, which the agent checks against its own environment and the request body. It expires after 60 seconds and is never sent to a browser. Production and Preview use different signing keys.
- **Session creation.** Sessions are created the same way. The index row (session ID, a SHA-256 hash of the session ID, discussion, principal, generation, last stream index, agent version, state, current accepted input) is written before the first message is sent.
- **Read and stream.** The browser streams `GET /eve/v1/session/:sessionId/stream` directly with its Supabase session cookie, as the template does. The auth function allows that only when the index shows the session belongs to the caller's current discussion and generation.

The channel auth list is `[appAuth]`. `appAuth` accepts exactly two shapes:

1. A valid internal bearer, on create and send.
2. A Supabase session cookie, on reading or streaming the caller's own indexed session.

Only the web service's session proxy (`apps/web/proxy.ts`, the standard `@supabase/ssr` Next.js proxy) refreshes a Supabase session, writing the new cookies onto the forwarded request and the browser's response. Application routes and `appAuth` verify the access token they receive with Supabase Auth and never refresh, because a refresh whose cookies cannot reach the browser spends the refresh token and gets the session revoked for reuse.

State-changing web routes (`/api/chat/messages`, `/api/chat/recover`, `/auth/sign-out`) refuse a request whose `Origin` is missing or is not `APP_ORIGIN`'s, and the JSON routes also refuse any other content type, so a cross-site page cannot post as a signed-in host.

`appAuth` throws `UnauthenticatedError` when no credential is present and `ForbiddenError` for anything else. It never returns `null`, so the walk cannot fall through. That includes a browser `POST /eve/v1/session` or `POST /eve/v1/session/:sessionId`, a foreign or unindexed session, and a stale generation.

`localDev()` is not in the list. Local development signs in with Google against the teammate's sandbox and uses the same path, so the ownership tests run identically under `eve dev` and in deployments.

A session-owner hook keeps the index's stream position and state current. That is bookkeeping, not authority.

`limits.sessionTimeoutMs` is set to `false`. Host discussions can outlive eve's 30-day default, and a lifetime ending is not the confirmed runtime failure that [conversation access](../../specs/conversation-access/spec.md) recovery requires. Requester sessions end when their request closes, by application decision.

If `eve/react` cannot send through an application route while streaming from `/eve/v1`, the web service proxies the stream as well. The ownership rule is unchanged.

Implemented that way: `useEveAgent` posts to `/eve/v1` itself and `eve/client` takes no custom transport, so the browser reads its discussion only through `GET /api/chat/events`. The web service forwards the browser's own Supabase cookie to the agent's stream route, where `appAuth` still applies the ownership rule, and serves retired generations from stored events, so the cursor is per discussion and no runtime session ID reaches the browser.

- Rejected: a hook that checks ownership. By the time it runs, a foreign message is already recorded, and a stream read produces no event for it to see.
- Rejected: `vercelOidc()` for the web-to-agent call. It accepts any token for the same Vercel project, including one from a preview.
- Rejected: letting the browser create sessions or send messages to `/eve/v1`. Admission, redaction and the accepted-input record would then be bypassable.

### 8. Data access and the database role

Domain code runs server-side only. It talks to Postgres through the Supabase transaction pooler using `postgres` (postgres.js) with `prepare: false` and a server-only `DATABASE_URL`. Commands use explicit transactions, `SELECT ... FOR UPDATE` and transaction-scoped advisory locks in a documented order, as the [command pipeline](../../../documentations/technical_specification/01_backend_architecture.md#command-and-query-pipeline) requires.

Supabase JS (`@supabase/ssr`) is used only for the Auth session.

Application tables live in a private `app` schema that is not exposed through the Data API. The server connects as the `postgres` role, which owns the `app` objects. Row-level security is enabled on every table with no policies, so as owner the server is unaffected while `anon` and `authenticated` see nothing. Default privileges for `anon` and `authenticated` are revoked in `app` and `public`. `supabase/tests/` proves that `anon` and `authenticated` can read or call nothing.

- Rejected: Supabase JS table access. PostgREST cannot run multi-statement transactions or hold locks across statements.
- Rejected: domain logic as PL/pgSQL functions behind RPC. It is harder to share with eve tool code and to unit test. Postgres functions remain available for narrow atomic operations such as job claiming.
- Deferred to Phase 8: a dedicated least-privilege login role. Its password has to be provisioned outside migrations, which the operations change owns.

### 9. Durable placement and the job worker

- **eve sessions** run on eve's durable workflow runtime: locally under `.eve/.workflow-data`, and on Vercel through the deployed agent service. A paused eve session is never the record of a decision.
- **Domain state, the session index and jobs** live in Postgres. A job row is inserted in the same transaction as the domain change that requires it, as [durable jobs](../../specs/durable-jobs/spec.md) requires.
- **Producer environment:** each job row records the environment that produced it.
- **One worker route** in the web service claims bounded batches, through a Postgres function with `FOR UPDATE SKIP LOCKED`, a lease deadline and a fencing token. It claims only jobs produced by production, records each outcome before acknowledging, and is authenticated by a shared secret.
- **Wake-ups:** an `AFTER INSERT` trigger calls the worker URL through `pg_net`, and a `pg_cron` job calls it every minute as the recovery sweep. Both read the URL and secret from Supabase Vault and do nothing when either is absent, which is the case in every sandbox and in CI. The worker route is `POST /api/internal/jobs`. pg-delta does read `pg_cron` jobs, so the schedule's hand-written migration is mirrored in `supabase/schemas/app/cron/`, or a later sync would unschedule it.
- **Environment detection:** the worker counts as production only when `VERCEL=1` and `VERCEL_ENV=production` are both set and agree. It refuses on any other Vercel environment, or on contradictory metadata, before touching job state.
- **Local development:** `npm run jobs:dev` runs outside Vercel. It refuses to start when `SUPABASE_PROJECT_REF` or `DATABASE_URL` names the shared project or the reserved release project, polls the teammate's sandbox, and claims only that sandbox's jobs.
- **Previews:** preview deployments write to the shared database. Their jobs are recorded with a non-production environment and stay unclaimed but visible, so job-backed features do not run on previews. This fencing prevents mistakes, not malice: a preview holds the same database owner credentials and could write any label. Real isolation comes with the release environment split in Phase 8, and until then the shared project holds no data worth protecting.

This placement is confirmed at Phase 1 exit by the tests named in the tasks: process death mid-job, lost wake-up, duplicate delivery, a crash between follow-up commit and acknowledgment, and an expired lease reclaimed with a higher fence.

- Rejected: Vercel Cron. Frequent schedules depend on a paid plan, the plan avoids that dependency, and it cannot join the domain transaction.
- Rejected: Vercel Queues. It is in beta and outside the Postgres transaction, so an outbox would still be needed.
- Rejected: eve schedules. Durable product work belongs to application jobs, per agent configuration.
- Rejected: `pgmq` as the job store. Its visibility timeout carries no fencing token. A plain table keeps lease and fence explicit and inspectable for [operational diagnostics](../../specs/operational-diagnostics/spec.md).

### 10. Shared project configuration and migration order

The schema baseline merges first and alone. The same pull request adds the CI job that, on merge to `main`, does three things:

1. Prints `supabase db push --dry-run` and then pushes the migrations to the shared project.
2. Writes the worker URL and secret into Supabase Vault from GitHub secrets, idempotently.
3. Applies hosted Auth settings with `supabase config push`. This pushes all of `config.toml`, so the baseline reviews every setting in it as hosted policy. The site URL and redirect allowlist use `env(...)` substitution so local values never reach the hosted project, and the same variables are set locally for `supabase start`.

Lanes that add tables, such as the jobs table and the session index, start their migrations only after the baseline is on `main`. `supabase/config.toml` re-enables `[db.migrations]` in the baseline pull request, so `supabase db reset` rebuilds the chain.

Nobody changes the shared project by hand. `supabase db diff --linked` stays empty after each merge.

### 11. Region

Run Vercel functions in `cle1` (Cleveland). It sits beside the Supabase project in `us-east-2`, which keeps transaction round trips short.

- Rejected: the default `iad1`. It works, but it adds cross-region latency to every locked transaction.

### 12. Authentication details

- **Sign-in method.** Supabase Auth's Google provider is the only enabled method. Email sign-in is disabled in `supabase/config.toml` and applied to the hosted project by the CI configuration step.
- **Callback.** `/auth/callback` always returns to `/app`, as [chat workspaces](../../specs/chat-workspaces/spec.md#requirement-google-only-mvp-host-login) requires. It accepts no caller-supplied destination.
- **Scopes.** The consent requests identity plus the least Calendar scopes that cover reading the calendar list, reading events on selected calendars, checking free/busy, and creating events. The exact scope strings are chosen and verified against Google's documentation in the sign-in task.
- **Granted scopes.** These are read from Google's token information endpoint using the provider access token returned at sign-in, because Supabase does not pass Google's granted `scope` through. The call happens before the callback opens its database transaction. If it fails, the account is still created with no Calendar grant, and Phase 2's **Connect Google Calendar** recovers.
- **Refresh token.** Google returns one only on the first consent for an identity. The callback stores it immediately, encrypted with AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, and records the key identifier with the ciphertext for later rotation. A sign-in that returns no refresh token never overwrites a stored one. A host with no stored token is left without a Calendar grant, and Phase 2's **Connect Google Calendar** requests consent again.
- **Account creation.** One host account per Google identity is enforced by a unique constraint and created inside the callback transaction, so concurrent callbacks create one account.

### 13. Tests

| Layer | Tool and location | Where it runs |
|---|---|---|
| Unit | Vitest beside modules | Locally and in CI |
| Integration | Vitest under `tests/integration/` against a database | A personal sandbox locally, the local Supabase stack in CI |
| Database | Grant, RLS, trigger and concurrency tests under `supabase/tests/` | CI, on a fresh `supabase start` |
| Browser | Playwright under `tests/e2e/`, following the Vercel chatbot's layout | CI |
| Lint | `oxlint` over `agent`, `apps`, `lib` and `tests` | Locally and in CI |

GitHub-hosted runners have Docker, so CI covers what teammates without Docker cannot run locally.

## Risks / Trade-offs

- [eve is pre-1.0 and changes almost daily] → Exact pin, version-scoped installed docs, and upgrades only in dedicated pull requests with the full suite.
- [Template code written for eve 0.73 fails on 0.80.1] → The first build task runs the copied template on 0.80.1, with only its model swapped to the team's OpenAI key, before any replacement work. Failures are then attributed to the upgrade alone.
- [The wrapper misses a provider call path] → A test drives a turn, a forced retry and a forced compaction through a fake provider and asserts a reservation for each provider request.
- [The transaction pooler forbids session state] → No prepared statements, session-level locks or `SET` outside a transaction. Tests run through the same pooler URL format.
- [Preview deployments share the shared database] → Jobs record their producer, the worker claims only production jobs and runs only in production, and messaging is denied outside production.
- [`pg_net` delivery is best effort] → The every-minute sweep and idempotent completion make a lost wake-up a delay, not a loss.
- [Google issues seven-day refresh tokens while the OAuth app's publishing status is Testing] → Treat Phase 1 grants as disposable. Move the app to the In production publishing status, still unverified with the 100-user cap, before Phase 2 relies on stored grants. Submit Calendar scope verification early in Phase 2.
- [The model ID, price or storage behavior differs on the direct account] → The model task confirms ID and price against the team's key and exercises a multi-turn exchange with storage off.
- [Reasoning tokens may count against the 4,096-token output cap] → The model task measures it, and the reasoning setting is chosen so answers are not truncated.

## Migration Plan

There is no existing application or data.

1. Merge the skeleton.
2. Merge the schema baseline. Its migration is verified with `supabase db reset --local`, and its CI job pushes the baseline and configuration to the shared project on merge.
3. Apply the migration chain to each sandbox with `supabase db push` as later lanes add migrations.
4. Link the Vercel project, set Production and Preview environment variables separately, set the function region, and attach `release.findmeatime.com` following [domain guidance](../../../AGENTS.md#domain-and-dns).

Rollback is a revert plus a forward migration. The shared project's data is disposable until the release split, so `supabase db reset --linked` after a team announcement is acceptable.

## Open Questions

- Compaction thresholds and session retention beyond the initial settings can be tuned with evidence without changing the approach.
- Whether `evaluate_candidates` runs as an eve workflow tool or an application job is decided in Phase 3, where it is first used.
- **Before Phase 5:** the [chat-workspaces](../../specs/chat-workspaces/spec.md) requirement of a fixed `/auth/callback` return to `/app` must be reconciled with the [page list](../../../documentations/user_experience/04_page_list.md)'s allowlisted return, which `/connect/authorize` needs to preserve an OAuth transaction across sign-in. Phase 1 follows the spec.
- **Before Phase 3, when the first transport lands:** the [messaging-environments](../../specs/messaging-environments/spec.md) contract admits standalone local execution, while agent configuration and the plan deny local messaging. The owning document must be corrected first. Phase 1's gate follows the spec and has no transport to send through.
