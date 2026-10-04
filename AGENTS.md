# Agent guidance

This repository is the SNU SWPP Project Team 01 workspace. Keep changes small, reviewable, and aligned with the team's agreed requirements.

## Repository layout

- `apps/`: application code. Add app-specific setup and test instructions when an app is created.
- `documentations/`: project documentation, starting with `0_one_pager.md`.
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

This repository currently uses the Supabase CLI's legacy `migra` diff engine (`supabase/config.toml` has no enabled `[experimental.pgdelta]` section). Keep the desired schema in `supabase/schemas/*.sql` and commit generated migrations in `supabase/migrations/`.

1. For the first schema change, create `supabase/schemas/` and set `[db.migrations].schema_paths = ["./schemas/*.sql"]` in `supabase/config.toml`. After that, edit the declarative SQL files rather than changing the database directly in Studio or the SQL editor. Include tables, RLS policies, grants, functions, and triggers in those files. Order files by dependency when necessary.
2. Stop the local stack before generating the migration: `supabase stop`, then `supabase db diff -f <short_snake_case_name>`.
3. Review the generated SQL in `supabase/migrations/`. Check the operations and their order; do not assume the diff is correct. Keep data backfills separate from declarative schema files.
4. Run `supabase start` and `supabase db reset` to verify that the migrations rebuild the local database. Run relevant app tests when schema behavior affects an app.
5. Commit the schema files, generated migration, and any `config.toml` change together. Treat existing migrations as history; make a new migration for later changes.

Only deploy migrations to a remote Supabase project after the team has linked and identified the intended environment. Review the pending migrations with `supabase db push --dry-run` before `supabase db push`.
