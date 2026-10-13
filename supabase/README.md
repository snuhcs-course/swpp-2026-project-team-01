# Supabase reconstruction status

The selected reconstruction project is **`anelszynxtvxoxqvzgqt`** (**FindMeATime**, `us-east-2`), linked with Supabase CLI **2.119.0**. Link metadata is ignored by Git.

On 2026-10-13 the user explicitly requested a remote application schema reset after inspection. The reset removed the `fmat` schema and its data, the public application RPC, legacy queue/archive, four application cron jobs and seven migration records. Fresh queries and CLI listing verify zero application objects/jobs/queues/migrations. The fresh recheck confirms zero application relations/functions/types, zero migrations and zero jobs/queues. Supabase-managed schemas/data remain: one Google Auth identity, unchanged empty Storage and two unread Vault secrets.

Private ignored exports/checksums are retained under `.local/reconstruction-reset/2026-10-13-anelszynxtvxoxqvzgqt/`; do not commit or publish them. The pre-removal source at Git commit `02e5a8e` and these backups are historical recovery material, not a migration backlog to replay.

Application source, desired SQL, migrations and tests are still absent locally. No replacement code or migrations were started. Migration/seed execution remains disabled in `config.toml`, while pg-delta stays configured. The selected project's application baseline is verified empty; introduce a reviewed new desired schema/migration chain only after a new explicit implementation request, following [agent guidance](../AGENTS.md#supabase-schema-changes).

See [the clean-project recheck](../documentations/technical_specification/03_provider_setup.md#clean-project-recheck--2026-10-13). Existing public default grants require explicit review/restriction and RLS in the first schema slice. The local config is not a hosted Auth configuration export, and its project ID does not replace the ignored hosted CLI link. Verify matching application credentials, hosted Google-only login/callbacks and external consumer ownership before new remote schema/API activation or live effects.
