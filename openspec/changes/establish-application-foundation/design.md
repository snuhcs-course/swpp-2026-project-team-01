# Design

## Context

See proposal.md for motivation. Existing backend architecture selects Supabase PostgreSQL/Auth, TypeScript/Deno Edge Functions, Queues, and Cron. The initial HTTP contract lives in `scripts/backend-contract.md`; shared DTOs exclude provider credentials. P2–P4 extend this foundation.

## Goals / Non-Goals

**Goals:** share one authorization and mutation boundary across interfaces; support durable recovery and reproducible checks; make test doubles explicit.

**Non-Goals:** remote MCP, messaging delivery, host admission, calendar consent, and scheduling behavior owned by later changes.

## Decisions

- Use npm workspaces and React/Vite for the responsive web app, with shadcn preset `b6rtA2Hmi` as requested. Build static assets for Vercel; a server-rendered framework would add a second backend boundary without a P0–P4 requirement.
- Use Hono in Supabase Deno Edge Functions for validated HTTP adapters. Authenticate host JWTs server-side; hash request-scoped continuation tokens; never accept client-supplied actor objects. Restrict `public.fmat_command` execution to service credentials.
- PostgreSQL commands own idempotency records, authorization guards, state, and jobs in one transaction. Mutations carry `Idempotency-Key`; the shared envelope defines `expectedRevision` for P3 request commands, which own enforcement. Separate REST writes are rejected because they cannot atomically publish work.
- A committed job references persisted business state. Worker invocations use an internal secret, bounded batches, visibility deadlines and application fencing. Cron drains jobs and recovers expired ownership. `waitUntil()` is only an optional wake-up.
- Desired schema uses pg-delta with Supabase CLI 2.119.0 and PG17. One schema owner generates and reviews migrations; no second ORM/migration engine is introduced.
- Fail closed for absent provider configuration. Deterministic adapters are explicitly selected in tests; a production health endpoint cannot label mocked credentials or integrations healthy.

## Risks / Trade-offs

- [Edge execution limits] → Bounded deadlines and independently persisted steps; measure representative batches.
- [Privileged database access bypasses RLS] → Central command authorization plus service-only execution and denied direct Data API tests.
- [Lost wake-up or duplicate delivery] → Durable job records, Cron, completed-job recognition, and fenced ownership.
- [Schema generation is pre-1.0] → Review generated SQL and rebuild a disposable local database before remote deployment.

## Migration Plan

Add declarative SQL and generate an unapplied migration. Rebuild the disposable local database and run foundation checks. Identify the intended remote Supabase environment, inspect dry-run SQL, deploy migrations/functions, then deploy static web assets. Roll back application deployments while preserving migration history; repair schema forward. External test sends remain disabled by default.
