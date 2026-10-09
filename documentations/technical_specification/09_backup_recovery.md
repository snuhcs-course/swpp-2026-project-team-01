# Backup and restoration readiness

This runbook owns the database recovery procedure and evidence for [Phase 9](04_implementation_plan.md#phase-9--harden-deploy-and-close-release-gates). It does not certify release readiness or replace guarded [booking and delivery recovery](08_operational_diagnostics.md#recovery-boundaries).

## Selected environment and observed coverage

On 2026-10-09, Supabase CLI **2.119.0** identified `mriseqztcwmezvtawnbo` as **FindMeATime2**, `ACTIVE_HEALTHY`, `us-west-1`, PostgreSQL `17.11.0.003`. `supabase backups list --project-ref mriseqztcwmezvtawnbo --output-format json` returned `walg_enabled: true`, `pitr_enabled: false`, an empty backup list and empty physical-backup data. WAL-G being enabled does not establish an available restore point. Do not claim a recoverable production backup from that flag or from successful migration tests.

A logical export contains different material from the platform configuration. The inspected data export includes Auth, the private application schema, pgmq queues and Storage metadata. The application owns 82 exported tables. Migration history needs a separate export. Vault secret values, application/provider keys, runtime configuration, Storage object bytes and external Calendar/message state are not established as recoverable by these SQL files.

Provider references: [database backup coverage and restoration](https://supabase.com/docs/guides/platform/backups), [CLI export and restore considerations](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Recheck these and installed CLI help before a restore. Database backups exclude Storage object bytes, and restoring a project incurs downtime.

## Read-only inventory and export

1. Verify the CLI version, exact project identity and current CLI link. Keep the project reference explicit; never infer the target from the shell directory alone.
2. List actual backup availability. Record the observation time, available restore points and PITR state; absence is an open recovery gate.
3. Create a new ignored private export directory with mode `0700` and `umask 077`. Keep all SQL/log output private. Do not print a dump, connection string, password or `db dump --dry-run` output from a remote target.
4. Export custom roles, schema and data with the reviewed CLI. Export migration history separately. Each data dump is a database snapshot; the multi-command set is not a single atomic project snapshot. Record times and schema version, and arrange a controlled maintenance window for an actual recovery-quality export.

The following read-only commands use the selected source project and a pre-created private directory. `BACKUP_DIR` must identify a fresh ignored directory, not a shared/public location. CLI authentication must already identify the intended operator; do not put credentials in command arguments.

```sh
supabase --version
supabase projects list --output-format json
supabase backups list --project-ref mriseqztcwmezvtawnbo --output-format json
supabase db dump --linked --project-ref mriseqztcwmezvtawnbo --role-only --file "$BACKUP_DIR/roles.sql"
supabase db dump --linked --project-ref mriseqztcwmezvtawnbo --file "$BACKUP_DIR/schema.sql"
supabase db dump --linked --project-ref mriseqztcwmezvtawnbo --data-only --use-copy --file "$BACKUP_DIR/data.sql"
supabase db dump --linked --project-ref mriseqztcwmezvtawnbo --schema supabase_migrations --file "$BACKUP_DIR/history-schema.sql"
supabase db dump --linked --project-ref mriseqztcwmezvtawnbo --schema supabase_migrations --data-only --use-copy --file "$BACKUP_DIR/history-data.sql"
```

Before treating the export as usable, check command exit status, nonempty files, expected schemas/tables and migration versions without printing row values. Encrypt it at rest and verify authenticated decryption against the original file hashes. Keep the encryption key outside the export directory with independent access control. A same-machine encrypted copy and its key do not protect against losing that machine; an independently recoverable off-site copy and key custody are still required.

## Current private export artifact

The 2026-10-09 export is retained in ignored `.local/recovery/2026-10-09/` as five authenticated ciphertext files plus a format/hash manifest and `verify.mjs`. Its random key is in `~/.local/share/find-me-a-time/backup-keys/<manifest-keyId>.key`, outside the export directory; both ciphertext and key use mode `0600`. The manifest records AES-256-GCM, the header/nonce/tag layout, authenticated project/filename context, original sizes and export times. It contains no key. `node .local/recovery/2026-10-09/verify.mjs` verifies file hashes, authenticated decryption and tamper rejection in memory without writing plaintext or contacting a database. Keep the key and manifest available for the isolated restore rehearsal; do not publish either the export or operational key material.

The five files are custom roles, application schema, data, migration-history schema and migration-history data. This export set covers 117 COPY targets including 82 application tables and 102 migration records. The local encrypted copy has passed the bounded SQL restoration drill below; application recovery and independent backup durability remain unverified. A deletion from the local filesystem is not a claim of forensic secure erasure.

## Isolated SQL restore evidence — 2026-10-09

The export was decrypted in memory and streamed into a separate `public.ecr.aws/supabase/postgres:17.11.0.003` container. Docker network mode was `none`, no ports were published, database storage used a temporary memory filesystem, `cron.launch_active_jobs=off` was verified before loading data, and no application workers ran. The container and its temporary storage were removed after verification. The existing local stack and release database were untouched.

This drill used the image's platform initialization plus a **schema-only** Auth/Storage scaffold from the existing local stack. It did not establish exact hosted platform configuration parity. Two service-role names missing from the base image were created as non-login placeholders (`supabase_realtime_admin`, `supabase_functions_admin`); these are not recovered service credentials or a verified production role configuration.

Two stop-on-error attempts rolled back before the final restore succeeded. They exposed prerequisites that a new incident destination must satisfy:

- The exported role grants reference platform service roles absent from the bare PostgreSQL image. A real destination needs the supported Supabase platform roles and service configuration before importing custom roles.
- The schema export installs pgmq but omits its extension-owned queue tables, while this data export contains `pgmq.a_fmat_jobs` and `pgmq.q_fmat_jobs`. After restoring schema and before importing data, create the existing non-partitioned, logged queue. The populated drill below additionally established that the pgmq extension and queue must have the application's expected `postgres` ownership: use `SET ROLE postgres; SELECT pgmq.create('fmat_jobs'); RESET ROLE;` after verifying that extension ownership and schema privileges match the source. Creation as the restore administrator can load rows but leave application commands unable to use them. **Do not call `fmat.install_runtime()` during a fenced drill:** it also schedules recovery work. Cron jobs were absent after this restore and require deliberate review and activation later.

The successful import used one transaction with `ON_ERROR_STOP=1`: custom roles, application schema, migration-history schema, queue creation, then data/history data with replication triggers temporarily disabled as described by the provider procedure. Restoration took 248 ms once the prepared destination and prerequisites were ready; this is not incident recovery time or an RTO measurement.

Verification compared each exported COPY column set and every row against the destination in memory, including migration history: **118 targets, 121 rows**, with exact sorted COPY-content parity. It checked **124 application foreign keys**, finding no orphan rows, and confirmed 102 migrations through `20261009025836`, 82 application tables, no anonymous/authenticated usage of the private schema and no public tables with RLS disabled. No cron jobs or Vault secrets were restored. Private artifacts include `restore.mjs`, `platform-baseline.sql`, logs and `restore-verification.json` beside the encrypted export; SQL data was never written back to a plaintext file.

The snapshot contains no Auth users, requests, booking attempts, reservations, booking deliveries, conversation scopes or OAuth grants. Therefore this drill cannot demonstrate recovery of those populated states, encrypted Calendar credentials, session revocation or provider uncertainty. The required synthetic application recovery scenarios below, independent key custody and off-site storage remain open. The manifest distinguishes SQL restoration from complete application recovery.

## Repeatable populated-state drill

Run `npm run test:restore` after starting this repository's local stack and applying its current migrations with Supabase CLI 2.119.0. The test requires Docker and verifies the running local stack uses exactly PostgreSQL `17.11.0.003` from a verified Supabase image name (ECR, GHCR or the Docker Hub fallback used by CLI 2.119.0). It starts isolated destinations from that container’s immutable local image ID with `--pull=never`, avoiding a separate registry lookup or mutable-tag resolution. Startup failures retain a bounded daemon reason with inherited credential values and URL credentials/query data removed; SQL dumps and command inputs remain excluded. CI explicitly writes `17.11.0.003` to its disposable `supabase/.temp/postgres-version` and checks `supabase services -o json` before starting the stack. This is necessary because CLI 2.119.0 defaults to `17.11.0.002` in an unlinked checkout; the linked developer cache is not in Git. Keep this pin and the restore assertion aligned during a coordinated upgrade. CI runs it after application database integration. It checks the local container's project label and reads **schema only**, then prepares two uniquely named, labelled containers with no network, no published ports, memory-backed data directories and disabled cron dispatch. It has no remote target option, reads no existing application rows or production keys, and removes both containers in cleanup, including failure paths.

The test creates synthetic data through the application's booking, conversation and OAuth commands, with constrained fixture setup for host/request details and an uncertain outbox record. One Calendar outcome is simulated as confirmed and another as a lost response. These are test evidence, not real provider observations. It exports and restores all application/Auth state and exact queue rows in memory, then compares every row in 89 application/Auth/queue tables before exercising restored behavior:

- A confirmed request remains booked; an uncertain attempt retains its host reservation and immutable event/payload identity. Retry and withdrawal cannot reset uncertainty, and repeated dispatch cannot authorize a second insertion.
- An uncertain delivery retains its provider reference and original dispatch time. Dispatch after the existing reconciliation window fails without changing it to sent or generating a replacement identity.
- Accepted native contact shares remain terminal. Restored in-flight shares with expired leases become uncertain and cannot authorize another dispatch or stale completion. Pre-dispatch contact work retains its original intent, retry aliases, saved route and consumed claim count; a fresh lease still rechecks the initiating session before allowing dispatch.
- A pending conversation input reuses its restored receipt instead of adding another message. A restored execution grant backed by an expired Auth session is denied.
- A revoked OAuth grant, its consumed authorization code and its refresh family remain unusable.
- A synthetic encrypted Calendar credential opens with the retained original application key and context; a different key or principal context fails.
- Private-schema access stays denied to anonymous/authenticated roles; queues preserve their contents and sequence, and a new publication receives a fresh message ID. No cron task or provider consumer is activated.

**Queue export caveat:** the inspected local pgmq 1.5.1 tables are extension members; raw `pg_dump --data-only`, even with explicit table selection, omitted their rows. The retained production CLI export did contain queue COPY targets, so do not infer coverage from a successful exit code or one environment. Check both queue tables and the sequence in every export. The synthetic test supplements the application/Auth dump with explicit column-bound `COPY ... TO STDOUT` for `pgmq.q_fmat_jobs` and `pgmq.a_fmat_jobs`, plus `last_value`/`is_called` for `pgmq.q_fmat_jobs_msg_id_seq`; it does not detach tables from the extension. Exporting a busy production queue this way also requires a coordinated snapshot or fenced maintenance window.

The latest populated-state run passed in 7.1 seconds, including native contact-sharing cases, setup, restore, command checks and cleanup. This is a repeatable database/application-command drill, not full web/eve startup, managed-service recovery, off-site durability, recovered production key custody, a live provider reconciliation or an incident RTO measurement. Those release gates remain open.

## Restore rehearsal before incident use

Use an explicitly identified isolated destination with matching supported PostgreSQL/extensions. Never rehearse by resetting or overwriting the release database. A migration reset proves schema reconstruction, not restoration of Auth identities, queues, encrypted credentials or uncertain provider outcomes.

- Fence all outbound workers, scheduled dispatch and inbound provider consumers before loading data. Keep the destination without production provider credentials and dispatch Vault entries; isolate its network for a local drill. Preview messaging guards alone do not fence Calendar writes, all database activity or model calls.
- Restore custom roles, schema, data and migration history following the current provider procedure, with stop-on-error behavior and a transaction where supported. Review managed-schema/extension ownership and existing platform objects. Do not blindly apply a production dump over a populated destination or suppress errors to obtain a nominal success.
- Preserve separately stored encryption material: `TOKEN_ENCRYPTION_KEY`, invitation code key, intake proof key and OAuth signing/verification material. Restored rows without matching keys cannot recover their credentials. Recreate destination-specific Auth/provider configuration and dispatch secrets deliberately; never copy live scheduler URLs into an unfenced rehearsal. Vault encryption-root handling is separate from application AES encryption.
- Verify row counts and referential invariants, migration parity, grants/RLS and private-schema access. Verify Auth/session revocation, OAuth grants, request proofs, encrypted Calendar credentials, invitation derivation, queue publication and replay identities. Test the actual application against restored synthetic fixtures before using production data for an authorized isolated rehearsal.
- Exercise at least a confirmed request, an unresolved booking with its held reservation, an uncertain delivery, an active conversation and a revoked grant. Preserve their pre-restore meanings. No operator may manufacture approval, declare an uncertain write failed, release an unresolved reservation or reset a delivery identity to make the drill pass.
- Measure restore duration and the age of the recovered snapshot. Record exact versions, target, checks and cleanup. Only then compare measured recovery to the chosen recovery-time and data-loss objectives.

## External effects after a restore

Calendar events, sent email and iMessages are not rolled back with PostgreSQL. A restore point may predate the saved dispatch even when the provider already accepted it. Keep workers and inbound consumers fenced until the operator has accounted for those effects against durable provider identities and the existing booking/delivery reconciliation rules. Do not automatically replay a restored queue or generate replacement identities. Restored OAuth grants and browser proofs also need explicit revocation review before reopening access.

Native contact sharing has no provider reconciliation handle. The drill proves preservation of outcomes already recorded in the backup; it cannot discover a contact card sent after that snapshot. Keep restored contact workers fenced while the operator reviews possible later effects. Do not turn a restored queued row into permission to replay an unknown external effect merely because its dispatch marker is absent from an older backup.

Deployment rollback is a separate operation: promoting an older compatible application does not restore database data or reverse provider actions. Keep migrations as immutable history and verify that the selected application understands the restored schema/state.

## Conversation text minimization

The credential-text migration replaces recognized credentials in `fmat.runtime_messages.text` irreversibly. It first derives the private original-input retry digest in the same row update, preserving an existing digest for newly protected rows. Message identity, status, ordering and session bindings remain unchanged. Application rollback must retain the protected text and compatible digest comparison; it must not recover plaintext from backups to restore an older retry implementation.

Historical backups, provider inbox rows and previously generated eve checkpoints/transcripts are separate copies; this migration does not erase or rewrite them. Before activating a restored database, keep consumers fenced and apply the structural protection plus data migration to any older ledger. Check that pending delivery and inspection expose protected text, original exact retries succeed and changed-secret retries fail. Do not infer historical erasure from a successful backfill or restore drill.

## Remaining release decisions

| Requirement | Current evidence / missing result |
|---|---|
| Available platform restore points | The selected project's observed list is empty; PITR is disabled. |
| Export preservation | See the dated evidence ledger for completed local exports and encryption verification. This is not off-site durability. |
| Restore rehearsal | Production-export SQL/content drill and synthetic populated application-command drill pass. Managed/full-runtime recovery, actual key recovery and live provider reconciliation remain unverified. |
| Data-loss and recovery-time objectives | Numeric objectives and measurements remain to be selected and verified before launch. |
| Retention and deletion | Backup retention, deletion propagation and application data policy remain unresolved product/operations decisions. |
| Operational ownership | A named primary/backup operator, incident contact and key custodian remain to be designated. |
| Independent storage and key custody | Off-site location, access control and recovery of the encryption key remain to be configured and tested. |

Do not close the Phase 9 backup/recovery gate until these decisions and an isolated restore rehearsal have direct evidence.
