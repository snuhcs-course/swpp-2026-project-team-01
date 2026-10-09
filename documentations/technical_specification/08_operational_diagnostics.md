# Read-only operational diagnostics

Use this command to inspect persisted work before choosing a guarded recovery path. It does not send messages, run workers, clear reservations, alter approvals, retry provider writes or determine release readiness. Implementation and production acceptance are tracked in the [diagnostics change](../../openspec/changes/archive/2026-10-09-inspect-operational-health/tasks.md).

## Running the command

Run from the repository with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` already supplied by the operator's secure environment. The command does not load `.env` automatically. Never pass a key as a command-line argument or put it in an incident note. Select the actual database explicitly:

```sh
npm run --silent diagnostics -- --project mriseqztcwmezvtawnbo
npm run --silent diagnostics -- --project local --samples 0
npm run --silent diagnostics -- --help
```

The selected remote reference must exactly match the configured Supabase origin; `local` accepts only literal loopback origins. A valid server credential is required at the database boundary. Browser/user/agent credentials cannot inspect this cross-tenant state. Credential shape checks reject mistakes early and never substitute for database authentication.

Success writes one JSON object to stdout with `project`, `version: 1`, database `observedAt`, `ageThresholdSeconds: 300`, `sampleLimit`, `coverage` and thirteen `signals`. Each signal contains `category`, `count`, nullable `oldestAt` and UUID/timestamp `samples`. Default sample size is 10; `--samples 0` returns aggregate counts, and the maximum is 20 per category. Samples are ordered oldest first with UUID tie-breaking. Counts include all matching persisted rows even when samples are truncated. One record can appear in multiple categories. Invalid flags, malformed results and provider errors exit nonzero with only a stable JSON error category on stderr. Failed queries never become an empty success.

There is no public/browser/MCP diagnostics route. The service-only `fmat_operational_snapshot(integer)` function reads the private ledgers; neither it nor the CLI writes an inspection record or changes a workflow. Treat opaque IDs as internal incident references and avoid publishing snapshots broadly.

## Signal meanings

| Category | Included state | Timestamp / sample identifier |
|---|---|---|
| `overdue_jobs` | Pending job available for at least five minutes; future/recent jobs excluded | `available_at` / job ID |
| `expired_job_leases` | Running job whose ownership deadline passed | `lease_until` / job ID |
| `dead_jobs` | Retry-exhausted/dead jobs retained in the ledger | `updated_at` / job ID |
| `pending_runtime` | Pending conversation input created at least five minutes ago | `created_at` / input ID |
| `failed_runtime` | Retained failed conversation inputs | `created_at` / input ID |
| `held_reservations` | Every retained host booking reservation | `created_at` / booking attempt ID |
| `uncertain_bookings` | Dispatched, uncertain or conflicting booking attempts | Original dispatch time, otherwise creation / attempt ID |
| `failed_delivery` | Failed transactional outbox records | `updated_at` / outbox ID |
| `uncertain_delivery` | Uncertain transactional outbox records | `updated_at` / outbox ID |
| `failed_photon_replies` | Retained failed private reply records | `created_at` / reply ID |
| `uncertain_photon_replies` | Uncertain replies whose authority has not been revoked | Last check, otherwise creation / reply ID |
| `uncertain_email_replies` | Uncertain unsuppressed AgentMail replies | First attempt, otherwise creation / reply ID |
| `mismatched_decisions` | Active negotiating/approval/booking request with a saved agreement or approval version different from its current proposal | Request update / request ID |

The five-minute selection is an inspection threshold, not an SLO or authorization to retry. Terminal failure counts cover retained history, not a time-window failure rate. `failed_runtime` reports the input's creation age, not the time of failure. A held reservation can be valid active work. Expired ownership does not prove that a provider write failed. Mismatched saved decisions are not the rate of rejected stale actions; guards normally reject or clear them before they persist.

`coverage.authorizationDenialEvents` and `coverage.rejectedStaleActionEvents` are `not_recorded`: this snapshot cannot measure those event rates. `coverage.releaseReadiness` is `not_assessed`. Zero counts do not prove provider access, successful delivery, absence of rejected attacks, named-client compatibility or release readiness. The query scans retained matching state on demand; do not turn it into high-frequency polling without measured query/load evidence.

## Recovery boundaries

Record the selected project, observation time, category and relevant opaque ID in the incident record. Recheck current state before recovery; inspection is not a mutation grant.

- For aged jobs or runtime inputs, inspect the existing authenticated dispatch/recovery schedule and deployment logs with redacted identifiers. Let current-authority workers retain their original work identity and fencing. Do not set a pending message to completed, invent a runtime session or clear a job's lease manually.
- For reservations or uncertain bookings, identify the bound request through authorized incident investigation and use the [audited booking recovery workflow](03_provider_setup.md#operator-booking-recovery). `reconcile` retains the saved provider/event identity. A command acknowledgment is not booking success; verify the protected receipt and provider evidence. Do not delete a reservation or replace an event after an inconclusive lookup.
- For uncertain Cloudflare delivery, retain the original dispatch and investigate provider evidence. Do not reset the outbox or resend a possibly accepted message. Requester verification/recovery uses its explicit protected issuance flow and cooldowns; invitations use their [operator workflow](03_provider_setup.md#host-invitation-operations).
- For Photon/AgentMail replies, preserve the saved transport identity, bounded retry horizon and current sender/link authority. Use the existing reconciliation path; no universal resend command is introduced here. Do not fabricate a provider reference or delivery success.
- For mismatched decisions, return to the current proposal's participant review. No operator action substitutes for requester agreement or explicit host approval.

New automated alerts, durable denial/stale-rejection instrumentation, additional audited recovery commands, retention/deletion, backup restoration, performance targets and operational ownership remain open [Phase 9 requirements](04_implementation_plan.md#phase-9--harden-deploy-and-close-release-gates).

See [backup and restoration readiness](09_backup_recovery.md) before treating a database restore as job or provider recovery. Restoring saved state does not reverse external effects.
