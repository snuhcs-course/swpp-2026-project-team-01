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
- The schema export installs pgmq but omits its extension-owned queue tables, while the data export contains `pgmq.a_fmat_jobs` and `pgmq.q_fmat_jobs`. After restoring schema and before importing data, create the existing non-partitioned, logged queue with `SELECT pgmq.create('fmat_jobs');`. This matches the repository's runtime setup. **Do not call `fmat.install_runtime()` during a fenced drill:** it also schedules recovery work. Cron jobs were absent after this restore and require deliberate review and activation later.

The successful import used one transaction with `ON_ERROR_STOP=1`: custom roles, application schema, migration-history schema, queue creation, then data/history data with replication triggers temporarily disabled as described by the provider procedure. Restoration took 248 ms once the prepared destination and prerequisites were ready; this is not incident recovery time or an RTO measurement.

Verification compared each exported COPY column set and every row against the destination in memory, including migration history: **118 targets, 121 rows**, with exact sorted COPY-content parity. It checked **124 application foreign keys**, finding no orphan rows, and confirmed 102 migrations through `20261009025836`, 82 application tables, no anonymous/authenticated usage of the private schema and no public tables with RLS disabled. No cron jobs or Vault secrets were restored. Private artifacts include `restore.mjs`, `platform-baseline.sql`, logs and `restore-verification.json` beside the encrypted export; SQL data was never written back to a plaintext file.

The snapshot contains no Auth users, requests, booking attempts, reservations, booking deliveries, conversation scopes or OAuth grants. Therefore this drill cannot demonstrate recovery of those populated states, encrypted Calendar credentials, session revocation or provider uncertainty. The required synthetic application recovery scenarios below, independent key custody and off-site storage remain open. The manifest distinguishes SQL restoration from complete application recovery.

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

Deployment rollback is a separate operation: promoting an older compatible application does not restore database data or reverse provider actions. Keep migrations as immutable history and verify that the selected application understands the restored schema/state.

## Remaining release decisions

| Requirement | Current evidence / missing result |
|---|---|
| Available platform restore points | The selected project's observed list is empty; PITR is disabled. |
| Export preservation | See the dated evidence ledger for completed local exports and encryption verification. This is not off-site durability. |
| Restore rehearsal | Isolated SQL/content/integrity drill passed as described above. Populated application recovery, credentials, uncertainty and provider reconciliation remain unverified. |
| Data-loss and recovery-time objectives | Numeric objectives and measurements remain to be selected and verified before launch. |
| Retention and deletion | Backup retention, deletion propagation and application data policy remain unresolved product/operations decisions. |
| Operational ownership | A named primary/backup operator, incident contact and key custodian remain to be designated. |
| Independent storage and key custody | Off-site location, access control and recovery of the encryption key remain to be configured and tested. |

Do not close the Phase 9 backup/recovery gate until these decisions and an isolated restore rehearsal have direct evidence.
