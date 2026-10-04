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

- `apps/`: application code.
- `documentations/`: project documentation and research.
- `supabase/`: local Supabase configuration and database migrations.

See the [planned repository structure](documentations/technical_specification/02_repo_structure.md) for the web/CLI apps, Supabase Edge Functions, shared modules, and test layout.

## Local development

Use Node.js 24, npm 11, Deno 2.9.1, Docker, Supabase CLI 2.119.0 and OpenSpec CLI 1.14.0.

```sh
npm ci
cp .env.example .env
supabase start
supabase db reset --local
supabase functions serve --env-file .env
```

In another terminal, create `apps/web/.env.local` with the local Supabase URL and publishable key printed by `supabase status`, then run `npm run dev`. Set `APP_ORIGIN=http://localhost:3000` and persist random `WORKER_SECRET` and a base64-encoded 32-byte `TOKEN_ENCRYPTION_KEY` in the ignored root `.env` before starting functions. Provider credentials remain backend-only. See [web setup](apps/web/README.md) for details.

Run `npm run check` for application typechecks, lint, tests and production build, and `npm run db:test` for the disposable local database tests. Database tests run inside rolled-back transactions and never target the hosted project.

The API has public intake routes and validates protected host/request credentials internally. The worker accepts only its internal secret. Workflow tables remain private behind a service-only command RPC. External delivery is disabled by default in local/preview configuration.
