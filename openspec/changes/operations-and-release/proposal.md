# Proposal

## Why

Phases 1 to 7 built the product: host sign-in and setup, requester intake on the web and by email, host review on the web, by agent and by iMessage, and booking through Google Calendar. The [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-8--operations-and-release) makes Phase 8 the last change: the team must be able to run, inspect and recover the product, keep only the data it needs for as long as it needs it, say so to the people whose data it is, and release it on the root domain against a database of its own.

The main specifications already hold part of this. [Operational diagnostics](../../specs/operational-diagnostics/spec.md) requires a redacted, read-only operator snapshot and bounded rejection counts, but nothing implements it, and its rejection collection names "database RPC attempts" although the application's mutations run through the [command pipeline](../../specs/application-commands/spec.md), not database RPCs. No specification gives an operator a recovery action: an exhausted job stays exhausted, and a booking whose write is uncertain is reconciled only when a party checks its status. The [PRD](../../../documentations/02_product_requirements.md#8-privacy-security-and-reliability-requirements) requires retention, deletion, AI-provider data handling and consent disclosures "before launch to real users", and [section 10](../../../documentations/02_product_requirements.md#10-dependencies-and-open-decisions) leaves the measurement window, numerical targets, support and recovery ownership and performance targets open. [Provider setup](../../../documentations/technical_specification/03_provider_setup.md#environments-and-collaboration) reserves the release project `mriseqztcwmezvtawnbo` but has no promotion path into it.

## What Changes

- **Diagnostics (Lane A).** `npm run admin -- diagnostics snapshot` returns the operational-diagnostics snapshot: fixed signal categories (exhausted, lease-expired and overdue jobs; bookings whose write is uncertain and hold a reservation; uncertain or failed email, thread-reply and iMessage sends; failed conversation sessions; inputs accepted but not answered), each with a count, the oldest timestamp and at most twenty opaque identifiers, plus the coverage it does not measure. `diagnostics rejections` returns the hourly authorization-denial and stale-action counts that the command pipeline records when collection is enabled. Both are read-only and need the same explicit environment as every operator command.
- **Recovery (Lane A).** `recover job` gives an exhausted job a bounded number of new attempts; `recover booking` starts a reconciliation of a booking whose write is uncertain, which reads the event by its fixed ID before any insert. Neither resends an uncertain message, clears a reservation or approves anything. Every recovery is audited with its operator, reason, environment and the state it found.
- **Backup restoration (Lane B).** `npm run restore:drill` fills a disposable local database with synthetic state, takes a logical backup, restores it into a separate, isolated database and checks that the restored data, the migration history and the invariants match. The runbook covers restoring a hosted backup into a new project, which stays an operator step.
- **Retention and deletion (Lane B).** One maintenance function removes data past its retention: closed requests and everything under them 90 days after closure, finished jobs, command outcomes, resend and admission records after 30 days, model reservations after 90 days. `fmat-admin delete-host` and `delete-request` erase a host's or a request's data on request, audited.
- **Disclosures (Lane B).** A public `/privacy` page states what is collected, why, how long it is kept, which providers process it (OpenAI with storage off, Google, Supabase, Vercel, Cloudflare, AgentMail, Photon), how to ask for deletion and whom to contact. The landing page, the public host page, the booking page and the **Continue with Google** card link to it.
- **Environments (Lane C).** A manual `Deploy release Supabase` workflow, gated by a GitHub environment, promotes the reviewed migration chain into the release project after a dry run. A production deployment whose canonical origin is not a release origin is a staging deployment and is denied messaging, so the shared project can become staging without sending mail or iMessage. `npm run perf:check` measures the pre-release latency targets against an origin.
- **Acceptance record (Lane D).** The record gets a release summary of AC-01 to AC-28: where each scenario's evidence is, what kind it is, and what is still pending.

## Decisions

The plan assigns three decisions to Phase 8: the measurement window and numerical targets of PRD section 2, support and recovery ownership, and performance targets; section 7 adds retention and deletion. Designing them raised D5–D14. The implementing session took them on 2026-10-23 under the user's instruction to log every decision and keep it changeable; they are listed in the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-8--operations-and-release). None was reviewed by a teammate yet; the plan's **Teammate review** box covers them. The [design](design.md) records the reasoning and the rejected options.

| # | Decision | Choice |
|---|---|---|
| D1 | Measurement window ([design 1](design.md#1-measurement)) | Eight weeks from the day the first host outside the team is admitted to the release environment, reported weekly. Before that day nothing is measured against a target; the release gate stays PRD section 2's zero unauthorized bookings, duplicate events and disclosures in the acceptance suite |
| D2 | Numerical targets ([design 1](design.md#1-measurement)) | Host actions per booked request: median at most 2 (the approval and one other). Valid submitted requests reaching booking: at least 50 %. Submission to booking: median at most 24 hours, 90th percentile at most 72 hours. Offered candidates violating known constraints at evaluation time: 0 for code-checked constraints. Unauthorized bookings, duplicate events and disclosures: 0. Missing a conversion or speed target opens a review, not a rollback |
| D3 | Support and recovery ownership ([design 2](design.md#2-ownership)) | One operator on a weekly rotation among the four teammates reads the snapshot every working day, answers support within two working days and runs recoveries with their own Supabase token. The repository owner keeps production deploys, release migrations, DNS and provider consoles. Support reaches the team at `support@findmeatime.com`, a Cloudflare Email Routing alias still to be created |
| D4 | Performance targets ([design 3](design.md#3-performance-targets)) | Measured by `npm run perf:check` over 20 sequential requests per route from one machine: `/`, `/SKILL.md`, a host page and `/eve/v1/health` answer with p50 at most 800 ms and p95 at most 2,000 ms. A booking reaches confirmed within 2 minutes of approval at p95, and a guest's first streamed reply starts within 10 seconds at p95; these two are targets without a measuring tool yet and are reported as unmeasured |
| D5 | Snapshot categories ([design 4](design.md#4-the-snapshot)) | Ten fixed categories over jobs, bookings, the three outboxes, sessions and inputs, oldest first, at most 20 identifiers each; jobs report kind and failure category, never payloads. Authorization-denial and stale-action rates are reported by `diagnostics rejections`, and the snapshot labels them covered elsewhere |
| D6 | Rejection collection ([design 5](design.md#5-rejection-observations)) | Recorded by the command pipeline for `unauthenticated` and `forbidden` (authorization denial) and `stale_revision` and `request_closed` (stale action), when `DIAGNOSTICS_REJECTIONS=1`, on its own connection with a 500 ms bound, no retry, into 24 hourly buckets per category saturating at 10,000. The spec's "database RPC" wording becomes "application command" |
| D7 | Recovery operations ([design 6](design.md#6-recovery)) | `recover job` only for an exhausted job, granting at most 10 new attempts; `recover booking` only for a dispatching booking with no live job, publishing one reconciliation job. Uncertain message sends stay uncertain: the contracts forbid sending them again. Typed confirmation, audited in `operator_operations` |
| D8 | Backup restoration ([design 7](design.md#7-backup-restoration)) | A logical `pg_dump` of the application, Auth and migration-history schemas, restored with `pg_restore` into a separate database on the local stack, filled beforehand with synthetic state only; run before the release and after every phase that adds migrations. Real backups are restored only into a new project, never over a live one |
| D9 | Retention ([design 8](design.md#8-retention)) | Closed requests 90 days after closure, with their proposals, conversations and outbox rows; finished jobs, command outcomes, link-resend and admission records 30 days; exhausted jobs and model reservations 90 days; operator audit rows one year. Existing shorter rules stay. A maintenance pass runs hourly |
| D10 | Deletion on request ([design 9](design.md#9-deletion-on-request)) | `fmat-admin delete-host` removes a host's identity, grants, settings, requests, channel bindings and agent grants and its Auth user, keeping only a suspended, nameless account row with its handle history so a handle is never assigned to another host; `delete-request` removes one request by its ID. Both need a reason and typed confirmation and leave an audit row without the deleted data. Events already on Google calendars are not touched |
| D11 | AI-provider data handling ([design 10](design.md#10-ai-provider-data-handling)) | OpenAI is called directly with storage off; its API does not train on the data and may keep abuse-monitoring logs for up to 30 days. Only text the conversation's audience may see reaches the model. Zero data retention is not in place and is not claimed. The runtime's own session record on Vercel is not removed by the retention pass, and the notice says so |
| D12 | Consent disclosures ([design 11](design.md#11-disclosures)) | A public `/privacy` page in English and Korean, linked from `/`, the public host page, the booking page and the **Continue with Google** card; Google's consent screen and the PRD's scopes stay unchanged. No consent checkbox: the scheduling purpose is the basis, and the notice is shown before any data is given |
| D13 | Release environment split ([design 12](design.md#12-environments)) | Release: project `mriseqztcwmezvtawnbo` behind Vercel `findmeatime-release` on `findmeatime.com` and `release.findmeatime.com`. Staging: the shared project `anelszynxtvxoxqvzgqt` behind `findmeatime-dev` on `dev.findmeatime.com`. Release migrations go through a manual workflow with a GitHub environment approval and a dry run; production deploys stay `vercel deploy --prod` from a merged `main` revision by the repository owner |
| D14 | Staging messaging ([design 12](design.md#12-environments)) | A production deployment whose `APP_ORIGIN` is set and is not `https://findmeatime.com` or `https://release.findmeatime.com` is staging: messaging is refused there as on a preview. An unset `APP_ORIGIN` keeps today's behavior |

## Conflicts resolved here

| Conflict | Resolution |
|---|---|
| **RPC or command.** Operational diagnostics collects rejections from "database RPC attempts"; the application has no such RPCs, and its denials and stale actions are command failures | D6: collection runs in the command pipeline; the requirement's wording is modified accordingly |
| **Root-domain promotion.** The plan lists attaching `findmeatime.com` to the release project as Phase 8 work; it was attached on 2026-10-19 at the user's request, and production is a manual deploy of `findmeatime-release` | Lane C verifies the attachment instead of repeating it, and records that the current production deployment predates Phase 6 and still uses the shared project |
| **Who may message.** Messaging environments admits every production deployment; once the shared project becomes staging, the staging project's production deployment would be admitted too | D14 adds a staging denial by canonical origin |
| **Open PRD decisions.** PRD section 10 leaves retention, support ownership, performance and measurement open | D1–D4 and D9–D12; the PRD rows are updated |

## Capabilities

### New Capabilities

- `operational-recovery`: audited operator recovery of exhausted jobs and uncertain booking writes.
- `data-stewardship`: retention, deletion on request, backup restoration drills, AI-provider data handling and the public data notice.

### Modified Capabilities

- `operational-diagnostics`: rejection collection at the command pipeline (D6), and the snapshot's categories (D5).
- `messaging-environments`: staging production deployments are denied (D14).

This change also closes scenarios that the main specs already state, without changing their text:

| Specification | Closed in this change | Deferred, and where |
|---|---|---|
| [`operational-diagnostics`](../../specs/operational-diagnostics/spec.md) | Every scenario, against the local stack | The same commands against the release project: blocked on the split (below) |
| [`email-delivery`](../../specs/email-delivery/spec.md) | — | "Auth notifications through Cloudflare SMTP": the hosted SMTP setting is a console step, blocked on the user |

## Out of scope

- Creating Cloudflare, Google, Photon or AgentMail production configuration, emptying or linking the release project, setting repository secrets, DNS changes and production deploys. They are listed as blocked on the user in the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-8--operations-and-release), in release order.
- A metrics command for D2. The targets are defined with the queries that compute them; a command that prints them is a follow-up once data exists.
- Deleting provider-side copies (AgentMail threads, Photon conversations, OpenAI abuse logs). The notice states where they live.

## Impact

- New: `lib/server/diagnostics.ts`, `lib/server/recovery-operations.ts`, `lib/server/data-deletion.ts`, `scripts/restore-drill.ts`, `scripts/perf-check.ts`, `apps/web/app/privacy/`, `.github/workflows/deploy-release.yml`, the tables `rejection_observations` and `operator_operations`, operator functions, the retention function and its schedule, and one migration.
- Changed: `lib/server/operator.ts` (new commands), `lib/server/commands.ts` (rejection collection), `lib/server/messaging.ts` (staging denial), the pages that link the notice, `.env.example`.
- Documents: the PRD (sections 2, 8 and 10), provider setup, the page list, the implementation plan, the acceptance record and the decision log, with their Korean mirrors.
