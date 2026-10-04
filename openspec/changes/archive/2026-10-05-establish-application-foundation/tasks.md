# Tasks

## 1. Executable workspace

- [x] 1.1 Add npm workspace tooling and React/Vite web scaffolding with shadcn preset `b6rtA2Hmi`; verify package installation, typecheck, and production build.
- [x] 1.2 Add shared audience-safe TypeScript contracts and Hono/Deno API configuration; verify Deno checks, safe error envelopes, and missing-config rejection tests.
- [x] 1.3 Document local environment examples and startup commands in the owning setup documentation; verify commands from a fresh dependency installation without real secrets committed.

## 2. Transactional command and schema foundation

- [x] 2.1 Add service-only command dispatch, ownership guards, and idempotency; verify unauthorized actors, changed retry input, and repeated retries. Define the expected-revision envelope for enforcement by P3 request commands.
- [x] 2.2 Add desired schema with explicit grants and RLS, generate an unapplied pg-delta migration, and review SQL; verify CLI 2.119.0 and disposable local full-chain reset.
- [x] 2.3 Document the command/schema boundary and extend local database tests; verify public Data API calls cannot invoke privileged commands or read workflow tables.

## 3. Durable execution and checks

- [x] 3.1 Add transactional queue publication, bounded internal workers, ownership/fencing, and Cron recovery; verify rollback, duplicate redelivery, terminated ownership, and lost wake-up tests.
- [x] 3.2 Add provider test doubles and scoped diagnostics; verify secrets/private content are absent from returned errors and logs and production does not select doubles implicitly.
- [x] 3.3 Add lint, typecheck, unit/database tests, web build, and CI; verify the same documented commands pass locally and in CI.
- [x] 3.4 Record P1 exit evidence in the implementation plan; verify a clean checkout starts, builds, rebuilds migrations, and drains a saved internal job.

## Verified evidence

2026-10-05: clean `npm ci`, `npm run check`, reviewed pg-delta migration, `supabase db reset --local`, and 29/29 pgTAP tests pass. Actual local Edge health returns 200 and the authenticated worker drains a persisted ping (`claimed: 1, completed: 1`). GitHub Actions run 37239080874 on commit 8d32364 passes both application and database jobs, including clean Linux npm ci/build and full migration reset. The local suite currently includes 16 independently implemented P3 evaluator tests, excluded from the P1 commit.
