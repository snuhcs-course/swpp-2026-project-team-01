# Design

## Context

Every earlier change left its operational edges visible rather than hidden: jobs keep their outcome or failure category when they finish or exhaust ([durable jobs](../../specs/durable-jobs/spec.md)); a booking whose dispatch may have reached Google stays `dispatching` and holds its reservation until reconciliation knows ([`host-review-and-booking` design](../host-review-and-booking/design.md)); every outbox records `uncertain` instead of sending twice. Nothing yet reads those edges for the team, and the only operator commands are host suspension and the AgentMail receiver. This change adds the operator's view and recovery, the data rules the PRD requires before real users, and the release environment.

The administrator CLI (`lib/server/operator.ts`, run as `npm run admin`) is the operator surface: it names exactly one environment (`--local` with a local-stack `DATABASE_URL`, or `--project <ref>` with the operator's own `SUPABASE_ACCESS_TOKEN` through the Management API), validates every input before building SQL, and changes state only through `app.operator_*` functions whose execution is revoked from every Data API role. The new commands follow the same shape.

## Goals / Non-Goals

Goals: a redacted snapshot and rejection counts an operator can read daily; bounded, audited recovery that never weakens the duplicate-prevention contracts; a restore drill that proves a backup can be read back; retention, deletion and a public notice that match what the code does; a release environment the team can promote into; targets the team can be measured against.

Non-goals: dashboards, alerting, a metrics command (D2's queries are documented, not packaged), deleting provider-side copies, and every step that needs a provider console or touches a shared or release project. Those are listed as blocked on the user.

## Decisions

### 1. Measurement

PRD section 2 names five measures and leaves the window and the numbers open. The window (D1) is eight weeks from the day the first host outside the team is admitted to the release environment, reported weekly by the operator on rotation: earlier data comes from teammates and synthetic tests and says nothing about the measures. The targets (D2) are deliberately modest for a first release with few hosts:

| Measure | Query basis | Target |
|---|---|---|
| Host actions per booked request | Host commands recorded in `command_outcomes` for the request's resource, split into the approval and everything else | Median at most 2 |
| Requests that reach booking | Identified requests created in the window, by final state (`booked`, `declined`, `withdrawn`, `expired`) and failed bookings | At least 50 % booked |
| Submission to booking | `requests.created_at` to `bookings.confirmed_at`, with time awaiting the host (from the agreement to the approval) reported apart | Median at most 24 h, p90 at most 72 h |
| Infeasible offers | Stored evaluations whose offered candidates fail a code-checked constraint when evaluated again at their own evaluation time | 0 |
| Trust | Bookings without a current approval, two live bookings for one request, disclosure reports | 0 |

`command_outcomes` is kept 30 days (section 8), so the weekly report reads it within its retention. A conversion or speed miss opens a review of the flow; the trust measures are release blockers, as the PRD already says. Rejected: a fixed calendar quarter, which starts before anyone outside the team uses the product; targets copied from scheduling products with years of tuning.

### 2. Ownership

D3. A four-person team cannot staff on-call; it can staff one operator per week. The operator reads `diagnostics snapshot` and `diagnostics rejections` every working day, answers support within two working days, runs recoveries and deletions with their own Supabase access token (so the Management API's audit names them, and the CLI's `--operator` names them in our audit), and records anything unusual in the team channel. The repository owner keeps the steps that change shared infrastructure: production deploys, release migrations, DNS, provider consoles and secrets. Support reaches the team through `support@findmeatime.com`, an Email Routing alias on the zone's existing Cloudflare MX records forwarding to the operator; creating it is a console step, so the notice names the address and the alias is listed as blocked. Rejected: a shared personal inbox, which hides who answered; GitHub issues, which requesters cannot be expected to use.

### 3. Performance targets

D4. The targets cover what a person waits for and what the team can measure today. `scripts/perf-check.ts` (`npm run perf:check -- --origin <url> [--handle <handle>] [--samples 20]`) sends sequential `GET` requests to `/`, `/SKILL.md`, `/llms.txt`, `/eve/v1/health` and, with `--handle`, the host page, times each to its response headers, and reports p50 and p95 per route against p50 at most 800 ms and p95 at most 2,000 ms, exiting non-zero on a miss. Sequential requests from one machine include cold starts and the network, so the bounds are loose on purpose; a regression shows as a miss. Two targets have no tool yet: approval to confirmed booking within 2 minutes at p95 (bounded by the every-minute sweep and the 8-attempt booking job) and a guest's first streamed event within 10 seconds at p95. The check reports them as not measured rather than as passing. Rejected: synthetic load tests, which would spend the model budget and say little at this scale.

### 4. The snapshot

D5. `app.operator_diagnostics_snapshot(sample_limit)` returns one JSON object: `version` 1, `observedAt` (the database's `now()`), and ten categories in a fixed order, each `{ name, count, oldestAt, sample }`, where `sample` is at most `sample_limit` (1 to 20, default 20) identifiers ordered by the category's timestamp and then the identifier, so the sample is deterministic and the count covers every match:

| Category | Matches | Timestamp |
|---|---|---|
| `jobs_exhausted` | jobs in `exhausted` | `updated_at` |
| `jobs_lease_expired` | jobs `running` with an expired lease | `lease_expires_at` |
| `jobs_overdue` | jobs `pending` more than 5 minutes past `run_after` | `run_after` |
| `bookings_uncertain` | bookings `dispatching` (write may exist, reservation held) | `dispatched_at` |
| `bookings_reserved_stale` | bookings `reserved` for more than 15 minutes | `created_at` |
| `email_deliveries_uncertain` | transactional emails recorded `uncertain` | `completed_at` |
| `email_replies_uncertain` | thread replies recorded `uncertain` | `completed_at` |
| `imessage_uncertain` | iMessage sends recorded `uncertain` or `failed` | `completed_at` |
| `sessions_failed` | conversation sessions `failed` and not yet recovered | `updated_at` |
| `inputs_unanswered` | conversation inputs not `completed` 10 minutes after acceptance | `accepted_at` |

The object also lists `notMeasured`: authorization denials and stale actions (reported by `diagnostics rejections`, best effort), provider readiness, and recipient delivery. Only identifiers, counts and timestamps leave the database: no payload, recipient, provider reference, message text or failure text, and the CLI prints the sample identifiers as they are. The function only reads; an expired lease is reported, never cleared (claiming does that), and an empty snapshot is labeled "no matching records" rather than healthy. Rejected: per-kind breakdowns of jobs, which would let the sample size grow with the number of kinds; reading provider state, which the snapshot must not treat as evidence.

### 5. Rejection observations

D6. The application's denials and stale actions are command failures, so collection runs where every interface's mutation already passes: `runCommand`'s failure path. `unauthenticated` and `forbidden` count as `authorization_denied`; `stale_revision` and `request_closed` as `stale_action`. Every other category, and every success, records nothing. When `DIAGNOSTICS_REJECTIONS` is `1`, the pipeline calls `app.record_rejection(category)` on the pool, outside the rolled-back command transaction, and waits at most 500 ms for it; a timeout, a storage error or a disabled setting is swallowed, never retried and never changes the command's own failure. The function takes the bucket of the current UTC hour, increments it atomically with `insert … on conflict do update`, caps it at 10,000 with a `saturated` flag, and deletes buckets older than the preceding 23 hours in the same statement. Only the category and the hour are stored.

`app.operator_rejection_snapshot()` returns the 24 buckets per category (zero-filled), their totals and saturation, the window's start, the observation time, and the coverage limits: only failures that reached the command pipeline count (denials before it, such as a raw runtime route's `401`, do not), the current hour is partial, and collection may have been off. Rejected: counting in the web service's memory, which a serverless instance loses; recording the operation or the actor, which the spec excludes.

### 6. Recovery

D7. Recovery may restart work the system already knows how to finish safely; it never decides an outcome itself.

- `recover job --job <id> [--attempts <n>]` accepts only an exhausted job. `app.operator_requeue_job` locks it, sets it `pending` and due now, grants `n` (1 to 10, default 3) attempts beyond those used, clears the failure category and records the audit row with the category it found, in one statement. The fence still rises on the next claim, so a late result from the attempt that exhausted it records nothing. Every handler is already safe to run again: a delivery found `dispatching` becomes `uncertain` and is never sent, and a booking found `dispatching` is reconciled.
- `recover booking --booking <id>` accepts only a `dispatching` booking with no `pending` or `running` booking job. `app.operator_reconcile_booking` publishes one `booking` job for it, marked with the environment the target's worker claims (`production` for a project, `local` for the local stack), with the job's normal 8 attempts. The job reads the event by its fixed ID and either confirms the booking or inserts the same frozen payload, which Google refuses as a duplicate if the event exists. A party's **Check status** already does the same; the operator command exists for a booking nobody is looking at.
- Uncertain message sends stay uncertain. The email, thread-reply and iMessage contracts forbid a second send of a message that may have been delivered; the snapshot shows them, and the operator tells the person through support if needed.

Both commands print the environment and the action, then ask the operator to type the identifier unless `--yes` is given, as suspension does. The audit table `operator_operations` holds the operator, the action, the target's kind and ID, the state found, the reason and the environment; it has no foreign key, so deletion audits survive the deleted rows. Rejected: a command that marks an uncertain booking confirmed or failed by hand, which would let an operator claim an outcome Google has not shown.

### 7. Backup restoration

D8. A backup is only as good as a restore that has been tried. `scripts/restore-drill.ts` (`npm run restore:drill`) runs against the local stack's database container and touches no database that a service uses:

1. It creates the source database `fmat_drill_source` by restoring a schema-only dump of the local `postgres` database's `app`, `auth` and `supabase_migrations` schemas, then fills it with synthetic state from `scripts/fixtures/restore-drill.sql`: hosts with handles and settings, requests in every state, proposals, approvals, bookings in every state, jobs and outbox rows, all with `example.test` addresses and generated text.
2. It takes a logical backup with `pg_dump --format=custom` of the same schemas, the format Supabase's downloadable backups and `supabase db dump` restore from.
3. It restores the backup with `pg_restore` into a new, empty database `fmat_drill_restored`, which no service is configured to reach.
4. It compares the two databases table by table (row count and an ordered MD5 of every row), the migration history, and the validity of every foreign key and check constraint, and runs the diagnostics snapshot on the restored copy to show the functions work.
5. It drops both databases unless `--keep` is given, and prints a summary that holds counts and hashes only.

Restoring a hosted backup is an operator step: Supabase restores a daily backup or a point in time into the same project, or a backup file can be restored with `pg_restore` into a new project. The runbook in provider setup says to restore into a new project and compare there, never over a live project, and that real backups contain personal data and are not copied to a laptop. The drill runs before the release and after each change that adds migrations. Rejected: drilling with a copy of the shared project, which holds teammates' real calendar grants.

### 8. Retention

D9. The rules extend the ones earlier changes set (calendar analyses, sign-up and creation attempts 24 hours; drafts 24 hours; email and iMessage records 30 days; requester grants deleted at closure):

| Data | Kept until |
|---|---|
| A closed request and everything under it: intake, proposals, agreements, approvals, bookings, discussions and their stored events, booking link, outbox and delivery rows | 90 days after `closed_at` |
| Completed jobs | 30 days after completion |
| Exhausted jobs | 90 days after they exhausted, so a missed snapshot is still recoverable |
| Command outcomes (retry replay) | 30 days |
| Link-resend attempts and issuances, admission windows, agent protocol attempts | 30 days |
| Model reservations (spending accounting) | 90 days |
| Operator audit rows (`operator_actions`, `operator_operations`) | 1 year |
| Rejection observation buckets | 24 hours (section 5) |
| Host accounts, settings, handles and their grants | While the account exists; deletion on request (section 9) |

`app.cleanup_retained_records(row_limit)` deletes at most `row_limit` rows per rule in one pass and returns the count per rule, so a large backlog drains over several passes instead of holding locks. `pg_cron` runs it every hour at minute 17. Deleting a request cascades through the tables that reference it; the host's Google Calendar event, which belongs to the host's calendar, stays. The hosting runtime keeps its own copy of each conversation session on Vercel; the application cannot delete it, and the notice says so. Rejected: keeping closed requests for a year, which the scheduling purpose does not need; deleting at closure, which would break the 30-day booking-link receipt and the measurement window.

### 9. Deletion on request

D10. A person who asks the team to delete their data writes to support; the operator verifies the request comes from the account's own address and runs:

- `delete-host --host <handle-or-id> --reason <text>`: `app.operator_delete_host` locks the account, deletes every row of every table that references it except `host_handles` and `handle_assignments` (found from the catalog, so a later table is included automatically), deletes its Auth user, clears its display name, sets it `suspended` with `deleted_at`, and records the audit row. The handle history stays because a released handle must never be assigned to another host ([host admission](../../specs/host-admission/spec.md)); a handle string is the only thing kept, and `restore` refuses a deleted account. The same Google account signing in later creates a new, empty account.
- `delete-request --request <id> --reason <text>`: `app.operator_delete_request` deletes one request with everything under it. The operator finds the ID from the booking link the requester sends to support, by its hash.

Both need typed confirmation, refuse an unknown target, and write the audit row without the deleted content. Events already on a host's calendar and the copies held by email and iMessage providers are outside the database; the notice says so. Rejected: soft deletion with a flag, which keeps the data the person asked to remove.

### 10. AI-provider data handling

D11. The runtime calls OpenAI directly with the team's key, with `store: false` and the default service tier on every call (`agent/agent.ts`, `lib/server/model-limits.ts`). OpenAI's API terms exclude API data from training by default and allow OpenAI to keep abuse-monitoring logs for up to 30 days; the team has no zero-data-retention agreement and does not claim one. Only text the conversation's audience may see reaches the model: requester-visible projections for requesters, the host's own data for the host, with booking links and link codes redacted before any input. The notice states each of these.

### 11. Disclosures

D12. `/privacy` (page P11) is a static public page, server-rendered, with English and Korean selected by `?lang=ko` and a link to the other language. It covers: who runs the service and how to reach support; what is collected from hosts (Google identity, Calendar access and the settings they confirm), from requesters (name, email, the request, optional Calendar availability) and from everyone (conversation text, technical logs); why (scheduling the meeting the person asked for); the processors (Supabase, Vercel, OpenAI, Google, Cloudflare, AgentMail, Photon); retention as in section 8; deletion on request; and what the service never does (sell data, train models, show one party's calendar to the other). The page footer link appears on `/`, the public host page and the booking page, and the **Continue with Google** card adds one line, "How we use your calendar", linking to the page's Calendar section. The `privacy` handle is already reserved. Google's verification of the Calendar scopes requires a privacy policy on the home page's domain; `/privacy` serves that. Rejected: a consent checkbox, which the scheduling purpose does not need and which would add a step to intake.

### 12. Environments

D13. The release project `mriseqztcwmezvtawnbo` (FindMeATime2) was inspected read-only on 2026-10-23: it still holds the iteration-1 prototype (a `fmat` schema of 103 tables with 84 live rows, 143 migration records up to `20261011125843`, 2 Auth users, 5 Vault secrets and 17 `pg_cron` jobs running every minute or every 10 minutes). Emptying it is destructive and is left to the user; until then nothing is pushed there. The split, once it is emptied:

| Environment | Supabase | Vercel | Origins | Changed by |
|---|---|---|---|---|
| Release | `mriseqztcwmezvtawnbo` | `findmeatime-release`, Production | `findmeatime.com`, `release.findmeatime.com` | `Deploy release Supabase` workflow after approval; `vercel deploy --prod` by the repository owner |
| Staging | `anelszynxtvxoxqvzgqt` | `findmeatime-dev`, Production | `dev.findmeatime.com` | `Deploy shared Supabase` on merge to `main` |
| Preview | `anelszynxtvxoxqvzgqt` | Preview deployments | Vercel URLs | Pull requests |

`.github/workflows/deploy-release.yml` runs only by `workflow_dispatch` on `main`, in the GitHub environment `release` (whose required reviewers are a repository setting), refuses any ref other than `main`, prints the dry run, pushes the migrations, writes the worker's Vault entries and pushes the hosted configuration, with the release project's own secrets. It has never run.

D14. Staging's production deployment would pass today's messaging gate, which admits every Vercel production deployment. The gate now also requires that `APP_ORIGIN`, when set, is one of the release origins; a production deployment with another canonical origin is staging and is denied messaging before any network access, as a preview is. An unset `APP_ORIGIN` keeps today's behavior, so the release deployment needs no new variable. The job worker still runs on staging, so staging bookings write to the teammates' own calendars as they do now.

The root domain was attached to `findmeatime-release` on 2026-10-19 and verified again on 2026-10-23 (`vercel domains inspect`, DNS and HTTPS); the current production deployment predates Phase 6 and is served against the shared project, so the release split, the deploy of `main` and the migrations of Phases 6 and 7 are release steps for the user.

### 13. Testing

- Unit: argument parsing, SQL generation and output redaction of the new operator commands; rejection categorization and the bounded wait; the staging gate; the perf-check statistics.
- Integration (local stack): the snapshot's categories, counts, bounded deterministic samples and absence of private text; rejection collection under concurrency, saturation, pruning, disabled and failing storage; requeueing an exhausted job and reconciling an uncertain booking, including refusals and audit rows; retention by rule; host and request deletion, including the handle tombstone and the Auth user.
- pgTAP: the new tables and functions are unreachable from `anon` and `authenticated`.
- Browser: `/privacy` in both languages, and the links from the pages that carry it.
- The restore drill itself, recorded in the acceptance record with its summary.
