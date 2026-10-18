# Provider Setup and Environment Direction

Status: environment selected; provider and runtime acceptance pending

Date: 2026-10-19

## Deployment origin

The release origin is **`https://release.findmeatime.com`**; local browser development is intended at **`http://localhost:3000`**. Product entry promises remain `https://findmeatime.com/SKILL.md` and host-specific skill links. Decide and verify root-domain routing/promotion before claiming those promises work. Never use untrusted request headers to construct callbacks or private links.

Vercel is the hosting direction. Cloudflare remains registrar/authoritative DNS for `findmeatime.com`. Identify the actual team/project and use current domain inspection output before any DNS change, following [domain guidance](../../AGENTS.md#domain-and-dns). Domain ownership alone proves no application availability.

## Supabase project

Use Supabase project **`anelszynxtvxoxqvzgqt`** (**FindMeATime**, region **`us-east-2`**) as the team's shared project; see [Environments and collaboration](#environments-and-collaboration) for how it is used. Link each clone with `supabase link --project-ref anelszynxtvxoxqvzgqt` using Supabase CLI 2.119.0; link metadata is ignored by Git. Application and provider credentials have not been verified against it.

**`mriseqztcwmezvtawnbo`** (**FindMeATime2**, `us-west-1`, PostgreSQL 17.11) exists in the same organization and is reserved as the future release project. It currently holds unrelated contents and must be emptied before use; do not link to it for development.

The project's application schema is empty: `public` contains no application relations, functions or types, and there are no application migration records, scheduled jobs or registered queues. Supabase-managed Auth, Storage, Realtime, Vault, network, cron and queue infrastructure remain, with one Google Auth identity, no Storage objects and two Vault secrets whose purpose must be validated before use. PostgreSQL is **17.6**, matching the local major version. Installed extensions are `pg_cron` 1.6.4, `pg_net` 0.20.4, `pgmq` 1.5.1, `pgcrypto` 1.3, `pg_stat_statements` 1.11, `supabase_vault` 0.3.1, `uuid-ossp` 1.1 and `plpgsql` 1.0; these are prerequisites, not evidence that application queues, workers or permissions exist.

Objects created by `postgres` or `supabase_admin` in `public` currently inherit table/sequence privileges and function execution for `anon`, `authenticated` and `service_role`. Before the first schema deployment, review namespace and default privileges and declare the intended grants, revokes and RLS explicitly. The existing Google identity does not establish a host account, Calendar grants or channel access; create those only through authorized application operations.

The local `config.toml` has PostgreSQL major 17, pg-delta enabled, migrations/seeds disabled and no declarative `schema_paths`. Its `project_id` is a local-stack identifier, not the hosted project ref, and its Auth defaults are not evidence of hosted Google-only configuration. Use the [pg-delta workflow](../../AGENTS.md#supabase-schema-changes) for the first schema change: create desired schemas, generate and review migrations, verify the chain on a disposable local database, and push to the hosted project only after a reviewed dry run and explicit environment identification.

## Environments and collaboration

Decided 2026-10-19. The team starts with **one shared environment plus personal sandboxes**; a separate release environment is added later under the trigger below. Branching follows [GitHub Flow](../../AGENTS.md#git-workflow-and-pull-requests): `main` is the only long-lived branch.

| Layer | Supabase | Application runtime | Who changes it |
|---|---|---|---|
| Personal sandbox | Each teammate's own free project in their personal Supabase organization | `eve dev` and `next dev` on the teammate's machine; eve keeps conversation state in the local `.eve/.workflow-data` directory, no Docker required | The teammate, freely |
| Shared | **FindMeATime** `anelszynxtvxoxqvzgqt` | Vercel **Production** deployment of `main`; pull requests get Vercel **Preview** deployments against the same project | CI on merge to `main`; nobody by hand |
| Release | **FindMeATime2** `mriseqztcwmezvtawnbo`, after it is emptied | Separate Vercel production target | Not yet in use |

Schema changes flow in one direction:

1. A teammate edits the desired SQL under `supabase/schemas/` on a topic branch.
2. Generating the migration with pg-delta needs Docker for its shadow database. A teammate whose machine has Docker generates and commits the migration in the same pull request; the full `supabase start` stack is not required for generation.
3. Teammates apply the branch's migrations to their own sandbox with `supabase db push` and reset the sandbox with `supabase db reset --linked` when switching branches or when history diverges. Shared fixtures live in `supabase/seed.sql` so a reset restores them.
4. After review and merge, CI pushes the migrations to the shared project. This CI job is introduced with the first schema change.

Rules for the shared project: never change its schema through Studio or the SQL editor; `supabase db diff --linked` must stay empty against the committed migrations. Its data is disposable until the release split, so a `supabase db reset --linked` after a team announcement is acceptable. Application messaging is denied outside the production deployment, as the [messaging-environments contract](../../openspec/specs/messaging-environments/spec.md) requires, so Preview deployments cannot send email or iMessage.

Configuration: share the shared project's URL and keys through the team's password manager, never through Git; `.env.example` lists the variable names. Scope Vercel environment variables by Production and Preview. Register `http://localhost:3000/**` and each teammate's sandbox callback in the Auth redirect allowlist and the Google OAuth client so sign-in works locally.

Split a release environment **before** the first of these happens: an external host connects a real Google Calendar, real email or iMessage delivery is enabled for people outside the team, or data must survive schema changes. Until then there is nothing to protect, and one environment is simpler to keep consistent.


## Google identity and Calendar

The MVP requires Google-only host login through Supabase Auth. Hosted provider and email-login settings and callbacks have not been audited. Host sign-in and requester **Continue with Google** each request identity and Calendar scopes on one consent screen, yet identity login, host eligibility, host Calendar consent, requester identity prefill, requester Calendar consent and personal-agent OAuth remain separate authorization boundaries. Pass the Calendar scopes and offline access through Supabase Auth, read the granted scopes from the token response because Google lets users uncheck scopes, and store the provider refresh token server-side at sign-in since Supabase returns it only then and does not refresh provider tokens. Do not enable email/password, email OTP or magic-link host login.

Checks must record OAuth application ownership/publishing state and Google app verification for the sensitive Calendar scopes, exact callback URLs, least permissions, host versus request-bound state, cancellation/replay/wrong-browser denial, refresh, disconnect/reconnect and readable failures. Host calendar roles require actual metadata/write permission. Requester consent is availability-only and requires no host eligibility or account. Keep encrypted grants server-side and reveal neither participant's private events to the other.

## Cloudflare Email Service

Use Cloudflare for transactional contact verification, private recovery and confirmed booking messages, with sender `no-reply@findmeatime.com`. Verify sender/domain ownership, API permissions, delivery outcomes and provider retry limits using authorized controlled recipients. API acceptance is distinct from inbox delivery.

Use Cloudflare custom SMTP for applicable non-login Supabase Auth notifications, as required by the [email-delivery contract](../../openspec/specs/email-delivery/spec.md#requirement-separate-transactional-sending-from-conversations). Verify the selected project's hosted SMTP configuration, sender/domain and applicable notification routing before hosted Auth acceptance; current settings and delivery are unverified. Applicable production Auth notifications must use `no-reply@findmeatime.com` through Cloudflare SMTP, with no fallback sender. Record controlled notification evidence where applicable; SMTP configuration alone does not prove inbox delivery. This keeps Google-only sign-in and does not enable email/password, email OTP or magic-link login or add password-reset login journeys.

### Operator host controls

A separate administrator CLI suspends and restores host accounts with explicit environment and operator authority; it sends no email. Suspension is the operator's abuse control and takes effect through the shared host-eligibility guard. Routine JSON/logs must not print private host data. Suspension, restoration and recovery are audited and distinct states.

## AgentMail

Use AgentMail for requester conversation inboxes, threads and replies. Verify inbox allocation/ownership, webhook authentication, exact receiver generation, authenticated sender evidence, request/thread enrollment, deduplicated ingress, durable dispatch, outgoing-parent continuation and revoke/closure behavior. Initial email intake is required alongside browser-created request enrollment; building only the latter cannot complete the channel.

The selected address is **`findmeatime@agentmail.to`**, with display name **Find Me a Time**. Provisioning is blocked by the current three-inbox account limit; keep the existing working configuration until the selected inbox is created and application-key access is verified. Configure `AGENTMAIL_API_KEY`, `AGENTMAIL_POD_ID` and `AGENTMAIL_INBOX_ID` for the intended application resources. Use narrowly scoped `inbox_read`, `message_read` and `message_send` permissions; reserve provisioning and webhook administration for operator credentials.

Custom domains are supported on paid plans. A separately registered subdomain, such as `agents.findmeatime.com`, can host an address such as `hello@agents.findmeatime.com` while keeping root-domain mail routing separate. This is an optional future address, not the selected inbox. Add the exact AgentMail-provided DNS records in Cloudflare and verify the domain before switching; preserve Cloudflare transactional sending and existing mail records. See [custom domains](https://docs.agentmail.to/custom-domains), [MX coexistence](https://docs.agentmail.to/knowledge-base/mx-record-conflicts) and [plan availability](https://www.agentmail.to/pricing).

Record actual idempotency/reconciliation limits before retries. Provider acceptance, signed ingress fixtures and real multi-turn inbox delivery are separate acceptance evidence. Keep host-private email as a proposed extension outside initial release.

## Photon

Photon Spectrum is the iMessage transport direction. Verify SDK/provider version, shared/dedicated route policy, webhook authentication and native-eve adapter versus application-owned receiver behavior. Select the adapter based on durable receipt, acknowledgment, exact sender/chat identity and recovery evidence.

### First message and host onboarding

Photon's deliverability guidance makes inbound-first the default: an authenticated active host sees the line's number and a one-time link code in an inline web card with **Copy** and an **Open Messages** deep link (iOS expects `sms:<number>&body=<text>` while Android expects `sms:<number>?body=<text>`, so verify the prefilled input on real iPhones and in macOS Messages), sends the code from their own iMessage, and confirms the masked sender in the initiating browser, so the service's first message is a reply. The fallback, when the host cannot send from the device, is the service-sent six-digit code typed into the browser; it counts as a new outbound conversation, which Photon caps per line per day and shows to the recipient with a junk banner, so record how often it is used. An iMessage-first introduction without a code leads to the browser handoff and grants no private access. Test wrong/expired/replayed codes on both paths, a code sent from a different number, resend limits, uncertain delivery, browser binding and unlinking. Keep codes outside the web transcript and model context (the channel consumes the inbound link message before any model turn) and show masked sender/status only.

Verify request selection, private discussion, revision and exact-proposal approval/decline on a controlled iPhone. Unsupported recipients/groups must not receive private state. Record actual device/client versions; transport send success alone cannot establish device receipt or attribution.

### Display-name, contact cards and profile sync

Offer optional **Add to contacts** as a proposed host action after a verified private exchange. Freeze the actual selected route and report provider acceptance/uncertainty truthfully. The recipient chooses whether to save it; the product cannot promise the displayed name or infer identity/consent from a contact card. Verify the actual account profile and real-device presentation independently before claiming support.

## Model access and runtime

Keep model configuration server-side and use the team's intended direct-provider billing route. Select a supported model ID and verify its tool/context metadata during the runtime foundation, while enforcing the agreed [model limits](../../openspec/specs/model-execution/spec.md). Test invalid/refused outputs, provider deadlines, rate/credit failures, durable usage accounting and private-data filtering using synthetic context. A model failure never advances scheduling state or creates approval.

## Protected MCP OAuth compatibility

Verify the chosen authorization server against the [resource-bound authorization contract](../../openspec/specs/agent-client-authorization/spec.md), independently of Supabase login. Require exact resource, callbacks, PKCE, current grants, refresh rotation/reuse handling, revocation and wrong-audience/scope denial. Record supported protocol/client registration versions before publishing connection instructions.

Test Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code individually, including both skill prompts, host/requester scopes and human confirmation. An SDK fixture or another client's success is insufficient.

## Environment and activation checklist

Before the first remote application schema/API activation and each controlled provider test, identify local/preview/release configuration, project-bound credentials and consumers without printing secrets. This gate applies to every change that activates a provider; it is not deferred until a release audit. Previews default to no live delivery. Inventory and fence any competing callback/worker consumers before activation, and preserve rollback ownership. Record exact commands only when the owning implementation exists and is verified. Remote schema push requires the identified target and reviewed dry run under repository guidance.

Backups, redacted diagnostics, retention/deletion and measured budgets need runbooks in the operations change. Nothing in this document grants external messaging, migration deployment or production promotion.
