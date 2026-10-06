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

- `agent/`: eve definitions, instructions, tools and channels.
- `apps/web/`: Next.js routes, components and web-specific adapters.
- `lib/`: shared client-safe contracts and server-only scheduling capabilities.
- `tests/`: scaffold for integration and browser tests; unit tests live beside modules.
- `documentations/`: project documentation and research.
- `supabase/`: local configuration, declarative schemas, migrations and database tests.
- `openspec/`: behavioral specifications and bounded implementation changes.
- `scripts/`: repository and operator tooling.

See the [frontend architecture](documentations/technical_specification/02_frontend_architecture.md) for the proposed web structure and [backend architecture](documentations/technical_specification/01_backend_architecture.md) for backend module responsibilities.

## Rebuild status

The product is pre-launch. A full application-source rebuild is in progress on `feat/reconstruct-application` in the main checkout, including the web, agent integration, Supabase scheduling backend, contracts and channel integration. Supabase remains selected infrastructure. Next.js with eve is the proposed direction, subject to build, authorization and recovery checks.

The selected rebuild Supabase project is **`mriseqztcwmezvtawnbo`**. The ignored root environment contains matching project credentials. Verify CLI link metadata before any remote operation; credentials alone do not establish a link. See the [project connection status](documentations/technical_specification/03_provider_setup.md#selected-rebuild-supabase-project) before any deployment.

Start with the [implementation plan](documentations/technical_specification/04_implementation_plan.md), [page list](documentations/user_experience/04_page_list.md) and [documentation index](documentations/README.md). Initial runtime builds and HTTP security checks are implemented. Scheduling journeys and release gates remain pending; see the [evidence ledger](documentations/technical_specification/05_rebuild_evidence.md).

Track unresolved provider/client checks in the [implementation gates](documentations/technical_specification/04_implementation_plan.md#compatibility-gates). Preserve external resources and secrets, and prevent competing consumers before controlled provider testing.

## Email delivery

Use **Cloudflare Email Service** for host invitations, contact verification, recovery and booking confirmations, sent from `no-reply@findmeatime.com`. Supabase Auth also sends authentication email through **Cloudflare custom SMTP**. **AgentMail** handles conversational scheduling inboxes, threads and replies. See [email setup](documentations/technical_specification/03_provider_setup.md#cloudflare-email-service).

## Local development

Use Node.js 24, npm 11, Supabase CLI 2.119.0 and OpenSpec CLI 1.14.0. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
cp .env.example .env # only for a fresh checkout; preserve an existing .env
npm run check
npm run build
npm run test:runtime
```

The build needs `OPENAI_MODEL=gpt-6-luna`; it does not call OpenAI or require a real API key. eve loads the root environment. Next.js reads environment files from `apps/web`, so use shell environment variables or the composed Vercel development server for shared server settings; do not copy secret files into application source. Docker is required for eve's default local sandbox preparation and local Supabase.

Use `npm run dev` with Vercel CLI 62.5.0 to serve the complete web/eve service graph on port 3000, or `npm run dev:web` / `npm run dev:eve` to work on one service. `npm run build` builds eve and Next.js independently; root `vercel.ts` composes them on Vercel. `npm run start:web` and `npm run start:eve` serve their respective production builds. Use different ports when running them together.

The landing page leads to `/app` for email sign-in, waitlist and invitation access. Protected `/booking/[bookingId]` pages exchange private links for request cookies and show authorized state. Admitted hosts and active requesters can send and replay protected conversations. Calendar setup and scheduling controls are still being implemented. Default eve session endpoints reject every caller. Application-owned `/api/conversations` routes require current host/request credentials; no synthetic development identity is enabled. A successful health response does not mean release readiness.

With disposable local Supabase/Mailpit running and port 3000 free, install Chromium with `npx playwright install chromium`, then run `npm run build:web && npm run test:browser` for the email/admission/private-link browser journey. See [web setup](apps/web/README.md) for session and cookie boundaries.

`npm run check` runs documentation links, script syntax, app typechecks, SMTP tests and HTTP security tests. `npm run test:runtime` exercises built servers and confirms anonymous session rejection. With local Supabase running, `npm run test:conversations` verifies actual eve ingress, scoped stream replay and post-commit process-kill recovery using a deterministic model fixture. `npm run verify:model` is an optional live direct-OpenAI structured-tool probe, requiring `OPENAI_API_KEY`; it sends only a synthetic prompt and incurs a small API charge. Model changes require updating verified context-window metadata and rerunning this probe.

The release target is **`https://release.findmeatime.com`**; local browser callbacks use **`http://localhost:3000`**. Verify the selected project, domain and callback configuration before deployment. Local source recovery remains in the ignored `.local/rebuild/pre-removal-2026-10-07/` checkpoint.

The SQL schemas, migrations and database tests are preserved as a baseline; they are not the final rebuilt schema. With a disposable local Supabase stack running, `npm run db:test` checks that baseline. Follow the [pg-delta schema workflow](AGENTS.md#supabase-schema-changes) when replacing it; do not erase migration history or generate a migration from an accidentally empty desired schema.
