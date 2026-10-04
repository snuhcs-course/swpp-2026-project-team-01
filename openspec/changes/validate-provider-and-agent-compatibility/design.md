# Design

## Context

See proposal.md for the compatibility problem. Provisioning is documented, but seven-client OAuth, user Calendar grants, and controlled messaging conversations need actual runtime evidence. P0 records limits rather than replacing them with mock success.

## Goals / Non-Goals

**Goals:** make implementation choices concrete, run safe negative/fixture provider probes, and retain a traceable compatibility matrix.

**Non-Goals:** implement P5/P6 clients/channels or claim live consent from credential-only probes.

## Decisions

- React/Vite/npm with shadcn preset `b6rtA2Hmi` supplies the responsive web app; Vercel serves its assets. Supabase Deno/Hono, PostgreSQL 17, Queues, and Cron remain the scheduling backend.
- OpenAI structured extraction/ranking uses a tested strict JSON contract around deterministic domain logic. The model cannot approve meetings or bypass rules.
- Only explicit authenticated web confirmation supplies P0–P4 host approval. Personal-agent approval requires later attributable human-confirmation evidence; ordinary model fields do not qualify.
- Invites expire in seven days. Requests expire at the earlier of seven days or requested-window end. Guest tokens are request-bound, capped at thirty days, and revoked on closure; recovery verifies original contact. English and Korean intake are supported; online meeting URLs are supplied and confirmed by hosts.
- Use credential-presence, authenticated read, disposable fixture, and live end-to-end evidence as distinct result types. Each check records date, actual versions, procedure, safe output, and gaps. Never store raw secrets, user tokens, or private conversation bodies in reports.
- For Photon, select direct Spectrum transport through a narrow Node/Bun bridge rather than introducing Mastra scheduling logic. Its documented Node-compatible gRPC boundary excludes strict worker isolates; transport proof remains required before delivery is enabled.
- Preserve the seven named clients individually in the matrix. Supabase OAuth being disabled is an explicit P5 prerequisite, not authority to silently substitute a different token protocol.

## Risks / Trade-offs

- [No interactive client/user grant available] → Mark untested cases incomplete and continue independent P1–P4 implementation.
- [Routes returns no routes for a geography/mode] → Preserve unresolved travel and offer confirmed manual allowances; never infer zero travel.
- [Credential probe mistaken for integration] → Separate probe status from live consent/write/webhook/conversation evidence.

## Migration Plan

Commit reproducible scripts and sanitized result artifacts with runtime decisions. Deploy callback endpoints through their owning phases before editing provider URLs. Keep live test writes and sends limited to controlled identities. Changes to providers remain auditable in setup documentation.
