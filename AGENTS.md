# Agent guidance

This repository is the SNU SWPP Project Team 01 workspace. Keep changes small, reviewable, and aligned with the team's agreed requirements.

## Repository layout

- `apps/`: application code. Add app-specific setup and test instructions when an app is created.
- `documentaions/`: project documentation. Keep this directory name as written until the team agrees to rename it.
- `supabase/`: local Supabase configuration and future database migrations.

## Working agreements

- Read the relevant files before editing and avoid guessing the product architecture or dependencies.
- Keep secrets, credentials, and local environment files out of Git. Add examples when configuration needs to be shared.
- Put database schema changes in versioned migrations under `supabase/migrations/` once database work begins.
- Run the relevant checks for files you change, and report any checks that cannot run.
- Update documentation when setup steps or behavior change.
