# Application verification

These directories reserve the replacement integration and browser test locations. Initial HTTP security unit tests live in `lib/server/identity/`; `scripts/smoke-runtime.mjs` exercises the built production servers without model calls.

- `integration/`: shared domain, eve/web runtime, authorization and channel boundaries.
- `e2e/`: complete browser journeys against the rebuilt application.

Keep unit tests beside their modules and database tests in `supabase/tests/`. Run `npm run check` for types, HTTP security, documentation and SMTP tests. After `npm run build`, run `npm run test:runtime` for health, response headers and anonymous denial at every exposed eve session endpoint. Run `npm run db:test` against the disposable local Supabase stack. Cross-user authorization, durable recovery and browser journeys remain unverified; do not count empty directories as coverage.

See the [implementation plan](../documentations/technical_specification/04_implementation_plan.md).

`npm run test:integration` requires the disposable local Supabase stack. It creates and removes one synthetic local Auth user, verifies real token validation and service-only RPC permissions, denies unadmitted conversation access, then verifies immediate logout invalidation. The test rejects non-loopback targets and does not load remote credentials from `.env`. CI runs it in the database job after the migration reset and pgTAP suites.
