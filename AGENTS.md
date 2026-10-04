# Agent guidance

This repository is the SNU SWPP Project Team 01 workspace. Keep changes small, reviewable, and aligned with the team's agreed requirements.

## Repository layout

- `apps/`: application code. Add app-specific setup and test instructions when an app is created.
- `documentaions/`: project documentation. Keep this directory name as written until the team agrees to rename it.
- `supabase/`: local Supabase configuration and future database migrations.

## Tooling prerequisites

Assume the GitHub CLI (`gh`), Vercel CLI (`vercel`), and Supabase CLI (`supabase`) are installed and available on `PATH`.

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

This repository enables Supabase CLI's `pg-delta` engine in `[experimental.pgdelta]` in `supabase/config.toml`. Use declarative schemas in `supabase/schemas/` (the default `pgdelta` schema directory) as the source of truth and commit generated migrations in `supabase/migrations/`. The legacy `[db.migrations].schema_paths` setting is not used by `pg-delta`.

1. Edit declarative SQL files in `supabase/schemas/` rather than changing the database directly in Studio or the SQL editor. Include tables, RLS policies, grants, functions, and triggers. The CLI resolves object dependencies when generating the schema diff.
2. Generate a migration from the declarative schema files with `supabase db schema declarative sync`. Do not stop the local stack or use `supabase db diff` for this workflow; `db diff` compares a live database with migration history and does not use the declarative schema files as its baseline.
3. Review the generated SQL in `supabase/migrations/`. Check the operations and their order; do not assume the diff is correct. Keep data backfills and other data changes separate from declarative schema files.
4. Run `supabase db reset` to verify that the migrations rebuild the local database. Run relevant app tests when schema behavior affects an app.
5. Commit the schema files and generated migration together. Treat existing migrations as history; make a new migration for later changes.

Only deploy migrations to a remote Supabase project after the team has linked and identified the intended environment. Review the pending migrations with `supabase db push --dry-run` before `supabase db push`.
