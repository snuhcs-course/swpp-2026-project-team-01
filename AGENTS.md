# Agent guidance

This repository is the SNU SWPP Project Team 01 workspace. Keep changes small, reviewable, and aligned with the team's agreed requirements.

## Repository layout

- `apps/`: application code. Add app-specific setup and test instructions when an app is created.
- `documentations/`: project documentation.
- `supabase/`: local Supabase configuration and future database migrations.

## Tooling prerequisites

Assume the GitHub CLI (`gh`), Vercel CLI (`vercel`), and Supabase CLI (`supabase`) are installed and available on `PATH`.

Use Supabase CLI **2.119.0** for this repository and confirm it with `supabase --version`. Coordinate CLI upgrades across the team and recheck the schema workflow when upgrading.

## Working agreements

- Read the relevant files before editing and avoid guessing the product architecture or dependencies.
- Keep secrets, credentials, and local environment files out of Git. Add examples when configuration needs to be shared.
- Run the relevant checks for files you change, and report any checks that cannot run.
- Update documentation when setup steps or behavior change.

## Shared skills

Project skills live in `.agents/skills/`. Read the matching `SKILL.md` before working in its area:

- `supabase`: Supabase CLI, Auth, database, Storage, Realtime, and Edge Functions.
- `supabase-postgres-best-practices`: Postgres schema, queries, indexes, and RLS.
- `shadcn`: shadcn/ui components and configuration, if the team adopts shadcn/ui.

## Supabase schema changes

This repository uses **pg-delta**, enabled by `[experimental.pgdelta]` in `supabase/config.toml`. Keep the desired schema in `supabase/schemas/` and commit generated migrations in `supabase/migrations/`.

1. For the first schema change, create SQL files under `supabase/schemas/`. Edit these files for tables, RLS policies, grants, functions, and triggers. pg-delta orders dependencies automatically; do not configure `[db.migrations].schema_paths`.
2. Generate a migration without applying it: `supabase db schema declarative sync --name <short_snake_case_name> --no-apply`. The local stack does not need to be stopped. This compares declarative files against migration history; direct changes in Studio or the SQL editor are not captured. `supabase db diff` compares live database state and does not read declarative files.
3. Review every generated SQL file in `supabase/migrations/`, including operation order, grants, and destructive changes. pg-delta remains pre-1.0. Keep data backfills and unsupported schema changes in separate versioned migrations created with `supabase migration new <name>`; keep seed data in seed files.
4. Run `supabase start`, then `supabase db reset --local` to verify that the full migration chain rebuilds the disposable local database. Reset deletes local data. Run relevant app and database tests when schema behavior changes.
5. Commit the schema files, generated migration, and any `config.toml` change together. Treat existing migrations as history; make a new migration for later changes.

Only deploy migrations to a remote Supabase project after the team has linked and identified the intended environment. Review the pending migrations with `supabase db push --dry-run` before `supabase db push`.

References: [Diff engines](https://supabase.com/docs/guides/local-development/diff-engines) and [Declarative database schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas).
