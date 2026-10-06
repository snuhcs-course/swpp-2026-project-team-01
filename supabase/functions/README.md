# Scheduling backend reconstruction

The former Deno/Hono API and worker source were removed on 2026-10-07. No Edge Functions are currently defined in this checkout. Existing remote functions were not changed.

Keep migrations, declarative schemas and database tests as the preserved database baseline until replacement migrations are reviewed. Rebuilt API, tools and worker placement is decided by the [runtime spike](../../documentations/technical_specification/04_implementation_plan.md#phase-1--prove-the-runtime-and-settle-deployment-decisions). See the [backend architecture](../../documentations/technical_specification/01_backend_architecture.md) and [removal record](../../documentations/archive/2026-10-07-source-removal.md).
