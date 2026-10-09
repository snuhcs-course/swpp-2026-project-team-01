# Design

## Context

The server `Database` adapter centralizes mapped SQL errors and returns application OAuth error objects. Existing diagnostics are service-only and read-only; their v1 persisted-state contract must remain valid through deployment. See the proposal for motivation.

## Goals / Non-Goals

**Goals:** durable, content-free observations at the existing database boundary; explicit operator access; additive deployment and bounded request overhead.

**Non-Goals:** an exhaustive security audit log, unique-user/action counts, HTTP ingress statistics, alerts, recovery authority or a change to general user-data retention. A recorded attempt can be a legitimate expired/revoked operation, not an attack.

## Decisions

1. Store `(bucket_start, category, count, last_seen_at)` in a private RLS-enabled table. Two categories and 24 hourly buckets bound normal retained state to 48 rows. A service-only recorder serializes pruning/increment with a short lock timeout, derives UTC time after acquiring the lock and caps each bucket at 1,000,000. On write, remove buckets outside the current/preceding 23 hours; inspection filters the same window without deleting. This avoids raw-event cardinality and secret/identity retention. Idle expired rows may remain until the next observation; inspection never reports them as current.
2. Map existing `UNAUTHORIZED`, `FORBIDDEN`, `HOST_NOT_ADMITTED` and `STALE_REVISION` adapter errors, including SQL aliases already mapped to them. Recognized returned OAuth `invalid_grant`, `invalid_scope`, `invalid_token` and `invalid_client` errors from OAuth/agent RPCs count as authorization denial. Do not infer denial from masked 404s, unknown SQL text, malformed input or arbitrary provider errors.
3. Enable collection only with `OPERATIONAL_REJECTIONS_ENABLED=true`. Send one separate fixed-category RPC using the existing server origin/key, with a 250 ms independent deadline, abort and no retry. Bypass the normal adapter for this write to prevent recursion; its result is never interpreted as a domain result. Disabled collection has no added request. A lost telemetry acknowledgement can still represent a committed count; do not retry it. This preserves caller semantics while explicitly accepting incomplete observations.
4. Add a new strict rejection snapshot contract and `diagnostics --rejections`, preserving the default v1 state snapshot and existing invocation. Rejection mode rejects a sample option because it never returns IDs. Both modes use the existing explicit project/server credential validation. Exclude both diagnostic RPCs and the recorder from collection.
5. Deploy the additive schema first, then the application and the production-only activation flag. No scheduler or provider action is added. Read counts with the actual operator command, exercise a controlled rejected RPC and verify only the expected counter changes; retain no private content. Roll back collection by disabling the flag or restoring the earlier app, leaving the additive schema intact.

## Risks / Trade-offs

- Best-effort delivery, contention and bounded counters undercount activity → disclose observed-attempt semantics, saturation and missing ingress coverage; never use zero as a health result.
- Extra work on a rejection → at most one 250 ms attempt, 50 ms database lock wait and constant table cardinality; no new work on success or when disabled.
- Central adapter sees only database traffic → retain explicit pre-database/uncategorized gaps and the existing snapshot's unavailable rate fields.
- Counter writes survive rejected domain transactions → separate RPC contains no actor or payload and cannot mutate domain tables.

## Migration Plan

Generate and review the pg-delta migration, verify the disposable local rebuild, permission/concurrency/window/saturation/no-mutation tests, adapter timeout/privacy tests and actual CLI integration. Deploy reviewed schema and app to the already selected release target; verify activation, protected rejection and operator output. Archive only after the bounded requirements have direct evidence. Broader Phase 9 gates remain open.
