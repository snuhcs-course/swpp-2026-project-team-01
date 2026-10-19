# Agent guidance

This repository is the SNU SWPP Project Team 01 workspace. Keep changes small, reviewable, and aligned with the team's agreed requirements.

## Project status

Implementation has started with the [`application-foundation`](openspec/changes/application-foundation/proposal.md) change, whose [design](openspec/changes/application-foundation/design.md) records the runtime stack. Phase 1 (sign-in, the `/app` workspace, the Supabase schema baseline and the platform mechanics) is implemented, deployed and recorded in the [acceptance record](documentations/technical_specification/07_acceptance_record.md); product features arrive with later changes. Implement only within an open OpenSpec change.

The shared Supabase project is `anelszynxtvxoxqvzgqt`; it holds the Phase 1 migrations, applied on 2026-10-19 (see [environments and collaboration](documentations/technical_specification/03_provider_setup.md#environments-and-collaboration)). Keep namespaces, default privileges and RLS as the schema baseline declares them, as described in [provider setup](documentations/technical_specification/03_provider_setup.md#supabase-project). Never push a migration chain onto a project whose state has not been checked.

## Repository layout

- `agent/`: the eve agent definition, instructions and channels. `agent/channels/eve.ts` authorizes every `/eve/v1` route through application code.
- `apps/web/`: the Next.js web app; `/` is the public entry and `/app` hosts the conversation.
- `lib/contracts/` and `lib/server/`: browser-safe contracts and server-only code shared by the agent and the web app.
- `tests/integration/` and `tests/e2e/`: Vitest integration tests and Playwright browser tests. Unit tests live beside their modules.
- `documentations/`: product direction, release scope, research, and explanatory documentation, starting with `01_one_pager.md`.
- `openspec/specs/`: main capability specifications, with detailed behavior in `<capability>/spec.md`.
- `openspec/changes/`: proposed behavior changes and archived implementation records.
- `supabase/`: local Supabase configuration and future database migrations.

## Tooling prerequisites

Use Node.js 24 and npm. Install with `npm ci`, then run the checks CI runs:

```sh
npm run build        # eve build, then next build for apps/web
npm run lint         # oxlint agent apps lib tests
npm run typecheck
npm test             # Vitest unit tests
```

`npm run test:integration` runs Vitest integration tests one file at a time against the local stack (`supabase start`); some start `eve dev` or `eve build` plus `eve start` with a local OpenAI stand-in. `npm run test:e2e` runs Playwright against `next dev`, `eve dev` and the same stand-in on ports 3100 to 3102, all pointed at the local stack (install a browser once with `npx playwright install chromium`); tests sign in through the real local Auth flow, never a bypass route. Set `E2E_LIVE_MODEL=1` on `npm run test:e2e` to run only the sign-in-to-first-reply journey against the real `gpt-5.6-terra` with `OPENAI_API_KEY`; it spends money, so CI never sets it. For local development, fill `.env` from `.env.example`, put local overrides such as the local stack's values in `.env.local`, and run `npm run dev`: it starts the web service on port 3000 and `eve dev` on port 2000, both from the root env files (the process environment wins, then `.env.development.local`, `.env.local`, `.env.development` and `.env`, as eve and Next.js order them), and refuses the shared and release projects. `npm run dev:web` runs only the web service with the same environment; `npm run dev:eve` runs the agent with its terminal UI. Run `npm run jobs:dev` to process locally produced jobs against `DATABASE_URL`; it refuses the shared and release projects.

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
- Lean on the reference repositories. Before designing or implementing a module, read how the [reference repositories](documentations/technical_specification/02_frontend_architecture.md#reference-repositories) structure, style and test the same thing, and follow their architecture and design wherever our contracts do not say otherwise. Name the repository and revision you followed in the pull request.
- Keep secrets, credentials, and local environment files out of Git. Add examples when configuration needs to be shared.
- Run the relevant checks for files you change, and report any checks that cannot run.
- For every feature change, check whether product, UX, technical, setup, or API documentation needs updating. Update the owning documents in the same change when behavior or setup changes; if no update is needed, say why in the final report.

## Documentation and specifications

Keep the documents complementary rather than duplicating the same requirements:

- `documentations/` owns product purpose, audience, release scope, research, and explanations such as architecture overviews. The one-pager and PRD describe product intent; link to capability specs for detailed behavior.
- `openspec/specs/<capability>/spec.md` owns the current agreed behavioral contract for that capability, including requirements and observable scenarios. Keep it aligned with completed, verified changes.
- `openspec/changes/<change-name>/` owns proposed deltas, their rationale, technical decisions when needed, and implementation tasks. Pending requirements stay here until the change is completed and archived into the main specs.

Use OpenSpec for substantial feature or behavior changes. Routine documentation edits, maintenance, and small fixes that preserve existing behavior do not need a new proposal. Start with a bounded change, review its requirements, implement and test it, then archive it to update the main specs. Do not promote unresolved PRD decisions or draft requirements into settled specifications.

If product documents and capability specs disagree, resolve the discrepancy explicitly before implementing the affected behavior. Update the owning document and its links instead of silently choosing one interpretation or maintaining conflicting copies.

OpenSpec validation checks artifact structure and specification consistency; it does not prove the implementation works. Run relevant automated tests and review the code before treating a change as complete. Keep `openspec/config.yaml`, specifications, change artifacts, and generated project skills in Git.

Reference: [OpenSpec quickstart](https://openspec.dev/docs/quickstart).

## Korean translations

`ko/` mirrors the English documents as review translations for the team; the English documents are authoritative. Do not read, search or quote `ko/` unless the user asks for a translation or names a Korean file. The root `.ignore` hides `ko/` from ripgrep-based search, and the project settings ask before a file under `ko/` is read. When an English document changes, regenerate its Korean mirror from the English source instead of editing the Korean file by hand, keep the first-line banner that names the source, and keep headings, tables, links and Mermaid blocks structurally identical.

## Git branch conventions

- `main` is the integration branch. Use a topic branch and a pull request for changes; do not commit directly to `main`.
- Name new branches `<type>/<short-description>`, using the commit types below and lowercase letters, digits, and hyphens within each segment. Examples: `fix/booking-timezone` and `docs/branch-conventions`. Do not use the `codex/` prefix. Follow an explicit user-provided branch name when given.
- Keep each branch focused on one feature, fix, or documentation task. When implementing an OpenSpec change, reuse its change name as the description where practical, such as `feat/connect-google-calendars`.
- Start new, independent work from the latest `origin/main` after fetching. Continue an existing task on its existing branch; use another base only when the task explicitly depends on it.
- Inspect the current branch and working tree before switching or creating branches. Preserve unrelated local changes; use a separate worktree when isolation is needed. Do not rename an existing branch just to match this convention.
- Keep shared branch history intact. Do not force-push or rebase a shared branch without explicit authorization.
- Delete a topic branch after its pull request is merged and its work is no longer needed. Do not delete branches with unmerged work or active worktrees.

## Git workflow and pull requests

The four-person team uses GitHub Flow: `main` -> short-lived working branch -> pull request -> review and checks -> merge -> branch deletion. Keep `main` ready to deploy as application code is added; use working branches for incomplete work.

- Create each working branch from the latest `main` and give it one bounded purpose, named as described in the branch conventions above.
- Keep PRs small and separate unrelated changes. Describe the resulting behavior, rationale, and validation, including any checks that could not run. Reflect new changes on `main` regularly and resolve conflicts before merging.
- All changes to `main` go through a PR. Require approval from at least one teammate other than the author and passing relevant CI checks before merging. Until relevant CI exists, run the applicable local checks and record the results and gaps in the PR.
- Configure GitHub branch protection or rulesets to enforce the review and required checks on `main`.
- Use **Squash and merge** by default so each PR becomes one logical commit on `main`. Use the commit-message format below for the PR title and final squash message, and preserve useful Lore decision context in the final message.
- Use **Rebase and merge** as an exception when the PR's individual commits are already meaningful, independently reviewable, and worth retaining. Ordinary PRs do not need merge commits.
- Delete the working branch after merging and start the next task from the latest `main`, especially after a squash merge. Coordinate with teammates before rewriting history on shared branches.

Use this workflow without a permanent `develop` branch. Reconsider Git Flow or release branches if the project needs concurrent supported versions or a separate release-stabilization period.

References: [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) and [PR merge methods](https://docs.github.com/en/pull-requests/reference/pull-request-merges).

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

## AI usage records

Each task is one branch, and each task reports the Claude Code and Codex tokens and agent working time spent on it.

- One-time setup per clone: `git config core.hooksPath .githooks`. The pre-commit hook then runs `node scripts/ai-usage.mjs record --stage` on every commit, which reads the local Claude Code and Codex logs (CLI and desktop app) and updates `ai-usage/<branch>/<git user.email>.json`. It stores token counts and agent time only, never prompts.
- Usage is attributed by the working directory and by which branch that worktree had checked out at the time, so run agents inside the repository (or its worktrees). Start every new task's session on its own new branch: a session opened on another task's branch or worktree is counted toward that task. When working on several tasks in parallel, create the branch and worktree first (`git worktree add -b feat/new ../new`) and start the session there. The post-checkout hook logs every branch switch and `git worktree add` to `.git/ai-usage-branches.log`, so usage in worktrees that were later removed still counts; set up the hooks before creating task worktrees. Cloud sessions (Claude Code on the web, Codex cloud) leave no local logs and are not recorded.
- Usage after the last commit is picked up by the next commit. Commit once more before asking for review if agents ran since.
- Do not edit `ai-usage/` files by hand. `node scripts/ai-usage.mjs report [branch]` prints the table; the `AI usage` workflow posts it as a comment on each pull request.

## Shared skills

Project skills live in `.agents/skills/`. Read the matching `SKILL.md` before working in its area:

- `supabase`: Supabase CLI, Auth, database, Storage, Realtime, and Edge Functions. Start documentation lookups from the index at [supabase.com/llms.txt](https://supabase.com/llms.txt); each listed page can be fetched as Markdown.
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

Team environments: each teammate develops against their own personal Supabase project and local `eve dev`; the shared project `anelszynxtvxoxqvzgqt` receives migrations only from CI on merge to `main` and is never edited through Studio. Generating a migration needs Docker, so a teammate with Docker generates it inside the same pull request. See [environments and collaboration](documentations/technical_specification/03_provider_setup.md#environments-and-collaboration) for the full structure and the trigger for adding a release environment.

References: [Diff engines](https://supabase.com/docs/guides/local-development/diff-engines) and [Declarative database schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas).
