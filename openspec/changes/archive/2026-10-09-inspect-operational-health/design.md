# Design

## Context

See [proposal](proposal.md). Private SQL ledgers already distinguish attempts, leases and uncertain outcomes. The existing service Database client sanitizes provider failures; operator invitation tooling checks explicit project origins. No browser or agent needs this cross-tenant view.

## Goals / Non-Goals

Provide a fixed read-only operational projection and repository command. Do not introduce repair SQL, provider calls, decision overrides, a public health detail endpoint or a privileged model tool. Alert thresholds, retention, backup ownership and new recovery commands remain broader Phase 9 work.

## Decisions

- Add one stable service-only SQL function with empty search path, fixed queries and a sample limit of 0–20 (default 10). Use one statement-time snapshot and fixed category ordering. Counts cover persisted matching rows; samples sort by oldest timestamp then UUID. Zero samples supports aggregate-only inspection. Prefer this allowlist to arbitrary SQL/table selectors.
- Report overdue pending jobs (available for at least five minutes), expired running leases, dead jobs, pending runtime inputs older than five minutes, failed runtime inputs, held reservations, dispatched/uncertain/conflicting booking attempts, failed/uncertain transactional outbox records, failed/uncertain Photon replies and uncertain unsuppressed AgentMail replies. Separate lingering mismatched current proposal decisions from rejected-action event rates. Five minutes is an inspection threshold, not a performance SLO or recovery trigger.
- Expose only category, count, oldest timestamp and internal UUID/timestamp samples. Never select job kind/error/payload, provider identities, contact details, message content or arbitrary JSON. Counts include retained history for terminal failures; an old count is not a rate. A single row can contribute to multiple independent categories.
- Explicitly return `not_recorded` coverage for authorization-denial and rejected-stale-action event rates, and `releaseReadiness: not_assessed`. Missing telemetry must stay visible. The runbook maps each signal to existing guarded workflows and forbids direct clearing or fabricated success.
- Validate strict input/output contracts on the server-side CLI boundary; reject malformed/extra fields and sanitize all exceptions. Reuse the existing explicit-project credential check, extracted without changing invitation semantics. CLI credentials come only from the environment. A ten-second transport deadline bounds waiting; database errors never become empty success.

## Risks / Trade-offs

- Full aggregate scans grow with retained history → use manual on-demand inspection, bounded samples and existing status indexes; measure larger deployments before introducing polling or performance claims.
- Counts can change immediately after observation → output the database timestamp and require current-authority recovery operations, never reuse the snapshot as mutation authority.
- Internal IDs can correlate private records → service-only execution and no public/MCP surface; no automatic logging of complete snapshots.
- Some rejected actions roll back without a durable event → explicitly mark event coverage absent; do not infer rates from surviving audit rows.

## Migration Plan

Generate/review an additive pg-delta migration, rebuild the disposable local database and test permissions/output/no mutation. Deploy only to the freshly identified selected project after dry run. Compare the function definition and privileges, run a controlled rollback-only production fixture and a read-only CLI snapshot. Rollback application use by stopping the command; no destructive schema rollback or provider action is needed.
