# Design

## Context

See [proposal.md](proposal.md) for motivation. The repository holds documents, specifications, Supabase local configuration and two scripts; there is no application package. The shared Supabase project `anelszynxtvxoxqvzgqt` (PostgreSQL 17.6, `us-east-2`) has an empty application schema, with `pg_cron`, `pg_net`, `pgmq`, `pgcrypto` and `supabase_vault` installed. Its `public` schema grants new objects to `anon`, `authenticated` and `service_role` by default ([provider setup](../../../documentations/technical_specification/03_provider_setup.md#supabase-project)). Teammates develop against personal hosted Supabase projects without Docker; one teammate with Docker generates migrations ([environments](../../../documentations/technical_specification/03_provider_setup.md#environments-and-collaboration)).

The architecture is already chosen in the [technical overview](../../../documentations/04_technical_specification.md), [backend](../../../documentations/technical_specification/01_backend_architecture.md), [frontend](../../../documentations/technical_specification/02_frontend_architecture.md) and [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md) documents. This design records the concrete runtime decisions those documents left to the foundation change. Facts below were checked on 2026-10-19 against npm, the `vercel/eve` repository and the installed eve 0.80.1 documentation.

## Goals / Non-Goals

**Goals:**

- Fix every runtime choice a later phase would otherwise reopen: template revision, versions, layout, model, data access, durable placement and region.
- Make the foundation's authority boundaries real from the first commit: no runtime route, job or model call works without the application deciding it may.
- Leave each lane of the plan's Phase 1 independently buildable and testable.

**Non-Goals:**

- Any scheduling tool, calendar read, readiness or publication; the setup session runs with no tools.
- Requester routes, channels, MCP and CLIs.
- A separate worker application or queue service.

## Decisions

### 1. Base template and revision

Copy `vercel/eve` `apps/templates/eve-chat-template` at commit `8c55ea7c132f` (2026-10-08, "deferred tools and skills"), the latest commit touching the template. The repository is Apache-2.0, so copied files keep their license header where present, and a root `THIRD_PARTY_NOTICES.md` records the source, commit and license.

Keep: root `vercel.ts`, `agent/agent.ts`, `agent/channels/eve.ts`, the chat bridge under `apps/web/app/_components/` and `apps/web/lib/chat/`, `apps/web/components/chat/{composer,conversation,message,markdown}.tsx`, the shadcn primitives under `apps/web/components/ui/`, and `components.json`.

Remove: Better Auth and password auth, Drizzle and Neon, Upstash rate limiting, the browser-local chat store, the sidebar and integrations menu, `agent/connections/*`, `agent/channels/slack.ts`, `agent/memory/profile.ts`, the sample tool and skill, analytics packages, and the pnpm files.

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
| Kept from the template | `next` 16.3.4, `react` and `react-dom` 19.2.8, `zod` 4.4.3, `tailwindcss` and `@tailwindcss/postcss` 4.3.3, `radix-ui` 1.6.7, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0, `cmdk` 1.1.1, `lucide-react` 1.33.0, `streamdown` 2.5.0 with `@streamdown/{cjk 1.0.3, code 1.1.1, math 1.0.2, mermaid 1.0.2}`, `shiki` and `@shikijs/{core,engine-javascript,engine-oniguruma}` 4.3.1, `use-stick-to-bottom` 1.1.6; dev `typescript` 7.0.2, `@typescript/native-preview` 7.0.0-dev.20260707.2, `@types/react` 19.2.18, `@types/react-dom` 19.2.4 |
| Changed | `eve` 0.80.1, `ai` 7.0.143; dev `@types/node` 24.19.2 to match the Node.js 24 runtime |
| Added | `@supabase/supabase-js` 2.118.0, `@supabase/ssr` 0.12.7, `postgres` 3.4.9; dev `vitest` 5.0.5, `@playwright/test` 1.64.1 |
| Removed | `better-auth`, `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`, `@upstash/redis`, `@vercel/connect`, `@vercel/analytics`, `@vercel/speed-insights`, `microsandbox` |

The template's lockfile is not copied. `package-lock.json` is generated from these pins and committed.

### 5. Model route and model

Decided by the team on 2026-10-19: call OpenAI directly with the team's own API key, using `gpt-5.6-terra`.

- `agent/agent.ts` uses eve's bundled helper, `openai("gpt-5.6-terra")` from `eve/models/openai`. It reads `OPENAI_API_KEY` from the server environment, so no separate provider package is needed.
- `modelOptions.providerOptions.openai` sets `store: false` and the standard service tier, as [model execution](../../specs/model-execution/spec.md) requires. eve fills the OpenAI safety identifier and prompt cache key from the session itself.
- `modelContextWindowTokens` is set explicitly to `32_000`. eve cannot read a direct model's window from the Gateway catalog, and it uses this value to decide when to compact. The binding limit is the spec's 128 KiB serialized-input cap, roughly 30,000 to 44,000 tokens for English and Korean text, not the model's 1,050,000-token window. A test proves that a long conversation compacts before it reaches the cap.
- eve's per-session `limits.maxTokenCostUsdPerSession` is set to 30 as a backstop. The authoritative USD 0.60 per-attempt reservation and the per-principal and service-wide allowances remain application-owned and durable.
- Worst case per attempt is about USD 0.14: 45,000 input tokens at $2 per million plus 4,096 output tokens at $12 per million, using Gateway list prices checked for the same model. That fits the USD 0.60 reservation. The first task confirms the model ID and price against the team's key and records any difference.

The [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#model) and [provider setup](../../../documentations/technical_specification/03_provider_setup.md#model-access-and-runtime) documents and `.env.example` were reconciled to this decision in Phase 0.

- Rejected: Vercel AI Gateway with OIDC. It is the template default, but the team chose direct OpenAI billing.
- Rejected: an `OPENAI_MODEL` environment variable. The model ID belongs in versioned `agent/agent.ts` so evaluations replay against a known model.

### 6. Data access

Domain code runs server-side only and talks to Postgres through the Supabase transaction pooler. It uses `postgres` (postgres.js) with `prepare: false` and a `DATABASE_URL` held only in server environments. Commands use explicit transactions, `SELECT ... FOR UPDATE` and transaction-scoped advisory locks taken in a documented order, as the [command pipeline](../../../documentations/technical_specification/01_backend_architecture.md#command-and-query-pipeline) requires.

Supabase JS (`@supabase/ssr`) is used only for the Auth session: Google sign-in, the callback, and reading the signed-in user.

Application tables live in a private `app` schema that is not exposed through the Data API. Row-level security is enabled on every table with no policies. Default privileges for `anon` and `authenticated` are revoked in both `app` and `public`. `supabase/tests/` proves that `anon` and `authenticated` can read or call nothing.

- Rejected: Supabase JS table access. PostgREST cannot run multi-statement transactions or hold locks across statements.
- Rejected: domain logic as PL/pgSQL functions behind RPC. It is harder to share with eve tool code and to unit test. Postgres functions remain available for narrow atomic operations such as job claiming.

### 7. Durable placement and the job worker

- **eve sessions** run on eve's durable workflow runtime: locally under `.eve/.workflow-data`, and on Vercel through the deployed agent service. A paused eve session is never the record of a decision.
- **Domain state, the discussion-to-session index, and jobs** live in Postgres. A job row is inserted in the same transaction as the domain change that requires it, as [durable jobs](../../specs/durable-jobs/spec.md) requires.
- **One worker route** in the web service claims bounded batches. It uses a Postgres function with `FOR UPDATE SKIP LOCKED`, a lease deadline and a fencing token. It records each outcome before acknowledgment and is authenticated by a shared secret.
- **Wake-ups:** an `AFTER INSERT` trigger calls the production worker URL through `pg_net`, and a `pg_cron` job calls it every minute as the recovery sweep for lost wake-ups. The secret is stored in Supabase Vault and in Vercel Production environment variables, and both are rotated together.
- **Single consumer:** only the production deployment runs the worker. Preview and development deployments refuse the route before claiming anything, the same fencing [messaging environments](../../specs/messaging-environments/spec.md) uses. Personal sandboxes configure no wake-up URL. Local development runs a polling script (`npm run jobs:dev`) against the sandbox.

This placement is confirmed at Phase 1 exit by the tests named in the tasks: process death mid-job, lost wake-up, duplicate delivery, and an expired lease reclaimed with a higher fence.

- Rejected: Vercel Cron. Frequent schedules depend on a paid plan, the plan avoids that dependency, and it cannot join the domain transaction.
- Rejected: Vercel Queues. It is in beta and outside the Postgres transaction, so an outbox would still be needed.
- Rejected: eve schedules. Durable product work belongs to application jobs, per agent configuration.
- Rejected: `pgmq` as the job store. Its visibility timeout carries no fencing token. A plain table keeps lease and fence explicit and inspectable for [operational diagnostics](../../specs/operational-diagnostics/spec.md).

### 8. Region

Run Vercel functions in `cle1` (Cleveland). It sits beside the Supabase project in `us-east-2`, which keeps transaction round trips short.

- Rejected: the default `iad1`. It works, but it adds cross-region latency to every locked transaction.

### 9. Authentication details

- Supabase Auth's Google provider is the only enabled sign-in method. Email sign-in is disabled in `supabase/config.toml`, and the hosted setting is verified.
- The consent requests identity plus the least Calendar scopes that cover reading the calendar list, reading events on selected calendars, checking free/busy, and creating events. The exact scope strings are chosen and verified against Google's documentation in the sign-in task.
- Supabase returns the provider refresh token only at sign-in. The callback stores it immediately, encrypted with AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, in a grants table with the scopes Google actually granted.
- One host account per Google identity is enforced by a unique constraint and created inside the callback transaction, so concurrent callbacks create one account.

### 10. Tests

| Layer | Tool and location | Where it runs |
|---|---|---|
| Unit | Vitest beside modules | Locally and in CI |
| Integration | Vitest under `tests/integration/` against a database | A personal sandbox locally, the local Supabase stack in CI |
| Database | Grant, RLS and concurrency tests under `supabase/tests/` | CI, on a fresh `supabase start` |
| Browser | Playwright under `tests/e2e/`, following the Vercel chatbot's layout | CI |

GitHub-hosted runners have Docker, so CI covers what teammates without Docker cannot run locally.

## Risks / Trade-offs

- [eve is pre-1.0 and changes almost daily] → Exact pin, version-scoped installed docs, and upgrades only in dedicated pull requests with the full suite.
- [Template code written for eve 0.73 fails on 0.80.1] → The first task builds and runs the copied template on 0.80.1 before any replacement work, so failures are attributed to the upgrade alone.
- [The transaction pooler forbids session state] → No prepared statements, session-level locks or `SET` outside a transaction. Tests run through the same pooler URL format.
- [Preview deployments share the shared database] → The worker refuses outside production; wake-ups target only the production URL; messaging is denied outside production.
- [`pg_net` delivery is best effort] → The every-minute sweep and idempotent completion make a lost wake-up a delay, not a loss.
- [The model ID or price differs on the direct OpenAI account] → Task 1 confirms both against the team's key before any limit is tuned.
- [The compaction threshold is set too low and degrades conversations] → The compaction test also checks that ordinary setup conversations stay uncompacted; tune within the 128 KiB cap.
- [Google Calendar scopes require app verification] → Submit early in Phase 2; until then, use test users only.

## Migration Plan

There is no existing application or data.

1. Merge the skeleton.
2. Generate the first migration in the pull request that adds `supabase/schemas/` and verify it with `supabase db reset --local`.
3. Apply the migration to each sandbox with `supabase db push`.
4. On merge, CI pushes the migration to the shared project after a reviewed `supabase db push --dry-run`.
5. Link the Vercel project, set Production and Preview environment variables separately, set the function region, and attach `release.findmeatime.com` following [domain guidance](../../../AGENTS.md#domain-and-dns).

Rollback is a revert plus a forward migration. The shared project's data is disposable until the release split, so `supabase db reset --linked` after a team announcement is acceptable.

## Open Questions

- Session retention and compaction thresholds beyond the initial `32_000`-token setting can be tuned with evidence without changing the approach.
- Whether `evaluate_candidates` runs as an eve workflow tool or an application job is decided in Phase 3, where it is first used.
