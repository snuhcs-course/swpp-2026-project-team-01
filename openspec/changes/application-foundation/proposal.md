# Proposal

## Why

No application code exists, and [agent guidance](../../../AGENTS.md#project-status) forbids scaffolding until a bounded first change records the runtime decisions. Every later phase of the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-1--application-foundation) needs the same thing first: an authorized, deployed, empty product in which a host signs in with Google, reaches `/app` and talks to Thyme in a setup session that has no tools yet.

## What Changes

- Copy the eve chat template as the base, at a recorded revision, and replace its identity, persistence and integrations with ours before any real host data enters the app ([reference repositories](../../../documentations/technical_specification/02_frontend_architecture.md#reference-repositories)).
- Pin the runtime and dependency set exactly, switch to npm, and add build, lint, typecheck, unit, database and browser test commands to the Check workflow.
- Create the Supabase schema baseline: a private application namespace, an explicit role matrix, revoked defaults, row-level security, and the first reviewed pg-delta migration chain.
- Add Google-only host sign-in through Supabase Auth with identity and Calendar scopes on one consent screen, recorded granted scopes, an encrypted refresh token, and email login disabled.
- Add open host sign-up and the shared eligibility-and-readiness guard. Every new host is active and not yet ready, so nothing is published in this change.
- Authorize every eve runtime route in application code and keep an application-owned index from discussion to eve session, with reconnect and explicit terminal recovery.
- Add the platform mechanics later phases build on: the command pipeline, durable jobs with a worker, model execution limits, and the messaging-environment denial.
- Apply the Thyme theme to the shell.
- Deploy to the release origin and push migrations to the shared project only from CI.
- Configure Thyme's model as decided in Phase 0: direct OpenAI with the team's key and `gpt-5.6-terra`. [Provider setup](../../../documentations/technical_specification/03_provider_setup.md#model-access-and-runtime), [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#model) and `.env.example` already reflect that decision.

## Capabilities

### New Capabilities

None. This change implements requirements that the main specifications already state.

### Modified Capabilities

None. The change sets `skip_specs: true` because no requirement text changes. It implements these existing requirements and is verified against their scenarios:

- [`chat-workspaces`](../../specs/chat-workspaces/spec.md): Google-only MVP host login, single host workspace, conversation-first entry.
- [`host-admission`](../../specs/host-admission/spec.md): open host sign-up, and the eligibility half of the shared eligibility and readiness guards. Readiness and publication arrive with host onboarding.
- [`conversation-access`](../../specs/conversation-access/spec.md): authorized runtime access, recovery that preserves application authority, explicit terminal recovery, fencing of retired execution.
- [`model-execution`](../../specs/model-execution/spec.md), [`application-commands`](../../specs/application-commands/spec.md), [`durable-jobs`](../../specs/durable-jobs/spec.md) and [`messaging-environments`](../../specs/messaging-environments/spec.md): all requirements.

## Runtime decisions recorded here

The [design](design.md) records each with alternatives:

| Decision | Choice |
|---|---|
| Base template | `vercel/eve` `apps/templates/eve-chat-template` at commit `8c55ea7c132f` (2026-10-08), Apache-2.0 |
| Runtime | `eve` pinned exactly at `0.80.1`; `ai` raised to `7.0.143` to satisfy eve's peer range `^7.0.137` |
| Layout and package manager | One root npm package with `agent/` and `apps/web/`, composed by root `vercel.ts`; Node.js 24 |
| Dependencies | The template's exact pins for retained packages, the Supabase and Postgres clients added, the template's identity, database and connector packages removed |
| Model | Direct OpenAI with the team's `OPENAI_API_KEY`, `gpt-5.6-terra` through eve's `openai()` helper; decided by the team on 2026-10-19 |
| Data access | Server-only Postgres transactions through the Supabase transaction pooler; Supabase JS for Auth sessions only |
| Durable placement | eve sessions on eve's workflow runtime; domain state, session index and jobs in Postgres; one internal worker route woken by `pg_net` with a `pg_cron` recovery sweep; production-only consumer |
| Region | Vercel functions in `cle1`, beside the Supabase project in `us-east-2` |

## Impact

- **New code:** `agent/`, `apps/web/`, `lib/contracts/`, `lib/server/`, `tests/`, root `vercel.ts`, `supabase/schemas/`, `supabase/migrations/`, `supabase/tests/`.
- **Dependencies:** the pinned set in the design; `package-lock.json` added; the template's pnpm files not copied.
- **Systems:** first application migration on personal sandboxes and, through CI, the shared project `anelszynxtvxoxqvzgqt`; a Vercel project with Production and Preview environment variables; Google OAuth client callbacks; DNS for `release.findmeatime.com` through Cloudflare.
- **Documents:** [frontend architecture](../../../documentations/technical_specification/02_frontend_architecture.md) records the pinned versions; `.env.example` gains the variables this change introduces; [README checks](../../../README.md#checks) and the `apps/` section of agent guidance gain the real commands; the plan's Phase 1 checkboxes are ticked as tasks land.
- **Not affected:** product behavior beyond the listed requirements. Calendar roles, analysis, readiness, publication and every channel arrive in later changes.
