# Design

## Context

See [proposal](proposal.md). `AvailabilityEvaluation.evaluate` currently runs sequential refresh/list/freebusy work, then up to thirty candidate assessments with adjacent-event pages and two travel legs. Adapters own independent 10–20 second timeouts. `SchedulingPublication` invokes evaluation then `CandidateRanking`; the latter has a separate 30-second model limit. The retired evaluator defaulted to 18 seconds for shared provider work. Current SQL rechecks identity/revision and evidence freshness; those checks must remain.

## Goals / Non-Goals

**Goals:** one invocation-scoped deadline; bounded waiting even for non-cooperative dependencies; no late continuation that starts domain work; maintain existing private error and uncertainty semantics.

**Non-Goals:** cancel a provider effect already accepted, alter booking identities, replace durable jobs, change model allowance accounting, or certify real Google access.

## Decisions

1. Create an invocation-scoped budget using a monotonic clock, one cancellation controller and deterministic test clock/timer hooks. Restore the historical 18 seconds. Do not restart it per page or candidate. A fresh explicit retry is a fresh invocation but still uses existing durable identity/revision rules. Dispose timers/listeners on every exit.
2. Add optional signal/context parameters to the provider interfaces and combine them with existing narrower deadlines. Thread the same budget through refresh (including the installed Google OAuth transport), catalog/freebusy/adjacent paging, Routes, ranking and publication. Preserve backward compatibility for unrelated callers. Do not use mutable singleton state or mutate global fetch.
3. Race dependency completion against cancellation to stop waiting when an injected provider ignores signals. Check the budget before and after each awaited operation and before starting subsequent RPC/provider work. A losing promise must have rejection handling; it must not retain a continuation that writes evidence. Abort response-body readers and cover headers/body stalls separately.
4. Bound the complete publication chain, not only an individual adapter. Direct evaluation and booking revalidation create their own budget; publication supplies one through evaluation and ranking. Keep ranking's allowance reservation before actual provider work; a reservation committed before timeout remains charged. No model fallback or partial candidate publication.
5. Keep authority checks and durable cleanup distinct from success work. Deadline failure uses existing sanitized unavailable/incomplete responses and bounded failure recording. An in-flight RPC may have committed; use existing reads and retry identities instead of reporting rollback. Test the boundary before dispatch and late responses explicitly. Provider cancellation cannot guarantee cancellation of a remote write; this change must never retry Calendar insertion.

## Risks / Trade-offs

- Large physical batches can exhaust 18 seconds → retain explicit incomplete feedback and prove no partial publication; measure normal paths without silently expanding the budget.
- OAuth-library cancellation behavior differs from fetch → verify the installed adapter at the request boundary, including signal and response-body behavior; do not claim a wrapper alone aborts network work.
- Route adapters convert failures into values → budget checks after awaits must still terminate the whole expired evaluation.
- RPC results may commit before cancellation is observed → preserve durable recovery and distinguish no-new-work from rollback claims.

## Migration Plan

No schema migration is expected. Verify unit/provider cancellation, real local evaluation/publication/booking revalidation, and post-fixture SQL; build both services and smoke the runtime. Commit implementation with owning architecture/tests/plan updates. Deploy a scanned clean archive to the identified release project, verify Ready/alias/health/authorization, then record evidence. Roll back by promoting the previous verified deployment if regression occurs, preserving database history. Archive only after required behavior and deployment evidence pass.
