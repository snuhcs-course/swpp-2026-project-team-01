# Proposal

## Why

The repository documents a scheduling product but has no executable application or durable command infrastructure. P1 needs a shared foundation so web requests, future channels, and booking recovery use the same authorization and persistence boundaries.

## What Changes

- Establish a responsive React/Vite web workspace using npm and the requested shadcn preset `b6rtA2Hmi`.
- Add a Supabase TypeScript/Deno API, validated configuration, scoped errors, shared audience-safe contracts, and deterministic provider test doubles.
- Add transactional mutation/idempotency infrastructure and durable internal jobs with bounded authenticated workers and recurring recovery; establish the revision envelope for P3 enforcement.
- Establish reviewed declarative schemas and generated migrations, local development checks, and CI.

## Capabilities

### New Capabilities

- `application-commands`: Validated, authorized mutations with stable errors and retry semantics.
- `durable-jobs`: Persisted internal work with transactional publication, bounded claims, redelivery, and recovery.

### Modified Capabilities

None; the main capability inventory is empty.

## Impact

Affected paths: `apps/web`, `packages/contracts`, `supabase/functions`, `supabase/schemas`, generated `supabase/migrations`, root tooling, and CI. Hosting is Vercel for web and Supabase for backend. Provider calls remain server-side.

Basis: [backend architecture](../../../../documentations/technical_specification/01_backend_architecture.md), [PRD](../../../../documentations/02_product_requirements.md), and [backend contract](../../../../scripts/backend-contract.md).

P0 selects runtime and web choices; actual seven-client OAuth compatibility and messaging transports remain separately recorded gaps. This foundation does not claim those adapters work.
