# Supabase

The shared project is **`anelszynxtvxoxqvzgqt`** (**FindMeATime**, `us-east-2`), linked with Supabase CLI **2.119.0**. Link metadata is ignored by Git. Teammates develop against personal projects and the shared project receives migrations only from CI; see [environments and collaboration](../documentations/technical_specification/03_provider_setup.md#environments-and-collaboration). It runs PostgreSQL 17 with Supabase-managed Auth, Storage, Vault, cron and queue infrastructure; the Phase 1 migrations were applied to it on 2026-10-19, once by hand as a recorded exception. See [provider setup](../documentations/technical_specification/03_provider_setup.md#supabase-project) for the observed state and prerequisites.

The local `config.toml` targets PostgreSQL major 17 with pg-delta enabled, migrations enabled and seeds disabled; its `project_id` identifies the disposable local stack, not the hosted project.

The desired schema lives under `schemas/` and the reviewed migration chain under `migrations/`, following [agent guidance](../AGENTS.md#supabase-schema-changes). The baseline declares the role matrix:

- Application objects live in the private `app` schema, owned by `postgres` and not exposed through the Data API. Every table there enables row-level security with no policies, so only the owner reads it.
- `anon` and `authenticated` have no default privileges on tables, sequences or functions that `postgres` creates in `public`, and no function created by `postgres` is executable by `PUBLIC`. `service_role` keeps the platform defaults in `public`.
- The global function revoke is a hand-written migration because pg-delta does not diff global default privileges; `schemas/_custom/default_privileges.sql` mirrors it so later syncs see the same state.

`tests/` proves the matrix with pgTAP: run `supabase start` and `supabase test db`. The `database` job in `.github/workflows/check.yml` runs the same commands on every push. Account for the preinstalled extensions and never edit managed schemas. Deploy to the hosted project only after `supabase db push --dry-run` review and explicit environment identification.
