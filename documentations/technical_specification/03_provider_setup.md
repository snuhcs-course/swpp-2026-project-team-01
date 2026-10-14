# Provider Setup and Environment Direction

Status: clean application baseline verified; provider/runtime acceptance pending

Date: 2026-10-13

Reviewed: 2026-10-15

The local application/SQL were removed and the selected hosted application schema was subsequently reset under explicit user authorization. The fresh audit below confirms the clean application baseline. This document combines verified database setup facts with future provider checks; external deployments, DNS, callbacks, inboxes, lines and provider grants were not reconfigured and may still have active consumers.

## Reconstruction deployment origin

The recorded reconstruction origin is **`https://release.findmeatime.com`**; local browser development is intended at **`http://localhost:3000`**. Product entry promises remain `https://findmeatime.com/SKILL.md` and host-specific skill links. Decide and verify root-domain routing/promotion before claiming those promises work. Never use untrusted request headers to construct callbacks or private links.

Vercel is the recorded hosting direction. Cloudflare remains registrar/authoritative DNS for `findmeatime.com`. Identify the actual team/project and use current domain inspection output before any DNS change, following [domain guidance](../../AGENTS.md#domain-and-dns). Domain ownership alone proves no application availability.

## Selected rebuild Supabase project

Use Supabase project **`anelszynxtvxoxqvzgqt`**, selected by the user on 2026-10-13. Supabase CLI 2.119.0 lists it as **FindMeATime**, region **`us-east-2`**, status **`ACTIVE_HEALTHY`**. This replaces the previous reconstruction target. This checkout is CLI-linked: `supabase/.temp/project-ref` and a fresh CLI inventory both confirm the selected ref. Link metadata is ignored by Git. Application/provider credentials and replacement readiness have not been verified.

Application schemas, migrations and SQL tests were removed locally under the source reset; their Git recovery point is `02e5a8e`. The user subsequently explicitly authorized resetting this linked project's application schemas. That remote reset is complete: the application schema/RPC, legacy queue/jobs and seven migration records were removed. Supabase-managed schemas and data were preserved. The application baseline is now verified empty; do not restore the old 143-file migration chain as pending work. Local migration and seed execution remain disabled until a new explicit implementation request and a reviewed new chain.

Use CLI **2.119.0** and the [pg-delta workflow](../../AGENTS.md#supabase-schema-changes) after the baseline decision. Only then create desired schemas, generate/review migrations and verify the chain on an identified disposable local database. Do not generate from an accidentally empty desired tree or repair remote migration history as a shortcut. Any future remote reset requires explicit user authorization for its identified target.


### Clean project recheck — 2026-10-13

Fresh read-only catalog queries after the reset confirm the following current state on linked project `anelszynxtvxoxqvzgqt`:

| Concern | Verified state | Implementation consequence |
|---|---|---|
| Application namespaces/objects | Only empty `public`; `fmat` absent; zero relations, non-extension functions and enum/domain types | Author a new application schema; previous object names/RPCs are not retained dependencies |
| Migration history | Zero rows | Start a reviewed new application chain after implementation authorization; do not restore the old 143-file chain as pending work |
| Scheduled processing | Zero rows in `cron.job` | Create only reviewed new schedules; external deploy/webhook ownership still needs checking |
| Queue processing | Zero registered queues or queue/archive relations | Infrastructure `pgmq` remains installed; new queue creation is future implementation |
| Identity | One Auth user and one Google identity | Identity does not restore admission, host profile, Calendar grants or agent/channel access; hosted Auth settings/callbacks are unverified |
| Storage and Vault | Zero buckets/objects; two retained secrets, values unread | Preserve managed data; validate required secret purpose/target later without assuming old secrets fit the replacement |
| PostgreSQL | 17.6 | Local major version 17 matches; pin and verify actual disposable test/runtime images when implementing |
| Infrastructure | Eight extensions and managed Auth/Storage/Realtime/network/Vault schemas remain | Application emptiness is not whole-project emptiness; avoid dropping/redefining managed objects |

Installed versions remain `pg_cron` 1.6.4, `pg_net` 0.20.4, `pgmq` 1.5.1, `pgcrypto` 1.3, `pg_stat_statements` 1.11, `supabase_vault` 0.3.1, `uuid-ossp` 1.1 and `plpgsql` 1.0. These are observed prerequisites, not proof that replacement queues, workers or application permissions exist. New migrations must handle required preinstalled infrastructure without deleting managed state.

Default privileges were also inspected. Objects created by `postgres` or `supabase_admin` in `public` currently inherit table/sequence privileges and function execution for `anon`, `authenticated` and `service_role`. No application object exists to exercise those grants now. Before the first application schema deployment, review namespace/default privileges and declare the intended grants/revokes and RLS; a public service-only RPC must not inherit unintended client execution. This review changed no privileges.

The retained local config has PostgreSQL major 17, pg-delta enabled, migrations/seeds disabled and no declarative `schema_paths`. Its `project_id` is a local-stack identifier, not the hosted project ref, and its local Auth defaults are not evidence of hosted Google-only configuration. Project-bound application keys, hosted Auth settings, callbacks, deployed APIs and provider/client readiness remain unverified. Check these at their entry gates in the [implementation plan](04_implementation_plan.md#clean-supabase-baseline-and-entry-gates).

The fresh queries returned schema/role metadata and aggregate counts only. No private identity details, tokens, Vault values or transcripts were retrieved. The selected project was not mutated during this recheck.

A repeat read-only catalog/aggregate check on 2026-10-14 using Supabase CLI 2.119.0 and the same explicit linked project ref confirms the application object/type, migration, job and queue counts remain zero. Managed counts remain one Auth user with one Google identity, zero Storage buckets/objects and two unread Vault secrets; PostgreSQL and installed extension versions are unchanged. This repeat check did not re-audit default privileges or hosted Auth/provider settings. Recheck again before implementation or remote activation.

### Authorized application schema reset — 2026-10-13

After the read-only inspection below, the user explicitly requested a schema reset on linked project `anelszynxtvxoxqvzgqt`. A scoped transaction removed `fmat` and all its application data/objects, `public.fmat_command`, the `fmat_jobs` queue and archive, the four named legacy cron jobs, and all seven rows of application migration history. No migrations, seed files or replacement code were applied.

Fresh post-commit catalog queries and CLI migration listing verify:

| Check | Current state |
|---|---|
| `fmat` application schema | Absent |
| `public` application relations/functions | 0 / 0 |
| Application migration records | 0 |
| `fmat` scheduled jobs | 0 |
| `fmat_jobs` queue metadata/tables | 0 / 0 |
| Auth users | 1, preserved |
| Storage buckets/objects | 0 / 0, unchanged |
| Vault secrets | 2, preserved without reading values |

Supabase-managed Auth, Storage, Realtime, Vault, network, extension, cron, queue infrastructure and migration schemas remain. Only application contents and history were reset; this was not project deletion or a platform-schema wipe. The public schema remains as an empty application namespace. Existing provider accounts, hosted application deployments, DNS and provider-side OAuth grants were not reconfigured.

Before destruction, private ignored backups captured the 30 application tables, their data, recorded migration SQL, queue/archive contents and queue/cron definitions. Files have restricted permissions and checksums under `.local/reconstruction-reset/2026-10-13-anelszynxtvxoxqvzgqt/`. Do not commit or publish them; they may contain private application data and job credentials. Export structure/coverage was checked; a full restoration drill was not run. A scoped transaction and post-commit verification establish the reset outcome independently of the backup.

The populated application baseline documented below is historical. New implementation may start a reviewed clean application migration chain only after a new implementation request; local migration/seed execution stays disabled for now. Managed identity/configuration and provider credentials still require fresh implementation-specific verification.


### Historical pre-reset inspection — 2026-10-13

The following inventory describes the earlier pre-reset inspection with Supabase CLI **2.119.0**, explicit project ref `anelszynxtvxoxqvzgqt`, linked migration listing, read-only catalog/aggregate queries and table statistics. PostgreSQL reported **17.6**. That inspection made no changes; the later authorized reset removed the application objects/data recorded here.

| Inspected application objects | Observed state |
|---|---|
| `fmat` | 30 tables, 3 sequences, 47 application functions, no views |
| `public` | No tables/views/sequences; one application RPC, `fmat_command` |
| Structural inventory | 265 columns, 152 constraints, 72 indexes and 2 non-internal triggers across application objects |
| Row-level security | Enabled on all 30 `fmat` tables; no application RLS policies |
| Direct access | `anon` and `authenticated` have no `fmat` schema usage, table privileges or application-function execution privileges |
| Service boundary | `service_role` also lacks direct `fmat` schema usage; it can execute the public `fmat_command` RPC |
| Definer functions | Four; each has an explicitly empty `search_path` |

This is a private, RPC-mediated legacy design. RLS/privilege metadata alone does not prove RPC authorization or application security. Platform-managed Auth, Storage, Realtime, network and migration schemas remain present. Installed extensions include `pg_cron`, `pg_net`, `pgmq`, `pgcrypto`, `pg_stat_statements`, `supabase_vault`, `uuid-ossp` and `plpgsql`.

Aggregate reads establish existing data without retrieving record contents: one Auth user, one host, one request, two Calendar connections, four jobs and two outbox rows at inspection time. These are point-in-time counts; existing workers may still change state. Credentials, attendee details, transcripts and vault values were not read or saved in documentation.

#### Recorded migration history

Before the authorized reset, there were **seven remote records** and no local application migration files:

| Version | Recorded name | Statements |
|---|---|---|
| `20261004215214` | `application_foundation` | 43 |
| `20261004215225` | `foundation_runtime` | 6 |
| `20261004221112` | `host_admission_and_google_connections` | 35 |
| `20261004223924` | `request_lifecycle` | 63 |
| `20261004225750` | `approved_booking` | 40 |
| `20261005062543` | `setup_conversations` | 61 |
| `20261005171712` | `outbound_imessage_otp_link` | 16 |

All seven versions/names have matching filenames in recovery commit `02e5a8e`. That commit contains **143** migrations in total: **136 later versions were not recorded at that pre-reset inspection**. This is a version/name comparison, not a statement-body parity or live-schema drift proof. Do not restore all 143 as a pending deployment queue or assume the later chain belongs on this target. The seven records were subsequently cleared only under the explicit reset authorization above. Their private backup remains historical recovery material; do not replay them automatically into the now-empty application baseline.

#### Existing scheduled consumers

Before reset, four `pg_cron` jobs were active; all four were subsequently unscheduled:

| Job | Schedule |
|---|---|
| `fmat-job-recovery` | Every minute |
| `fmat-worker` | Every minute |
| `fmat-oauth-cleanup` | Every ten minutes |
| `fmat-request-expiry` | Every minute |

During that inspection, command bodies/endpoints/credentials were not retrieved. The later reset privately backed up definitions and unscheduled these jobs. None is active now. Before any new schema/API activation or live provider test, verify external consumer ownership separately; zero database jobs does not establish that old deployed callbacks are inactive.

#### Verification limits and next baseline step

CLI linkage, object inventory, RLS/role grants, aggregate data presence and migration version/name records are verified. Full function-body authorization, deployed API/client behavior, historical SQL equivalence, direct-change drift and provider credentials remain unverified. Application tests cannot run in the source-free planning checkout. Keep local migration/seed execution disabled. The inspection itself authorized no mutation. The later explicit reset superseded this populated-baseline prerequisite; new migration generation/push or code start still requires a separate implementation request.

## Google identity and Calendar

The MVP requires Google-only host login through Supabase Auth. One existing Google identity is observed, but current hosted provider/email-login settings and callbacks have not been audited. Identity login, host admission, host Calendar consent, requester identity prefill, requester Calendar consent and personal-agent OAuth are separate boundaries. Do not enable email/password, email OTP or magic-link host login.

Fresh checks must record OAuth application ownership/publishing state, exact callback URLs, least permissions, host versus request-bound state, cancellation/replay/wrong-browser denial, refresh, disconnect/reconnect and readable failures. Host calendar roles require actual metadata/write permission. Requester consent is availability-only and requires no admission/account. Keep encrypted grants server-side and reveal neither participant's private events to the other.

## Cloudflare Email Service

Retain Cloudflare for transactional host invitations, contact verification, private recovery and confirmed booking messages, with sender `no-reply@findmeatime.com`. Verify sender/domain ownership, API permissions, delivery outcomes and provider retry limits using authorized controlled recipients. API acceptance is distinct from inbox delivery.

Preserve Cloudflare custom SMTP for applicable non-login Supabase Auth notifications, as required by the [email-delivery contract](../../openspec/specs/email-delivery/spec.md#requirement-separate-transactional-sending-from-conversations). S2 owns verification of the selected project's hosted SMTP configuration, sender/domain and applicable notification routing before hosted Auth acceptance; current settings and delivery remain unverified. Applicable production Auth notifications must use `no-reply@findmeatime.com` through Cloudflare SMTP, with no fallback sender. Record controlled notification evidence where applicable; SMTP configuration alone does not prove inbox delivery. This retains Google-only sign-in and does not enable email/password, email OTP or magic-link login or add password-reset login journeys. Old SMTP/invitation scripts and commands no longer exist; this planning fix configures no hosted service.

### Host invitation operations

A future separate administrator CLI will issue/status/revoke/recover recipient-bound invitations with explicit environment and operator authority. Preserve the [admission contract](../../openspec/specs/host-admission/spec.md), including seven-day validity, hash-only code storage and atomic matching-account redemption. Private manual delivery output must not print invitation secrets to routine JSON/logs. Issuance, dispatch, uncertainty and redemption are distinct states.

## AgentMail

Use AgentMail for requester conversation inboxes, threads and replies. Verify inbox allocation/ownership, webhook authentication, exact receiver generation, authenticated sender evidence, request/thread enrollment, deduplicated ingress, durable dispatch, outgoing-parent continuation and revoke/closure behavior. Initial email intake is required alongside browser-created request enrollment; rebuilding only the latter cannot complete the channel.

Record actual idempotency/reconciliation limits before retries. Provider acceptance, signed ingress fixtures and real multi-turn inbox delivery are separate acceptance evidence. Keep host-private email as a proposed extension outside initial release.

## Photon

Photon Spectrum remains the iMessage transport direction. Reverify SDK/provider version, shared/dedicated route policy, webhook authentication and native-eve adapter versus application-owned receiver behavior. Select the adapter based on durable receipt, acknowledgment, exact sender/chat identity and recovery evidence rather than old implementation claims.

### First message and host onboarding

An authenticated admitted host enters their phone in an inline web card, receives a six-digit code in the intended private chat, enters it in the initiating browser and explicitly confirms linking. An iMessage-first introduction may lead to that browser handoff; it grants no private access. Test wrong/expired/replayed codes, resend limits, uncertain delivery, browser binding and unlinking. Keep codes outside chat transcripts/model context and show masked recipient/status only.

Verify request selection, private discussion, revision and exact-proposal approval/decline on a controlled iPhone. Unsupported recipients/groups must not receive private state. Record actual device/client versions; transport send success alone cannot establish device receipt or attribution.

### Display-name, contact cards and profile sync

Retain optional **Add to contacts** as a proposed host action after a verified private exchange. Freeze the actual selected route and report provider acceptance/uncertainty truthfully. The recipient chooses whether to save it; the product cannot promise the displayed name or infer identity/consent from a contact card. Verify the actual account profile and real-device presentation independently before claiming support.

## Model access and runtime

Keep model configuration server-side and use the team's intended direct-provider billing route. Select a supported model ID and verify its tool/context metadata during the runtime foundation, while enforcing the settled [model limits](../../openspec/specs/model-execution/spec.md); no previous model entitlement or numerical SDK/version claim carries forward. Test invalid/refused outputs, provider deadlines, rate/credit failures, durable usage accounting and private-data filtering using synthetic context. A model failure never advances scheduling state or creates approval.

## Protected MCP OAuth compatibility

Verify the chosen authorization server against the [resource-bound authorization contract](../../openspec/specs/agent-client-authorization/spec.md), independently of Supabase login. Require exact resource, callbacks, PKCE, current grants, refresh rotation/reuse handling, revocation and wrong-audience/scope denial. Record supported protocol/client registration versions before publishing connection instructions.

Test Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code individually, including both skill prompts, host/requester scopes and human confirmation. An SDK fixture or another client's success is insufficient.

## Environment and activation checklist

Before the first remote application schema/API activation and each controlled provider test, identify local/preview/release configuration, project-bound credentials and consumers without printing secrets. This gate applies in S2–S9; it is not deferred until the S10 release audit. Previews default to no live delivery. Inventory/fence old callback/worker consumers before replacement activation, and preserve rollback ownership. Record exact commands only when the owning implementation exists and is verified. Remote schema push requires the identified target and reviewed dry run under repository guidance.

Backups, redacted diagnostics, retention/deletion and measured budgets need fresh runbooks in the operations slice. This reset grants no external message, migration deployment or production promotion.
