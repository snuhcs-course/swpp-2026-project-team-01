# Agent guidance

This repository is the SNU SWPP Project Team 01 workspace. Keep changes small, reviewable, and aligned with the team's agreed requirements.

## Repository layout

- `apps/`: application code. Add app-specific setup and test instructions when an app is created.
- `documentations/`: product direction, release scope, research, and explanatory documentation, starting with `01_one_pager.md`.
- `openspec/specs/`: main capability specifications, with detailed behavior in `<capability>/spec.md`.
- `openspec/changes/`: proposed behavior changes and archived implementation records.
- `supabase/`: local Supabase configuration and future database migrations.

## Tooling prerequisites

Assume the GitHub CLI (`gh`), Vercel CLI (`vercel`), and Supabase CLI (`supabase`) are installed and available on `PATH`.

Use Supabase CLI **2.119.0** for this repository and confirm it with `supabase --version`. Coordinate CLI upgrades across the team and recheck the schema workflow when upgrading.

Use OpenSpec CLI **1.14.0** with the core profile and Codex integration. Install it with `brew install openspec` (macOS) or `npm install -g @fission-ai/openspec@1.14.0` (Node.js 20.19.0+), then verify with `openspec --version`. Initialize a fresh checkout with `openspec init --tools codex --profile core`. After a coordinated CLI upgrade, run `openspec update` in this repository and review the generated skill changes.

## Domain and DNS

The product is **Find Me a Time**, and its purchased domain is **findmeatime.com**. Cloudflare is the registrar and authoritative DNS provider. Keep Cloudflare nameservers while the domain is registered there; app hosting can use Vercel independently.

Use the official Cloudflare CLI, `cf` (also available as `cloudflare`), for DNS management. The verified version is **1.0.0-beta.12**. Install with `npm install --global cf@1.0.0-beta.12` using Node.js 22.18+, and check with `cf --version`. Since the CLI is in beta, verify command syntax after upgrades.

- Authenticate with `cf auth login`, then verify with `cf auth whoami`. For non-interactive automation, use `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; scope the token to the required account, zone, and permissions. Keep tokens, local authentication files, and `.cloudflare/` CLI caches out of Git.
- Discover commands with `cf cli search "create a DNS record"`, using only the action and resource type in search queries. Inspect the selected command's `--help` or `cf schema` output for arguments and request fields.
- Inspect the zone with `cf zones list --name findmeatime.com` and existing records with `cf dns records list --zone findmeatime.com`. Retrieve account and zone IDs from the authenticated account rather than guessing them.
- Create records with `cf dns records create --zone findmeatime.com --body '<JSON>'`. Preview changes with `--dry-run`, using the actual zone ID instead of the domain name because dry runs do not resolve names. Preserve unrelated records, including email and verification records. Re-read records after a change to verify the resulting state.

For Vercel deployments:

1. Identify the intended Vercel team and project, then attach the domain with `vercel domains add findmeatime.com <project-name>` in that scope.
2. Run `vercel domains inspect findmeatime.com` to obtain the exact required DNS records. Use its current values rather than copying generic IP addresses or CNAME targets.
3. Apply those records through `cf`, with `proxied: false` for Vercel web records (DNS only). `vercel dns` does not manage records hosted on Cloudflare nameservers.
4. Verify with `vercel domains inspect findmeatime.com`, DNS lookup, and an HTTPS request to the expected deployment. An active Cloudflare zone alone does not establish that the app is connected.

References: [Cloudflare CLI setup](https://developers.cloudflare.com/cf/get-started/), [DNS management](https://developers.cloudflare.com/cf/get-started/resources/), and [Vercel custom domains](https://vercel.com/docs/domains/set-up-custom-domain).

## Working agreements

- Read the relevant files before editing and avoid guessing the product architecture or dependencies.
- Keep secrets, credentials, and local environment files out of Git. Add examples when configuration needs to be shared.
- Run the relevant checks for files you change, and report any checks that cannot run.
- Update documentation when setup steps or behavior change.

## Documentation and specifications

Keep the documents complementary rather than duplicating the same requirements:

- `documentations/` owns product purpose, audience, release scope, research, and explanations such as architecture overviews. The one-pager and PRD describe product intent; link to capability specs for detailed behavior.
- `openspec/specs/<capability>/spec.md` owns the current agreed behavioral contract for that capability, including requirements and observable scenarios. Keep it aligned with completed, verified changes.
- `openspec/changes/<change-name>/` owns proposed deltas, their rationale, technical decisions when needed, and implementation tasks. Pending requirements stay here until the change is completed and archived into the main specs.

Use OpenSpec for substantial feature or behavior changes. Routine documentation edits, maintenance, and small fixes that preserve existing behavior do not need a new proposal. Start with a bounded change, review its requirements, implement and test it, then archive it to update the main specs. Do not promote unresolved PRD decisions or draft requirements into settled specifications.

If product documents and capability specs disagree, resolve the discrepancy explicitly before implementing the affected behavior. Update the owning document and its links instead of silently choosing one interpretation or maintaining conflicting copies.

OpenSpec validation checks artifact structure and specification consistency; it does not prove the implementation works. Run relevant automated tests and review the code before treating a change as complete. Keep `openspec/config.yaml`, specifications, change artifacts, and generated project skills in Git.

Reference: [OpenSpec quickstart](https://openspec.dev/docs/quickstart).

## Commit messages

Use Conventional Commit types with the Lore Commit Protocol. Start every commit message with `type(scope): intent`; the scope is optional. Keep the intent concise, use an imperative verb, and explain why the change is needed.

Types:

- `feat`: new functionality.
- `fix`: bug correction.
- `docs`: documentation.
- `refactor`: code restructuring without behavior changes.
- `test`: tests.
- `build`: dependencies or build tooling.
- `ci`: CI configuration.
- `chore`: other maintenance.
- `perf`: performance improvements.
- `revert`: reversing a commit.

Use a short scope naming the affected area, such as `supabase`, `product`, or `git`. Example: `docs(supabase): align schema guidance with pg-delta`.

Add an optional body for rationale and git-native Lore trailers when they provide decision context:

```text
Constraint: <external constraint that shaped the decision>
Rejected: <alternative considered> | <reason for rejection>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <forward-looking warning for future modifiers>
Tested: <what was verified>
Not-tested: <known gaps in verification>
```

Use `Rejected:` to record alternatives future modifiers should not revisit and `Directive:` for warnings. Include only trailers that add useful context.

## Shared skills

Project skills live in `.agents/skills/`. Read the matching `SKILL.md` before working in its area:

- `supabase`: Supabase CLI, Auth, database, Storage, Realtime, and Edge Functions.
- `supabase-postgres-best-practices`: Postgres schema, queries, indexes, and RLS.
- `shadcn`: shadcn/ui components and configuration, if the team adopts shadcn/ui.
- `openspec-*`: generated core workflows for exploring, proposing, applying, and archiving behavior changes.

## Supabase schema changes

This repository uses **pg-delta**, enabled by `[experimental.pgdelta]` in `supabase/config.toml`. Keep the desired schema in `supabase/schemas/` and commit generated migrations in `supabase/migrations/`.

1. For the first schema change, create SQL files under `supabase/schemas/`. Edit these files for tables, RLS policies, grants, functions, and triggers. pg-delta orders dependencies automatically; do not configure `[db.migrations].schema_paths`.
2. Generate a migration without applying it: `supabase db schema declarative sync --name <short_snake_case_name> --no-apply`. The local stack does not need to be stopped. This compares declarative files against migration history; direct changes in Studio or the SQL editor are not captured. `supabase db diff` compares live database state and does not read declarative files.
3. Review every generated SQL file in `supabase/migrations/`, including operation order, grants, and destructive changes. pg-delta remains pre-1.0. Keep data backfills and unsupported schema changes in separate versioned migrations created with `supabase migration new <name>`; keep seed data in seed files.
4. Run `supabase start`, then `supabase db reset --local` to verify that the full migration chain rebuilds the disposable local database. Reset deletes local data. Run relevant app and database tests when schema behavior changes.
5. Commit the schema files, generated migration, and any `config.toml` change together. Treat existing migrations as history; make a new migration for later changes.

Only deploy migrations to a remote Supabase project after the team has linked and identified the intended environment. Review the pending migrations with `supabase db push --dry-run` before `supabase db push`.

References: [Diff engines](https://supabase.com/docs/guides/local-development/diff-engines) and [Declarative database schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas).
