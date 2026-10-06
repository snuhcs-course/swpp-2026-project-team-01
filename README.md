# Find Me a Time

An AI scheduling agent for external one-to-one meetings. It negotiates times and books only with host approval.

Domain: [findmeatime.com](https://findmeatime.com)

Team: SNU SWPP Project Team 01

## Planned experience

- Find suitable times using Google Calendar, host preferences, and location and travel constraints.
- Coordinate requests through booking links, email, or agents without requiring requesters to create an account.
- Require the host's approval of the current proposal before booking.

See the [project one-pager](documentations/01_one_pager.md) for the target users, product scope, and principles.

## Repository layout

- `agent/`: scaffold for root eve definitions, instructions, tools and channels.
- `apps/web/`: scaffold for Next.js routes, components and web-specific adapters.
- `lib/`: scaffold for shared client-safe contracts and server-only scheduling capabilities.
- `tests/`: scaffold for integration and browser tests; unit tests live beside modules.
- `documentations/`: project documentation and research.
- `supabase/`: local configuration, declarative schemas, migrations and database tests.
- `openspec/`: behavioral specifications and bounded implementation changes.
- `scripts/`: repository and operator tooling.

See the [frontend architecture](documentations/technical_specification/02_frontend_architecture.md) for the proposed web structure and [backend architecture](documentations/technical_specification/01_backend_architecture.md) for backend module responsibilities.

## Rebuild status

The product is pre-launch. A full application-source rebuild is planned on `feat/reconstruct-application` in the main checkout, including the web, agent integration, Supabase scheduling backend, contracts and channel integration. Supabase remains selected infrastructure. Next.js with eve is the proposed direction, subject to build, authorization and recovery checks.

The selected rebuild Supabase project is **`mriseqztcwmezvtawnbo`**. The main checkout is linked to this project, and its ignored root environment contains matching project credentials. See the [project connection status](documentations/technical_specification/03_provider_setup.md#selected-rebuild-supabase-project) before any deployment.

Start with the [implementation plan](documentations/technical_specification/04_implementation_plan.md), [page list](documentations/user_experience/04_page_list.md) and [documentation index](documentations/README.md). The replacement is not implemented or verified by these documentation changes.

Track unresolved provider/client checks in the [implementation gates](documentations/technical_specification/04_implementation_plan.md#compatibility-gates). Preserve external resources and secrets, and prevent competing consumers before controlled provider testing.

## Email delivery

Use **Cloudflare Email Service** for host invitations, contact verification, recovery and booking confirmations, sent from `no-reply@findmeatime.com`. Supabase Auth also sends authentication email through **Cloudflare custom SMTP**. **AgentMail** handles conversational scheduling inboxes, threads and replies. See [email setup](documentations/technical_specification/03_provider_setup.md#cloudflare-email-service).

## Local development

The agreed directory scaffold is now in place, with tracked placeholders and ownership notes. Runtime entrypoints, application code, dependencies and build/deployment configuration remain Phase 1 work.

The former web app, backend runtime, contracts and Photon bridge implementation have been removed. There is no runnable application or deployment command until the reconstruction is implemented. The target is **`https://release.findmeatime.com`**; local browser callbacks use **`http://localhost:3000`**. Local source recovery remains available in the ignored `.local/rebuild/pre-removal-2026-10-07/` checkpoint.

Use Node.js 24, npm 11, Supabase CLI 2.119.0 and OpenSpec CLI 1.14.0. Run `npm ci` and `npm run check` for documentation links, retained script syntax and SMTP configuration tests. These checks do not build or validate a replacement app. App typecheck, lint, tests and build must return with the new implementation.

The SQL schemas, migrations and database tests are preserved as a baseline; they are not the final rebuilt schema. With a disposable local Supabase stack running, `npm run db:test` checks that baseline. Follow the [pg-delta schema workflow](AGENTS.md#supabase-schema-changes) when replacing it; do not erase migration history or generate a migration from an accidentally empty desired schema.
