# Design

## Context

See the proposal. `fmat.calendar_scans` holds temporary input, summary and decision replay content; the existing host operation deletes its own rows older than 24 hours. Draft/settings provenance and dismissal fingerprints are stored independently, with no foreign key from them to a scan. Result freshness (15 minutes) remains separate from storage cleanup.

## Goals / Non-Goals

Add background enforcement of the existing cutoff with bounded database work and no provider/runtime dependency. Do not define general transcript, contact, request, audit, credential or backup retention; do not erase adopted values or dismissal fingerprints.

## Decisions

- Add a `(created_at,id)` index for cross-host expiry selection; the existing host-first index does not support this access path.
- Use a private invoker function executable only by the database owner. It selects at most 1,000 old rows in deterministic order with `FOR UPDATE SKIP LOCKED`, then deletes just those rows and returns a count. A 50 ms lock timeout bounds unrelated lock waits. No HTTP endpoint or service-role RPC is needed; exposing one would add unnecessary maintenance authority.
- Capture the cutoff once per invocation. Keep the current strict `created_at < now - 24 hours` condition. A lock holder cannot make recent evidence eligible; skipped old rows remain eligible on later passes. Concurrent passes can process disjoint rows safely. Keep foreground cleanup as a fallback.
- Register one named pg_cron job each minute with a five-second statement timeout in its command. Returning only a count avoids logging private row contents. Scheduled work is bounded per pass, not a promise of deletion at exactly hour 24; inspect the oldest remaining eligible timestamp and job health for backlog/disablement.
- Preserve adopted settings/progress/dismissals and all domain work. Cleanup removes the complete temporary row, including replay input/summary, matching existing host-initiated cleanup. A new scan after this retention boundary still requires explicit consent and current authority.

## Risks / Trade-offs

- Expired rows may be locked, arrive faster than capacity, or remain during scheduler downtime → skip rather than impede user work, document backlog inspection and repeated bounded manual passes.
- Logical backups can retain historical evidence → this change makes no backup erasure claim; broader backup policy remains open.
- Cron registration can drift on restore → verify one active named job and its command after migration; isolated restore drills intentionally disable cron.

## Migration Plan

Generate and review the declarative migration, including the index/function privileges and single scheduler row. Rebuild the disposable local database; verify retention, access denial, preservation, batching and concurrent lock handling. Run integration/restore regressions and security advisors. Review selected-production dry run, deploy, compare function/privileges/schedule and verify actual scheduled cleanup with synthetic evidence and no provider calls. Disable only this named cron job to suspend cleanup; preserve migration history. Deleted temporary evidence is not reconstructed by disabling maintenance.
