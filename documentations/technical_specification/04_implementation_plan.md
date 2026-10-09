# Rebuild implementation plan

Date: 2026-10-06
Status: source removal and scaffold completed on 2026-10-07; foundation and runtime implementation are in progress, with phase gates tracked in the [evidence ledger](05_rebuild_evidence.md)
Scope: full application-source rebuild in the main checkout on `feat/reconstruct-application`

## 1. Outcome and fixed decisions

Deliver a working one-to-one scheduling service: a host chats with the agent at `/app`, a requester starts at `/{handle}` and continues at `/booking/[bookingId]`, and one calendar event is confirmed only after current requester agreement and attributable host approval. Email, iMessage and personal-agent clients operate on the same authorized application state. This plan owns rebuild scope and delivery sequence; the [page list](../user_experience/04_page_list.md) and [PRD](../02_product_requirements.md) own the experience and product requirements.

| Decision | Implementation constraint | Owning reference |
|---|---|---|
| Reconstruction origin | Deploy the rebuilt app at `https://release.findmeatime.com`, paired with Supabase project `mriseqztcwmezvtawnbo`. Use that origin for generated links, Auth returns and provider callbacks; domain/DNS readiness requires fresh verification. | [Deployment setup](03_provider_setup.md#reconstruction-deployment-origin) |
| MVP host audience | Target iPhone/iMessage hosts; recommend linked iMessage for everyday interaction, with web or iMessage onboarding and verified browser handoffs. Linking stays opt-in and web remains available. Defer Android-specific flows/testing and substitute notification channels; do not block public requesters by device. | [Audience and scope](../02_product_requirements.md#target-users) |
| One host chat page | Admission, setup, request selection/review and settings are cards, states or dialogs inside `/app`; authentication and provider consent return there. | [Page model](../user_experience/04_page_list.md#primary-pages) |
| Requester journey | No product account required; public intake leads to protected `/booking/[bookingId]`. Closed access is limited to permitted status/receipt, not an unlimited transcript. | [Booking destination](../user_experience/04_page_list.md#requester-booking-destination) |
| Repository structure | Follow the eve chat template: root `agent/`, `apps/web/` with `app/`, `components/` and web-specific `lib/`, and root shared `lib/contracts/` and `lib/server/`. Build eve/web separately and compose through root `vercel.ts`; defer extra packages and worker/bridge apps. | [Source organization](02_frontend_architecture.md#source-organization) |
| Runtime and model | Next.js App Router with eve, conditional on Phase 1 passing; direct OpenAI via `eve/models/openai`, with server-only `OPENAI_API_KEY` and an explicitly verified native model ID. | [Frontend architecture](02_frontend_architecture.md#scope-and-decisions), [OpenAI setup](03_provider_setup.md#openai-model-access-through-eve) |
| Identity and durable domain state | Google-only host login through Supabase Auth; no email login. Supabase PostgreSQL; selected rebuild project `mriseqztcwmezvtawnbo`. Application code owns authorization and scheduling decisions. | [Project record](03_provider_setup.md#selected-rebuild-supabase-project), [backend boundaries](01_backend_architecture.md#2-module-boundaries) |
| Transactional and Auth email | **Cloudflare Email Service** for invitations, contact verification, recovery and booking confirmations from `no-reply@findmeatime.com`; retain Cloudflare SMTP for applicable Auth notifications; MVP login is Google-only. | [Cloudflare setup](03_provider_setup.md#cloudflare-email-service), [email contract](../../openspec/specs/email-delivery/spec.md) |
| Conversation channels | AgentMail requester inboxes, threads and replies; Photon Spectrum host iMessage. Verify actual adapter compatibility. | [Provider setup](03_provider_setup.md), [provider boundaries](01_backend_architecture.md#9-provider-boundaries) |
| Client access | Remote MCP and thin CLI; verify Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code individually. | [Interfaces](../user_experience/03_interfaces.md), PRD FR-24–25 and FR-29–34 |
| Source replacement | Rebuild in final paths, preserve unrelated local work, secrets, external resources and applied migration history. No old transcript/link migration or parallel replacement app. | [Replacement boundary](04_implementation_plan.md#2-execution-rules-and-source-ownership) |

Exclude Android-specific UX/testing, SMS/WhatsApp and Android-substitute host proposal-notification email, native mobile apps, group scheduling, non-Google calendars, general inbox management, host conversation email and automated post-booking reschedule/cancel. The [PRD release scope](../02_product_requirements.md#3-proposed-initial-release-scope) owns any later change.

### Reference repositories

Use these references during Phase 1 and the relevant UI/channel slices. The [source organization](02_frontend_architecture.md#source-organization) is our intended layout; repository examples do not override product routes, application authorization or provider decisions.

| Reference | Role in this rebuild | Boundary |
|---|---|---|
| [eve chat template](https://github.com/vercel/eve/tree/main/apps/templates/eve-chat-template) | Primary structural and runtime reference: root `agent/`, `apps/web/`, separate eve/Next.js builds and root `vercel.ts` composition, plus conversation transport and streaming. | Follow the verified template and installed-version docs for exact APIs; retain our Supabase identity and session authorization. |
| [personal-agent template](https://github.com/vercel/eve/tree/main/apps/templates/personal-agent-template) | Reference for agent organization, tools, connections and channel-linking concepts during onboarding and messaging work. | Its web app uses Nuxt; borrow channel/connection concepts without adopting its frontend framework. Verify Photon compatibility and our own user/channel bindings. |
| [Vercel chatbot](https://github.com/vercel/chatbot) | UI reference for conversation rendering, composer behavior, streaming feedback and artifact interactions. | Adapt useful interaction patterns; retain our single `/app` chat, scheduling-specific artifacts and eve runtime. Do not copy its auth, database, sidebar or runtime wholesale. |

Record the reference commit SHAs, selected package versions and any adapted patterns when implementation starts; `main` links are moving references. Use direct OpenAI through eve as already selected. Reference repositories do not add dependencies or services by themselves.

## 2. Execution rules and source ownership

Implementation update (2026-10-07): root `agent/`, shared `lib/`, `tests/` and Next.js under `apps/web/` now contain the runtime, authorized conversation adapters and browser access foundation. Separate builds, CI and local recovery/browser tests are implemented. The unused `packages/` placeholder was removed. The [evidence ledger](05_rebuild_evidence.md) records deployed slices and remaining runtime, provider and complete-journey gates.

The product has not launched. Rebuild the full application, including its scheduling backend, on `feat/reconstruct-application` in the main project directory. Foundation implementation extends the retained SQL schemas, migrations, database tests and independent SMTP tooling. Preserve local changes, secrets, external resources and migration history. Local source recovery is available in the ignored `.local/rebuild/pre-removal-2026-10-07/` checkpoint.

Build directly in final workspace paths. No development transcript/link migration or parallel replacement application is required. Check for competing remote consumers before controlled provider tests. Implement and verify current requirements through the owning OpenSpec changes; do not treat retained database assets as proof of rebuilt application behavior.

| Target | Treatment |
|---|---|
| `agent/` | Follow eve entrypoint conventions; keep instructions, tools, channels and supported connection definitions here. Tools delegate to shared authorized operations. |
| `apps/web/` | Build Next.js `app/`, `components/` and web-specific `lib/` following the reference template. |
| Root `lib/` | Share browser-safe schemas in `lib/contracts/` and server-only capabilities in `lib/server/` between eve and web. Verify both builds; defer independent packages. |
| Root `tests/` | Cross-module/runtime integration and browser e2e tests; unit tests remain beside modules and database tests remain under Supabase. |
| Root `package.json`, `vercel.ts` | Orchestrate separate eve/web builds and compose their services; adapt reference commands to npm. |
| `supabase/schemas/`, `supabase/tests/` | Implement desired schema, isolation and concurrency tests; preserve behavior, not old table shapes. |
| `supabase/migrations/` | Preserve existing history and add reviewed migrations generated from the desired schema. |
| Optional `apps/worker/` or `apps/photon-bridge/` | Defer creation until Phase 1 demonstrates a separate-process requirement. |
| Root/app manifests, lockfiles, `.github/workflows/check.yml`, `scripts/` | Keep install, typecheck, lint, tests, build and deployment commands coherent with each implemented slice. |
| `documentations/`, `openspec/` | Retain product requirements and settled behavior; update design/setup documents and record fresh evidence in bounded changes. |
| Infrastructure configuration, local secrets and external resources | Preserve and adapt deliberately; keep secrets out of tracked source and do not infer remote deletion authority from source replacement. |

The current [root scripts](../../package.json) and CI check documentation, retained infrastructure tooling, replacement TypeScript and initial HTTP security tests. Separate eve/web builds and a production-server smoke test are restored; full domain, browser and provider coverage remains required.

Use one owner for shared contracts/schema changes and one integrator for manifests/CI. Independent UI, provider and test work may run in parallel after their interfaces are agreed. Continue on the existing branch in the main directory; do not create a worktree for this plan.

## 3. Delivery sequence

Phases are dependency gates, not fixed calendar estimates. Work checkboxes cover each complete obligation; incremental completion lists record verified portions while broader obligations remain open. Each phase ends with runnable evidence and a small reviewable change. Pending product decisions belong in the relevant OpenSpec change, with a resolution before dependent implementation.

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Resource inventory, verification scope and bounded change map | Current docs |
| 1 | Tested runtime, model, persistence, worker and OAuth decisions | 0 |
| 2 | Domain contracts, schema, identity and durable execution foundation | 1 |
| 3 | Host admission and setup inside `/app` | 2 |
| 4 | Requester intake, availability and proposal review in web | 3 |
| 5 | Approval, reliable booking, receipt and transactional delivery | 4 |
| 6 | AgentMail requester continuity | 2, 4; booking verification needs 5 |
| 7 | Photon host linking and iMessage continuity | 1, 3; booking verification needs 5 |
| 8 | MCP/CLI and all named-client journeys | OAuth decision in 1, contracts in 2; full verification needs 5–7 |
| 9 | Release hardening, deployment and acceptance evidence | 3–8 |

After Phase 5, the first complete web booking path should work. That is an integration milestone, not completion of the release: email, iMessage and named clients remain required. Adapter development in Phases 6–8 may overlap once shared contracts are stable.

### Phase 0 — Reconcile specifications and verification scope

Work:

- [ ] Record tracked/untracked changes, existing remote consumers and retained resources; preserve unrelated work and credentials.
- [x] Map current admission, scoped access, setup review, proposal revision, booking uncertainty and channel replay requirements to replacement tests. [Preparation audit](05_rebuild_evidence.md#phase-0-preparation-checklist-audit--2026-10-09).
- [x] Create a bounded rebuild-foundation OpenSpec change. Map later slices to existing active changes or new bounded changes; avoid duplicate task ownership. [Preparation audit](05_rebuild_evidence.md#phase-0-preparation-checklist-audit--2026-10-09).
- [x] Sync the six verified foundation requirements into [chat workspaces](../../openspec/specs/chat-workspaces/spec.md) and [conversation access](../../openspec/specs/conversation-access/spec.md), and [archive all 11 completed tasks](../../openspec/changes/archive/2026-10-09-rebuild-application-foundation/tasks.md). Live Google, managed-runtime and full release gates remain open.
- [x] Complete foundation task 3.3: audit all eleven foundation tasks and six contract requirements against current code/test evidence, preserving the full acceptance inventory and explicit runtime/provider/client gaps. [Audit](05_rebuild_evidence.md#foundation-completion-audit--2026-10-09).
- [x] Complete foundation task 1.1: refresh resource/owner inventory and map all 28 acceptance criteria to bounded evidence and remaining work, including the missing agent-led intake required by AC-15/21/24. [Inventory](07_acceptance_inventory.md). Refreshed on 2026-10-09 for deployed `9e82305`, the verified 104-migration ledger, and explicitly unverified per-client availability.
- [x] Complete foundation task 3.2: document six admission/request adapters and verify direct bypass, stale decisions, exact terminal projections, expired continuation denial and confirmed receipts. Four focused integrations, full booking/receipt suite, SQL and application checks pass. [Evidence](05_rebuild_evidence.md#foundation-admission-and-request-adapter-acceptance--2026-10-09).
- [x] Complete foundation task 2.4: rebuild all 96 local migrations, verify whole-command rollback/retry across job, queue, audit and idempotency records, and confirm service-only access. All 1,540 SQL assertions, five integrations and local security advisors pass. [Evidence](05_rebuild_evidence.md#foundation-persistence-acceptance--2026-10-09).
- [x] Complete foundation task 2.2: audit six application runtime routes/four tools, verify denied ingress and revoked replay, actual restart recovery and browser audience switching. Both builds, three runtime suites, two browser suites, SQL and application checks pass. [Evidence](05_rebuild_evidence.md#foundation-runtime-access-acceptance--2026-10-09).
- [x] Complete foundation task 2.1: verify typed principals, scoped operations, forged-actor and cross-resource denial, conflicting/stale retries, safe public errors and revocation fencing through five integrations, the full SQL suite and application checks. [Evidence](05_rebuild_evidence.md#foundation-principal-and-command-guard-acceptance--2026-10-09).
- [x] Reconcile foundation task 1.2: preserve settled request/invitation expiry, scoped credential lifetime and English/Korean intake; replace stale iMessage OTP implementation claims with the owning change’s verified local and pending live status. [Evidence](05_rebuild_evidence.md#foundation-documentation-contract-reconciliation--2026-10-09).
- [ ] Reconcile active `connect-google-calendars`, `book-approved-proposals-reliably`, `conversational-host-setup` and `validate-provider-and-agent-compatibility` work. Rebuild tasks start unverified and require fresh completion evidence.
- [x] Capture the single `/app` surface, requester booking route, invitation receipt behavior and browser-entered iMessage OTP as explicit proposed deltas where needed. Do not mark main capability specs implemented in advance. [Preparation audit](05_rebuild_evidence.md#phase-0-preparation-checklist-audit--2026-10-09).

Exit: a resource inventory, behavior-to-test map and non-overlapping OpenSpec task map exist. Outstanding spec/document disagreements are resolved for the foundation slice. Validate changed OpenSpec artifacts using the repository's pinned CLI.

References: [repository change workflow](../../AGENTS.md#documentation-and-specifications), [active changes](../../openspec/changes/), [rebuild boundary](04_implementation_plan.md#2-execution-rules-and-source-ownership).

### Phase 1 — Prove the runtime and settle deployment decisions

- [x] Complete provider/runtime task 1.1: pin eve/chatbot reference revisions and runtime dependencies, verify direct OpenAI structured calls, add a CI browser/shared-contract import boundary check, and verify independent builds plus 15 composed production health/access checks. [Evidence](05_rebuild_evidence.md#runtime-reference-and-client-boundary-acceptance--2026-10-09). Managed recovery and live provider/client gates remain open.

- [x] Run the pinned local OAuth resource-isolation spike and retain a reproducible probe: unmodified GoTrue v2.197.0 fails wrong-resource form exchange/refresh and audience requirements despite passing PKCE/replay/revocation. Record the rejected boundary and required enforcement before MCP implementation. [Evidence](05_rebuild_evidence.md#local-oauth-resource-isolation-spike--2026-10-08). Full OAuth and named-client gates remain open.

Incremental completion (full phase exit remains open):

- [x] Scope Photon restart model-call evidence to the recovered input, verify distinct browser continuation does not affect that count, and pass the focused restart test plus all 26 concurrent integration tests. The historical CI failure lacks input attribution and remains inconclusive; full runtime/live gates stay open. [Evidence](05_rebuild_evidence.md#input-scoped-runtime-replay-evidence--2026-10-08).
- [x] Bound browser conversation headers/body/stream waits and make Reconnect now interrupt an in-flight read while preserving transcript cursor and message retry identity. Verify stalled HTTP fixtures, browser recovery, application checks, both builds and runtime restart recovery.
- [x] Deploy interruptible conversation recovery and verify the Ready production alias and 43 HTTP regressions (`47ebfec`; deployment `dpl_HvM8qSvG8bQxHhkAbQa111yytZHz`; [evidence](05_rebuild_evidence.md#interruptible-browser-conversation-recovery--2026-10-08)).

Work:

- [x] Configure the reconstruction deployment at `https://release.findmeatime.com` following [provider setup](03_provider_setup.md#reconstruction-deployment-origin). Verify domain attachment, DNS, TLS and origin configuration before remote callback tests; preserve root-domain and mail records. [Audit](05_rebuild_evidence.md#release-origin-and-oauth-spike-checklist-audit--2026-10-09).
- [x] Build the smallest integration with root `agent/`, Next.js in `apps/web/` and shared root `lib/`, following the [reference repositories](04_implementation_plan.md#reference-repositories) and [source organization](02_frontend_architecture.md#source-organization). Pin the dependency set verified on Node.js 24/npm; keep Supabase identity in control.
- [ ] Wire the direct OpenAI provider; verify the selected model and account entitlement. Keep keys server-side and fail clearly on missing credentials, rate limits and exhausted credits. A model failure must not advance scheduling state.
- [ ] Exercise two hosts and two request-scoped requesters. Verify session creation/read/list/stream/resume and every exposed mutation against actor, resource and audience. Inspect per-user memory scoping if memory is enabled; disable it until isolation is proven.
- [ ] Kill/restart the runtime mid-turn and after a tool commit; reconnect the browser. Verify authorized output recovery and one domain effect despite repeated tool execution. Test revocation while a stream/session exists.
- [ ] Choose and record eve persistence, API/tool placement, job transport, recovery scheduler, background execution, execution limits and required server secrets. Build shared `lib/server/` modules in both eve and Next.js and verify the root `vercel.ts` service composition. Verify client-safe contract imports cannot expose server modules or credentials. Create an additional worker/bridge only for a demonstrated requirement; do not assume old Edge Functions/Cron or a new external queue is necessary.
- [ ] Test the native eve Photon adapter against the selected Spectrum transport contract; choose it only if compatible, otherwise specify the narrow bridge boundary.
- [x] Run an early OAuth compatibility spike for protected MCP access: discovery, issuer/resource audience, registration, PKCE, refresh and revocation. Record client-specific gaps before finalizing access contracts; a successful browser Supabase login is insufficient. [Audit](05_rebuild_evidence.md#release-origin-and-oauth-spike-checklist-audit--2026-10-09).

Exit: a repeatable build/deployment smoke check and recorded runtime/OAuth decision document, with passing isolation and recovery tests. Pin a concrete model ID and document actual secret loading. Any failure that invalidates eve gets an explicit architecture decision before broad implementation; do not introduce a second agent engine silently.

References: [runtime decision](../03_technical_specification.md#backend-decision), [session protection](02_frontend_architecture.md#identity-and-conversation-selection), [durable work](01_backend_architecture.md#8-jobs-inbox-and-outbox).

### Phase 2 — Build contracts, identity, schema and durable effects

- [x] Apply one budget across direct/batch/booking evaluation and its RPC/provider boundaries. Verify late responses cannot start guest reads or save evidence, later-candidate expiry rejects the batch, and failure recording stays bounded. Pass five service tests and 405 application/provider tests. [Evidence](05_rebuild_evidence.md#evaluation-budget-orchestration--2026-10-09). Publication/ranking integration and rollout remain pending.

- [x] Propagate optional shared cancellation through Calendar refresh/catalog/freebusy/adjacent and Routes; verify stalled headers/bodies, pagination and no later fetch. Exercise the installed OAuth SDK and disable its otherwise-active retries. Pass 35 focused and 400 application/provider tests plus both builds. [Evidence](05_rebuild_evidence.md#evaluation-provider-cancellation--2026-10-09). Orchestration and rollout remain pending.

- [x] Implement and verify the invocation-owned 18-second budget primitive: monotonic expiry, cancelled/non-cooperative work, late results, cleanup and independent concurrent invocations. Pass five focused tests and 388 application/provider tests. [Evidence](05_rebuild_evidence.md#evaluation-budget-foundation--2026-10-09). Provider propagation, orchestration and deployment remain pending.

- [x] Trace the retired shared provider deadline and confirm the replacement evaluator lacks an invocation-wide budget. Create and strictly validate the bounded [evaluation deadline change](../../openspec/changes/bound-availability-evaluation/proposal.md) with cancellation, late-result and durable-uncertainty acceptance tasks. Implementation and deployment remain pending.

- [x] Reconcile the three retired Google-provider assertions and strengthen paginated metadata privacy fixtures on both pages. Verify refresh material preservation and revoked-grant handling. [Evidence](05_rebuild_evidence.md#legacy-google-provider-reconciliation--2026-10-09). Shared transport deadline reconciliation remains open.

- [x] Reconcile all six retired email-provider assertions; verify Cloudflare delivered-recipient matching, exact authentication headers and single-recipient rejection before sending. Record the fixed-sender and conversational AgentMail contract changes. [Evidence](05_rebuild_evidence.md#legacy-email-provider-reconciliation--2026-10-09). Live inbox acceptance remains open.

- [x] Reconcile all four retired booking-provider assertions and verify credential revocation prevents insert and lookup in all four active attempt phases, preserving post-dispatch uncertainty. [Evidence](05_rebuild_evidence.md#legacy-booking-provider-reconciliation--2026-10-09). Remaining legacy files and live acceptance stay open.

- [x] Reconcile the three retired Calendar/route adapter assertions and restore the remote-conference location guard. Preserve busy time while requiring clarification for unknown physical whereabouts. Verify failure before the fix, 381 application tests, both builds and runtime checks. Deploy `1c24b20` as `dpl_AL9jJigLzsRXNu2CGkLxho2UPmxA` and pass twenty production checks. [Evidence](05_rebuild_evidence.md#legacy-calendar-location-regression--2026-10-09).

- [x] Reconcile both retired ranking-provider assertions against the current adapter; record the explicit failure-policy change and verify fifteen private/authority input injections cannot reach the model or consume allowance. [Evidence](05_rebuild_evidence.md#legacy-ranking-provider-reconciliation--2026-10-09). The remaining legacy-file audit stays open.

- [x] Restore the legacy foundation check rejecting a publishable Supabase key in the shared server RPC configuration. Demonstrate failure before the fix and pass the regression, built-server zero-database-call check, 379 app/provider tests, real local Auth, both builds and 1,830 post-fixture SQL assertions. [Evidence](05_rebuild_evidence.md#legacy-public-key-configuration-regression--2026-10-09). Deployed `92956b1` as `dpl_4MKa6aQGYBFKYNLjehFMYgkAL2Ws`; independent alias/health and twenty production checks pass. Broader legacy behavior reconciliation remains open.

- [x] Verify actual eve acceptance followed by failed dispatch acknowledgment, retained lease, settlement and process restart without a replacement session or redispatch. Pass all three runtime suites and post-fixture SQL. [Evidence](05_rebuild_evidence.md#runtime-dispatch-acknowledgment-loss--2026-10-09).

- [x] Repair browser-fixture cleanup so host cascades remove setup history and booking/recovery jobs remove active/archived queue entries and publication rows. Verify both browser suites followed by all 1,532 SQL assertions without an intervening reset. [Evidence](05_rebuild_evidence.md#browser-fixture-cleanup-and-sequential-database-tests--2026-10-09).

Work:

- [x] Inventory retired root/CI commands from the pre-reconstruction revision and map their current executable checks, behavior owners and remaining gaps. This retrospective [command map](../../tests/README.md#legacy-verification-command-migration) does not claim assertion-level equivalence or complete hosted acceptance.

- [x] Define typed commands, viewer-specific queries and events for admission/setup, requests, proposals, explicit decisions, conversations, provider ingress, delivery and booking. Require resource/revision/idempotency information on applicable actions. [Contract and persistence audit](05_rebuild_evidence.md#phase-2-contract-and-persistence-audit--2026-10-09).
- [x] Implement Supabase host identity/admission, request-scoped guest credentials and verified conversation/channel bindings. Authorize before querying eve or executing a tool; a session ID is not a credential. [Implementation and authorization audit](05_rebuild_evidence.md#phase-2-identity-and-conversation-authorization-audit--2026-10-09); live Google/provider acceptance remains separate.
- [x] Model immutable proposal versions, agreement/approval evidence, one booking identity per request, attempt history, host reservations, inbox deduplication and outbox/jobs. Keep eve transcript persistence distinct from domain records. [Contract and persistence audit](05_rebuild_evidence.md#phase-2-contract-and-persistence-audit--2026-10-09).
- [x] Implement atomic state/audit/work commits, lease/fencing and recovery sweeps. Define recovery for a crash between eve accepting a message and the app recording dispatch acknowledgment. [Contract and persistence audit](05_rebuild_evidence.md#phase-2-contract-and-persistence-audit--2026-10-09).
- [x] Add database constraints, grants/RLS and narrow privileged access. Generate new migrations through pg-delta; preserve applied history. Rebuild the identified disposable local database and run cross-user/concurrency tests. [Schema parity and rebuild evidence](05_rebuild_evidence.md#phase-2-schema-parity-and-local-rebuild--2026-10-09).
- [ ] Update root scripts and CI to execute the replacement checks, including a separate local database job and browser job. Retire obsolete test commands only after their behavior coverage is mapped. The separate browser job has its own pinned local stack and pre/post-fixture SQL checks; both hosted runs now pass. Retrospective legacy behavior reconciliation remains bounded by the [command map](../../tests/README.md#legacy-verification-command-migration).

Exit: cross-host/request access fails; duplicate commands return consistent results; stale revisions fail; state and jobs commit atomically; expired leases/lost wake-ups recover without repeated effects. The migration chain rebuilds locally and its desired schema matches the checked-in files.

References: [module boundaries](01_backend_architecture.md#2-module-boundaries), [transactions](01_backend_architecture.md#5-persistence-and-concurrency), [schema workflow](../../AGENTS.md#supabase-schema-changes).

### Phase 3 — Deliver host setup in the single `/app` chat

- [x] Deploy bounded Photon receiver reads from `09b936a` (`dpl_9UR6Vmy8nssyPK7PNVADTaPMdf7i`); independently verify Ready/production alias, both builds and 70 HTTP guards while preserving the unavailable receiver state. [Evidence](05_rebuild_evidence.md#photon-adapter-boundary-acceptance--2026-10-09).

- [x] Complete native/selected Photon adapter acceptance (task 4.3): verify native acknowledgment/identity limitations, actual SDK protobuf identity and no resend, signed durable ingress, FIFO/deduplication, two-host runtime mapping and recovery. Add bounded/cancellable receiver reads. Host setup is 17/20; live-provider gates remain open. [Evidence](05_rebuild_evidence.md#photon-adapter-boundary-acceptance--2026-10-09).

- [x] Deploy private-channel readiness from `b18a99b` (`dpl_JDhQNHtNZp9SsdNzH8SnokDXBnRf`); independently verify Ready, the production alias, both builds and 69 HTTP guards. [Evidence](05_rebuild_evidence.md#private-channel-readiness-and-cross-channel-acceptance--2026-10-09).

- [x] Complete deterministic cross-channel acceptance (host-setup task 5.1): current private readiness links, actual invitation/Calendar services, signed iMessage/eve and browser continuation, stale review, two-host isolation and disconnect/unlink recovery. Host setup is 16/20; controlled live gates remain open. [Evidence](05_rebuild_evidence.md#private-channel-readiness-and-cross-channel-acceptance--2026-10-09).

- [x] Verify admission, bound Calendar consent/selection, confirmed readiness and linked web/iMessage isolation through the actual services and runtime with two hosts. Private-channel readiness reporting remains the last deterministic task 5.1 gap. [Evidence](05_rebuild_evidence.md#admission-and-two-host-setup-journey--2026-10-09).

- [x] Deploy confirmed-setup links from `67a2889` (`dpl_HdZN6Wgx2A8kMSaTbTougCFN9FQc`), independently verify Ready and the production alias, and pass 69 HTTP guards including protected readiness. [Evidence](05_rebuild_evidence.md#confirmed-setup-booking-links--2026-10-09).

- [x] Implement confirmed-setup booking and agent-instruction links gated by current Calendar permissions and reauthorized setup revisions. Verify provider failures, logout/stale checks, browser recovery, mobile/zoom and keyboard behavior. Full admission/two-host/channel acceptance remains open. [Evidence](05_rebuild_evidence.md#confirmed-setup-booking-links--2026-10-09).

- [x] Complete host-setup task 1.2 with actual eve/private-ingress verification of invalid and ambiguous model output, one mutation per input, stale web reviews after private edits, explicit current confirmation and no booking authority. Verify web/MCP parity, runtime recovery and both browser suites; production shared-function bodies and permissions match local verification. [Evidence](05_rebuild_evidence.md#shared-web-and-imessage-setup-review-verification--2026-10-09).

- [x] Deploy iMessage deadline fencing from `a2d863b` as migration `20261008203744_photon_link_deadlines.sql`; verify 95 matching migrations, both production function bodies/ACLs, rollback-only behavior, clean security advisors and 68 HTTP guards. [Evidence](05_rebuild_evidence.md#imessage-link-deadline-production-deployment).

- [x] Complete host-setup task 4.1: verify browser-bound hashed codes and durable delivery, and reject Auth/code expiry during database lock waits. Verify the 95-migration rebuild, 1,532 SQL assertions, nine Photon integrations, application checks and both browser suites. [Evidence](05_rebuild_evidence.md#imessage-link-expiry-under-contention--2026-10-09).

- [x] Deploy compact setup from `39fdafe` (`dpl_9zwPqhhVm8QFqiQtoC9DHCpwHmVS`); verify the Ready release alias and 53 production HTTP guards. [Evidence](05_rebuild_evidence.md#compact-setup-production-deployment).

- [x] Compact completed Calendar/preferences/analysis cards and the admitted-host shell; refresh the next setup question after Calendar saves, retain explicit edit/cancel controls and force the complete review open before confirmation. Complete task 3.4 with keyboard, mobile, zoom, reduced-motion, recovery and consent-return evidence. [Evidence](05_rebuild_evidence.md#compact-completed-setup-and-visual-acceptance--2026-10-09).

- [x] Deploy focus recovery from `08812c2` (`dpl_2v8HfWpbkjpTF3ut7jtF32s5pXxU`), independently verify the Ready release alias and 53 production HTTP guards. [Evidence](05_rebuild_evidence.md#focus-recovery-production-deployment).

- [x] Restore visible keyboard focus when opening, cancelling and saving preference editors, and after authorized Calendar return status. Verify existing draft/progress survives denied consent and completed preferences remain editable. Broader compact-card/interface acceptance remains open in task 3.4. [Evidence](05_rebuild_evidence.md#setup-editing-and-consent-return-focus--2026-10-09).

- [x] Deploy the editable weekly preview (`b47001b`; `dpl_5TnqM5kkUUKGwPjEKKZjCL4kagAk`); verify the Ready release alias and 53 public HTTP guards including protected setup/analysis/Calendar actions. [Evidence](05_rebuild_evidence.md#weekly-preview-production-deployment).

- [x] Complete host-setup task 3.2 with connection/calendar/scan and review cards plus an editable weekly preview; verify keyboard, 320/390/768/1440px reflow, reduced motion, 200% magnification and structured edits during model failure. [Evidence](05_rebuild_evidence.md#editable-weekly-preference-preview--2026-10-09).

- [x] Deploy and activate invitation delivery (`d9749ec`, deployment `dpl_DT1Jfi2qTF177x1DzaJRvbymDkwG`), configure the dedicated production key and verify 91 matching migrations, 53 HTTP checks, real CLI issuance/retry/recovery/revocation, one scheduled suppressed delivery and zero retained fixtures. Authorized mailbox acceptance remains open. [Evidence](05_rebuild_evidence.md#invitation-worker-endpoint-and-scheduler--2026-10-09).

- [x] Implement the dispatch-secret-protected invitation endpoint and private minute scheduler; verify the 91-migration rebuild, 1,473 SQL assertions, 33 integrations, 297 app/provider tests, both builds and both browser suites. Production activation and authorized mailbox acceptance are tracked separately. [Evidence](05_rebuild_evidence.md#invitation-worker-endpoint-and-scheduler--2026-10-09).

- [x] Deploy operator invitation recovery (`beda1d4`, `20261008174101`), verify 90 matching migrations, rollback-only recovery/revocation isolation, actual CLI service authentication, clean advisors and 48 HTTP checks. No live invitation/email was created. [Evidence](05_rebuild_evidence.md#operator-invitation-cli-and-private-recovery--2026-10-09).

- [x] Add runnable invitation issue/status/revoke/recover commands with explicit project/service authority, retained retry keys, exclusive 0600 output and active-invitation recovery. Verify 90-migration rebuild, 1,467 SQL assertions, 33 integrations including actual CLI processes, 295 app/provider tests and both builds. Worker activation/live delivery remain open. [Evidence](05_rebuild_evidence.md#operator-invitation-cli-and-private-recovery--2026-10-09).

- [x] Deploy invitation delivery database fencing (`cc897b1`, `20261008172627`) and verify 89 matching migrations, rollback-only preparation/dispatch/outcome checks, zero retained invitations, clean advisors and 48 HTTP checks. Runtime activation remains open. [Evidence](05_rebuild_evidence.md#fenced-invitation-delivery--2026-10-09).

- [x] Implement the invitation delivery worker with frozen code derivation, hash/fingerprint checks, current-validity and lease fencing, durable dispatch and no automatic resend. Verify the 89-migration rebuild, 1,459 SQL assertions, 32 integrations, 290 app/provider tests, clean advisors and both service builds. CLI, scheduler activation and live recipient acceptance remain open. [Evidence](05_rebuild_evidence.md#fenced-invitation-delivery--2026-10-09).

- [x] Deploy the operator invitation lifecycle migration (`ba5450f`, `20261008171143`) to the selected production database; verify 88 matching migrations, rollback-only behavior, zero retained probe records, clean security advisors and 42 HTTP checks. [Evidence](05_rebuild_evidence.md#durable-operator-invitation-lifecycle--2026-10-09).
- [x] Implement durable operator invitation issuance/status/revocation, fixed seven-day expiry, immutable delivery intent, exact retries and legacy bypass denial. Verify the 88-migration rebuild, 1,439 SQL assertions, 31 integrations and application checks; delivery/CLI acceptance remains open. [Evidence](05_rebuild_evidence.md#durable-operator-invitation-lifecycle--2026-10-09).
- [x] Define the bounded operator invitation change and verify strict internal command inputs, environment binding and retry-stable 80-bit code derivation with four tests. Durable issuance, CLI and Cloudflare delivery remain pending. [Evidence](05_rebuild_evidence.md#operator-invitation-contracts--2026-10-09).
- [x] Exercise live Google host login and add a repeatable initial-redirect probe with four passing diagnostic tests. The live result is **blocked by `redirect_uri_mismatch`**; record the exact Supabase callback and required Google Cloud sign-in/configuration correction. This completes diagnosis, not login acceptance. [Evidence](05_rebuild_evidence.md#live-google-host-login-blocker-and-probe--2026-10-09).

- [x] Complete host-setup task 2.4: verify explicit mode/location/transport/buffer choices, reuse of reviewed chat answers, online-only skips, per-meeting/per-trip policy, unsupported-route clarification and separate buffers. Add the full online-only browser journey and record [acceptance evidence](05_rebuild_evidence.md#explicit-onboarding-preference-acceptance--2026-10-09); live scan/channel gates remain open.

Incremental completion (2026-10-07; the full phase exit remains open):

- [x] Replace the host email-login form and endpoint with Google-only identity sign-in; retain waitlist email, invitation admission and separate Calendar consent.
- [x] Verify local Google PKCE exchange, wrong-browser/replayed/cancelled returns, CSRF, logout, invitation and account-free requester regressions; pass application checks, separate builds and runtime smoke tests.
- [x] Deploy Google-only sign-in and verify hosted Google enabled/email disabled, production redirect and cookie boundaries (`02a8ba0`; deployment `dpl_B3iDknA8E4b7NpeiGoqvQdRSsbs3`; [evidence](05_rebuild_evidence.md#google-only-mvp-login-update--2026-10-07)).
- [ ] Complete controlled live Google login and actual iPhone acceptance, followed by the remaining host-setup phase exit below.

Work:

- [ ] Implement the public `/` landing page with product explanation, sign-in/become-host entry and account-free waitlist submission. Deduplicate repeated submissions without granting hosting access.
- [ ] Implement Google-only sign-in (remove email login) and safe callback return to `/app`; display waitlist/invitation controls before admission without private agent history. Provide operator-only invitation issuance/revocation and Cloudflare invitation email and Google Auth provider configuration for the selected project.
- [ ] Make the agent guide every onboarding stage and its recovery, with server-verified next actions. Propose missing preferences before asking for manual input; apply explicit-choice/evidence/starter-default precedence, label provenance, respect corrections/dismissals and ask one unresolved question at a time. Verify both rich-context and no-history paths through inline iMessage connection or skip and completion under AC-28.
- [ ] Resume the host conversation and draft, render typed connection/settings review cards, and support exact-value dialogs during model failures. Confirm drafts explicitly before saving policy.
- [ ] Implement host Google consent, minimum required scopes, encrypted server-side tokens, refresh/revocation, conflict-calendar selection and writable booking destination. Return from consent to the original authorized context in `/app`.
- [ ] Add guided onboarding cards and explainable recommendations: suggest calendar roles from metadata, let the host choose a disclosed bounded scan, derive schedule/location summaries, then offer editable meeting windows and place/mode preferences. Resolve scan period/freshness and minimized evidence contracts before implementation; keep inference read-only and suggestions private until current explicit settings confirmation.
- [ ] Explicitly ask transportation and extra travel buffer after location for in-person/either hosts; support a per-trip policy, skip online-only and verify route mode, journey duration and buffer remain distinct.
- [ ] Explicitly ask host meeting-mode/location preferences during onboarding, with suggested choices, online-only venue skip, reuse of prior answers and a **Decide per meeting** option. Verify final review cannot treat inferred/default location preferences as an explicit answer.
- [ ] Verify rich, sparse, mixed-timezone and recurring-event fixtures; partial/revoked reads, duplicate names, read-only destinations, malicious event text, missing locations and stale results must preserve manual setup and confirmed rules. Review the calendar cards, weekly preview, location cards and final review on desktop/mobile with keyboard and reduced-motion checks.
- [ ] Publish a unique public handle and valid booking/skill links only after readiness checks. Reserve application/operational route names, including `app` and `booking`.
- [ ] Keep request selection, settings and connection management inside `/app`; no host subpages. Provide mobile/keyboard navigation and truthful empty/loading/error states.

Exit: an unauthenticated visitor can join the waitlist, and repeated submission creates no duplicate entry or hosting access. An invited host signs in, redeems once, resumes `/app`, connects Calendar, explicitly confirms rules and receives a working public link. Reload/consent/model failure preserves progress; expired/replayed/concurrent invitation redemption and direct admission bypass fail. Unadmitted accounts retain sign-out/revocation access.

References: [single host page](../user_experience/04_page_list.md#primary-pages), [host setup](02_frontend_architecture.md#host-setup-conversation), PRD AC-23, AC-25–26, AC-28. Calendar-informed onboarding must pass AC-28 before this phase exits.

### Phase 4 — Deliver requester negotiation and host review on web

- [x] Identify the private-preference checkbox CI failure as a 56px pointer target shift and add bounded field/scroll diagnostics with a privacy regression. The layout root cause and fix remain open. [Evidence](05_rebuild_evidence.md#private-preference-pointer-target-shift--2026-10-09).

- [x] Sync all six verified feasibility requirements into the [main capability specification](../../openspec/specs/meeting-feasibility/spec.md) and [archive the completed 12-task change](../../openspec/changes/archive/2026-10-09-evaluate-calendar-and-travel-feasibility/tasks.md). Live provider/device gates remain in their owning changes.
- [x] Complete feasibility task 3.3: record AC-02/03/12/27 integration evidence, verify both DST transitions through proposal agreement, and block booking after a neighboring event moves. Rebuild 96 local migrations and pass four integration suites using the shared evaluator. Live Google/device and browser reliability gates remain separate. [Evidence](05_rebuild_evidence.md#feasibility-integration-acceptance--2026-10-09).

- [x] Complete feasibility task 3.2: verify explicit private preference exception and two-leg travel allowance through requester evaluation and proposal selection, private-data redaction, separate agreement/approval authority and revocation invalidation. Fresh browser, service integrations, build and application checks pass; intermittent browser failures remain recorded. [Evidence](05_rebuild_evidence.md#private-review-to-requester-proposal-acceptance--2026-10-09).

Incremental completion (full phase exit remains open):

- [x] Reject new requester agreement at or after proposal start using the database wall clock after lock waits; disable browser/MCP agreement, retain completed retries and historical decisions, and verify real near-future evaluation, lock races and delayed browser refresh. [Evidence](05_rebuild_evidence.md#requester-agreement-start-cutoff--2026-10-09).
- [x] Deploy the agreement start cutoff (`b849354`; `dpl_3hs3dj69ynetPpK91uZbA6NCss7f`), verify 92 matching migrations, identical tested function bodies/security settings, rollback-only production behavior, clean advisors and 48 HTTP checks. [Evidence](05_rebuild_evidence.md#requester-agreement-start-cutoff--2026-10-09).

- [x] Implement and locally verify the bounded requester contact-proof core: encrypted code/hash records, current guest/contact authority, attempt/cooldown/hourly limits, immutable replay, atomic verification and legacy bypass denial. Controlled live inbox acceptance is recorded in the [completed change](../../openspec/changes/archive/2026-10-08-verify-requester-contact/tasks.md).
- [x] Deploy the contact-proof core and verify production replay/lockout/legacy guards, zero rollback fixtures, 62 matching migrations, clean advisors and 43 HTTP checks (`447b6ec`; deployment `dpl_6XpELzEtVY4sGJWKxNmAe5WooS84`; [evidence](05_rebuild_evidence.md#bounded-requester-contact-proof-core--2026-10-08)).

- [x] Complete controlled production recovery acceptance: verify contact through a received code, receive one recovery email, explicitly restore in a separate browser session, reject the old credential and resume after reload without login/meeting authority. Remove controlled fixtures, sync the requirements and archive the recovery change. [Evidence](05_rebuild_evidence.md#live-requester-recovery-acceptance--2026-10-08).
- [x] Deploy booking-page recovery and aggregate issuance limits (`585e8da`; deployment `dpl_J8tB91sQvsFWkgtZkpioCwii6ELf`); verify 72 matching migrations, clean security advisors, 72 HTTP guards and seven public-document checks. Controlled live delivery/redemption remains open. [Evidence](05_rebuild_evidence.md#requester-recovery-browser-and-issuance-limits--2026-10-08).
- [x] Implement booking-page recovery issuance and explicit fragment redemption with strict same-origin routes, HttpOnly replacement cookies, aggregate recipient/service limits and generic feedback. Verify lost-response retry identities, cancellation, expired/invalid proof, old-token denial, unrelated-cookie preservation and 320px/200% layouts in the full browser journey; controlled live acceptance remains open.
- [x] Deploy recovery delivery and its minute scheduler (`ed5f59b`; deployment `dpl_HjokoYbH8wHJqHY1mr1x63xbgX6C`), verify 71 matching migrations, rollback-only dispatch/suppression checks, clean advisors, 64 HTTP guards and authenticated idle execution. [Evidence](05_rebuild_evidence.md#durable-requester-recovery-delivery--2026-10-08).
- [x] Implement fenced Cloudflare recovery delivery with encrypted frozen content, current-contact/proof rechecks, one dispatch grant, bounded pre-send retries and honest uncertain outcomes. Verify concurrent workers, lost responses, stale proofs and expiry; all 26 integration tests pass. Public recovery controls and live acceptance remain open.
- [x] Deploy recovery authority and disable legacy recovery commands (`099ea03`; deployment `dpl_2fmXBAdN3yqyEi1P6RcALGMPH6R7`). Verify 70 matching migrations, rollback-only credential/replay isolation, clean advisors and production HTTP regressions. [Evidence](05_rebuild_evidence.md#requester-recovery-authority-foundation--2026-10-08).
- [x] Implement the service-only requester recovery foundation with generic bounded issuance, verified-contact proof, atomic credential rotation, permanent invalidation and exact lost-response replay. Real-database concurrency/isolation tests and 1,020 SQL assertions pass; delivery, browser controls and live recovery remain open in [the recovery tasks](../../openspec/changes/archive/2026-10-08-recover-requester-access/tasks.md).
- [x] Implement and locally verify encrypted Cloudflare contact-code delivery, one dispatch grant, challenge/recipient rechecks, duplicate/expired-worker recovery and honest uncertain outcomes. Add the authenticated endpoint and minute scheduler ([evidence](05_rebuild_evidence.md#durable-requester-verification-email--2026-10-08)).

- [x] Deploy contact-code delivery, verify 63 matching migrations, production RPC guards, 44 HTTP checks and the authenticated idle endpoint, then configure the scheduler after empty-queue inspection (`e2ce85e`; deployment `dpl_5h2Sz9cGge14ZhfEhyYJ6ZmiqBeq`; [evidence](05_rebuild_evidence.md#durable-requester-verification-email--2026-10-08)).

- [x] Add protected requester contact state/send/confirm routes and the inline verification card; verify exact retry, reload, changed email, delivery uncertainty, expiry, lockout and keyboard/mobile recovery. Complete the local public-intake/code-delivery/verification/host-approval journey with synthetic Cloudflare delivery ([evidence](05_rebuild_evidence.md#requester-contact-verification-controls--2026-10-08)).

- [x] Deploy requester verification controls and verify 49 production HTTP checks, including credential/CSRF/no-store guards, plus healthy scheduler configuration and an empty pending queue (`9990177`; deployment `dpl_5AJxaAx4erYLfrYfqo3yMj2pFpX1`; [evidence](05_rebuild_evidence.md#requester-contact-verification-controls--2026-10-08)).

- [x] Verify production browser → scheduled Cloudflare delivery → controlled inbox → browser code proof, with one dispatch and no booking authority; remove the isolated fixture, sync the behavioral spec and archive contact verification ([evidence](05_rebuild_evidence.md#controlled-live-contact-inbox-acceptance--2026-10-08)).

- [x] Implement and test the identity-only requester Google provider adapter, including real signed-JWT verification and contact-authority distinctions. Browser/state binding, prefill, manual skip and live acceptance remain open ([design](../../openspec/changes/connect-google-calendars/design.md#requester-identity-adapter-2026-10-08)).

- [x] Implement and locally verify durable requester identity binding, saved drafts, single-use callbacks, current-authority rechecks and exact-recipient contact proof. Browser controls and live Google acceptance remain open; see the [state design](../../openspec/changes/connect-google-calendars/design.md#durable-identity-state).

- [x] Deploy the requester identity backend and verify 64 matching migrations, production proof/replay/revocation guards, anonymous RPC denial and 49 HTTP checks (`d96f241`; deployment `dpl_7H7pFr1j14ToJ4etQC6F24cQNLe5`; [evidence](05_rebuild_evidence.md#durable-requester-identity-binding--2026-10-08)).

- [x] Implement optional requester Google/manual browser controls, marked callback dispatch, editable prefill, saved draft/timezone restoration and explicit matching-recipient proof. Verify signed-provider browser fixtures, denial/replay/isolation, account switching, third-party/alternate email, lost responses and accessible layouts. Live Google/iPhone and the remaining timezone/Calendar acceptance stay open.
- [x] Preserve explicit requester timezone choices across tab reloads and Google returns; add candidate/proposal display conversion with date-specific offsets and no scheduling mutation. Verify cleared/invalid zones, DST, storage restrictions and unchanged candidate/revision/decision state. Controlled live Calendar and iPhone acceptance remain open.
- [x] Deploy timezone preservation/display conversion and verify the Ready production alias plus 57 HTTP guards and invalid-identity callback rejection (`a5b1400`; deployment `dpl_44KK7JaipwvJnZP5mUiB8Q5ThTw5`; [evidence](05_rebuild_evidence.md#requester-timezone-display-and-reload-preservation--2026-10-08)).

- [x] Deploy optional requester Google/manual controls and verify 57 HTTP guards plus safe invalid-callback routing (`059f023`; deployment `dpl_CKWWaaCPjYw9pojf1sjsQYsyZmMj`; [evidence](05_rebuild_evidence.md#requester-google-identity-browser-controls--2026-10-08)).

- [x] Implement and verify explicit requester withdrawal and host decline, including minimal closure status, lost-response recovery and booking uncertainty (1,004 SQL assertions, 18 integration tests, browser/recovery checks).
- [x] Deploy request closure and verify the selected production database/API boundaries (`3e5db21`; deployment `dpl_5Y2wqC5PujgFL3GHUqtim1kjDw8u`; [evidence](05_rebuild_evidence.md#explicit-withdrawal-and-decline--2026-10-07)).

Work:

- [ ] Implement public `/{handle}` intake and creation of a request-scoped continuation at `/booking/[bookingId]`; exchange private-link credentials securely and remove secrets from URLs after exchange. Define expiry, recovery and revocation without requiring requester signup.
- [ ] Offer optional Google identity with validated name/email prefill and inline manual name/email entry; verify contact before trusted recovery/invitation use. Keep request authority separate from identity and Calendar grants. Use browser-detected IANA timezone with a visible selector, retain explicit choices, and avoid redundant confirmation prompts; test DST, account switching and bound callback resumption.
- [ ] Collect/clarify contact, purpose, duration, availability, timezone, mode and location. Build candidate cards, alternatives, withdrawal and versioned requester agreement.
- [ ] Implement optional requester Calendar availability with separate minimum scopes, selected calendars and request-bound consent. Failed reads pause dependent scheduling until reconnection or explicit manual/agent availability replaces them.
- [ ] Apply deterministic host/requester busy intervals, rules, focus blocks, duration and buffers before model ranking. For physical meetings check both travel legs with Google Routes; missing locations or failed routes require clarification or an explicitly confirmed manual allowance.
- [ ] Surface selected requests/current proposals inside `/app`; preserve private versus shared projections and display explicit revision-bound decision controls. Request IDs supplied by UI or notification entry always undergo authorization.

Exit: two independent host/requester pairs negotiate without cross-reading history or private Calendar details. Test ambiguous dates/DST, no-match, unsupported travel, invalid model output, stale candidate/proposal results, requester Calendar denial/revocation and withdrawal. Both pages show the same authoritative proposal version.

References: [requester destination](../user_experience/04_page_list.md#requester-booking-destination), [availability processing](01_backend_architecture.md#6-conversation-and-availability-processing), PRD AC-01–05, AC-12–13, AC-27.

### Phase 5 — Complete approval, booking and invitations

- [x] Complete booking task 3.3: verify 43 actual process-crash/lost-wakeup cases, including blocked checks, definitive rejection, uncertain/conflicting evidence, retry persistence and reconciliation refresh. Combine with duplicate delivery, withdrawal/dispatch lock races and competing reservations to verify one event identity. [Evidence](05_rebuild_evidence.md#booking-failure-boundary-acceptance--2026-10-09). Live Calendar task 3.4 remains open.

- [x] Add 23 actual worker-process crash/recovery cases across claim, evaluation, refresh, credential access, dispatch, insert, lookup, outcome persistence and duplicate acknowledgment, plus lost wake-up recovery. Verify one frozen identity and conservative uncertainty. Broader failure-branch termination coverage in task 3.3 and live task 3.4 remain open. [Evidence](05_rebuild_evidence.md#booking-worker-process-crash-matrix--2026-10-09).

- [x] Complete booking task 1.3 by auditing desired SQL/migrations, the fresh 96-migration rebuild, transactional publication and uncertain-state tests. Verify matching local/production RLS and direct-access denial across 11 tables, plus six matching service-only booking RPC definitions. [Evidence](05_rebuild_evidence.md#booking-schema-acceptance-audit--2026-10-09).

- [x] Complete booking task 2.4: verify authenticated Calendar disconnect/denied/wrong-account/original-account recovery, frozen destination after new selection, guarded retry and operator override denial. Rebuild all 96 migrations and pass booking/SQL checks with transactional fixture cleanup. [Evidence](05_rebuild_evidence.md#consent-based-booking-recovery--2026-10-09).

- [x] Complete booking task 2.1 with a 15-scenario final revalidation matrix: 13 blocked prerequisite cases and successful requester-Calendar/in-person controls through actual approval and worker services. Verify no rejected case dispatches or publishes confirmations; full booking integration, 1,532 SQL assertions and application checks pass. [Evidence](05_rebuild_evidence.md#booking-final-revalidation-matrix--2026-10-09).

- [x] Deploy the booking lock-order migration (`3e2ade9`, `20261008231233`) to FindMeATime2; verify 96 matching migrations, matching tested function/privileges, clean security advisors and 70 production HTTP guards. [Evidence](05_rebuild_evidence.md#booking-identity-and-host-lock-acceptance--2026-10-09).

- [x] Complete booking task 1.2: align retained host/attempt locks, verify real lock waits and expired ownership, and exercise overlapping approved requests through one pending insert and confirmed-local revalidation. Verify stable identities, immutable snapshots and scoped fixture cleanup with the 96-migration rebuild and 1,532 SQL assertions. [Evidence](05_rebuild_evidence.md#booking-identity-and-host-lock-acceptance--2026-10-09).

- [x] Complete the operator recovery runbook acceptance (booking task 2.5): actual CLI replay, definite rejection/retry, lost successful insert response, initial not-found with retained reservation, and eventual same-event confirmation without replacement insertion or state-forcing. [Evidence](05_rebuild_evidence.md#operator-lost-response-recovery-acceptance--2026-10-09). Live Calendar and broader fault coverage remain open.

Incremental completion (full phase exit remains open):

- [x] Implement and locally verify the project-pinned operator retry/reconcile CLI, immutable approval continuity across recovery revisions, same-command replay and guarded worker execution. Verify the 61-migration rebuild, SQL/integration/application suites and browser/runtime recovery. Complete reconnect and fault-matrix acceptance remain open.
- [x] Deploy recovery approval continuity and verify the production evaluator matches the tested definition, service-only command grants, 61 matching migrations, clean advisors and 43 HTTP checks (`6c5675e`; deployment `dpl_E5WuW6vcsAdsjCfVDU694ZjNrpUS`; [evidence](05_rebuild_evidence.md#operator-recovery-and-approval-continuity--2026-10-08)).

- [x] Implement and locally verify withdrawal/decline until persisted Calendar dispatch, with atomic prepared-attempt retirement, reservation release, both deterministic lock races, expiry after waits and browser retry recovery. Verify the 60-migration rebuild, SQL/integration/application suites, builds and browser/recovery/runtime checks. Production verification is recorded separately.
- [x] Deploy the withdrawal cutoff and verify both production closure boundaries, 60 matching migrations, clean security advisors and 43 HTTP checks (`50021f8`; deployment `dpl_6dXLH6X4jN5yB9xNwDXQsppHUVtN`; [evidence](05_rebuild_evidence.md#withdrawal-at-the-calendar-dispatch-cutoff--2026-10-08)).

- [x] Implement and locally verify fenced booking-email delivery, independent failure/retry status, actual Calendar organizer and receipt-only email links. Verify 59-migration reset, 1,012 SQL assertions, 19 integrations, 150 app/provider tests, browser/recovery/runtime checks and email/receipt reflow. Controlled live inbox acceptance remains open.
- [x] Deploy booking-email delivery and receipt-only links, verify production guards and 43 HTTP checks, and activate the inspected minute scheduler (`d332d48`; deployment `dpl_816vv1WL32XtHwCdwDS6JETPWqQW`; [evidence](05_rebuild_evidence.md#fenced-booking-confirmation-delivery--2026-10-07)).

- [x] Implement and unit-test the Cloudflare transactional transport with a fixed sender/account, bounded responses, intended-recipient acceptance evidence and no automatic retry after uncertain responses. Durable booking delivery, live inbox acceptance and production activation remain open.

- [x] Implement and verify the protected host/requester confirmed receipt from the frozen booking snapshot, with audience-specific delivery status, safe links, expiry/rotation enforcement and browser reflow coverage. Full notification delivery remains open.
- [x] Deploy the protected receipt API/UI and verify production authority boundaries and 40 HTTP regressions (`a4105bc`; deployment `dpl_7dnnS7WAEs2F8yu5uHjx5n4kpoms`; [evidence](05_rebuild_evidence.md#protected-confirmed-receipt--2026-10-07)).

- [x] Implement and locally verify automatic booking execution, exact-identity recovery, atomic completion/outbox and host-before-attempt operator locking; pass 57-migration reset, 1,012 SQL assertions, 19 integration tests, browser/recovery/runtime checks and both builds.
- [x] Deploy the booking worker migration/endpoint, verify production guards and activate its inspected minute scheduler (`02d8823`; deployment `dpl_6nUUbnfkfCCXY9av81o32CzoAWjf`; [evidence](05_rebuild_evidence.md#automatic-booking-worker--2026-10-07)).

- [x] Implement and verify frozen Calendar insert/reconciliation transport with exact event identity, minimized evidence and conservative uncertain-write outcomes.
- [x] Deploy the verified transport step and check production regressions (`6a9a146`; deployment `dpl_HjWETgpGgMuj5R64buNozSyLN4X3`; [evidence](05_rebuild_evidence.md#frozen-calendar-booking-transport--2026-10-07)). Explicit approval, fenced worker dispatch and live booking acceptance remain in the work below.
- [x] Implement and verify exact-version authenticated web approval, immutable replay, a separate confirmation card and atomic pending-booking job creation.
- [x] Consume fresh lease-bound evidence at an immutable dispatch cutoff; verify concurrent dispatch, stale evidence, changed decisions and retained reservations. Document approval attribution, pending UI and lost-response recovery; the automatic runner and reconciliation remain open.
- [x] Deploy the saved-evidence dispatch gate and verify production role/lease guards, Ready deployment and 37 HTTP checks (`465cb3f`; deployment `dpl_FeUsfb13praK5LpfhvpcNPUs9Tss`; [evidence](05_rebuild_evidence.md#saved-evidence-booking-dispatch--2026-10-07)).
- [x] Add lease-authorized booking evaluation that reuses current Calendar/time/travel/preference checks, verifies the frozen writable destination and binds evidence to the current worker; verify the 55-migration rebuild, integration/browser/recovery suites and both service builds. Dispatch consuming this evidence remains open.
- [x] Deploy booking evaluation and verify the production database boundaries, Ready service deployment and 37 HTTP regressions (`390ebc2`; deployment `dpl_8PoQRPa9BkmeeqJfuTsK3CNGVNgB`; [evidence](05_rebuild_evidence.md#lease-authorized-booking-evaluation--2026-10-07)).
- [x] Reject expired booking workers after lock waits and at dispatch; verify six real lease-expiry scenarios, a full 54-migration local rebuild, 1,012 SQL assertions and 19 integration tests. Full worker revalidation and execution remain open.
- [x] Deploy the lease fencing migration to the selected production database and verify expired-owner rejection, unchanged job status, private worker access and zero remaining probe records (`1d8a277`; [evidence](05_rebuild_evidence.md#booking-lease-expiry-after-lock-waits--2026-10-07)).
- [x] Deploy the browser approval step and verify selected production schema/API boundaries (`1c9e0ed`; deployment `dpl_41zwLcJcs5EWn59vhTbHTJq8gMPE`; [evidence](05_rebuild_evidence.md#exact-version-browser-host-approval--2026-10-07)).

Work:

- [ ] Record explicit host confirmation of the current proposal, including any permitted exceptions, independently of model prose. Require current requester agreement; revisions invalidate applicable prior decisions.
- [ ] Implement the booking worker: coordinate per-host reservations, re-read required calendars, recheck versions, persist exact destination/payload/event ID before dispatch and reconcile uncertain outcomes against that same event.
- [ ] Distinguish pre-dispatch rejection, pending/uncertain write, confirmed booking and delivery failure. Lease expiry cannot release an uncertain reservation or justify a new event identity.
- [ ] Produce one confirmed-event receipt and a Cloudflare Email Service transactional outbox. Align HTML/plain email, Calendar invitation and protected receipt on final details, **View booking**, and **Join meeting** where valid. Keep service email sender distinct from the Calendar organizer.
- [ ] Keep credentials and private history out of shared Calendar descriptions; RSVP metadata is not approval. Define provider invitation versus application email delivery ownership. If emitting ICS, verify stable association and no duplicate event alongside provider invitations.

Exit: a controlled full web journey produces one confirmed event and consistent receipt/invitations. Inject crashes before/after dispatch, successful create with lost response, stale approvals, concurrent requests, duplicate approval and failed confirmation delivery. Uncertainty stays visible, and delivery retry never creates a second event. Closed requester credentials expose only the permitted status/receipt until expiry; no automatic reschedule/cancel is added.

References: [booking algorithm](01_backend_architecture.md#7-approval-to-booking), [invitation presentation](../user_experience/03_interfaces.md#booking-confirmation-email-and-calendar-invitation), PRD AC-06–11, AC-13.

### Phase 6 — Add requester email continuity

- [x] Deploy verified parent-quotation readback (`5636381`; deployment `dpl_DxsJ2S6TKhoFUeVG8gsDB5MHnrsT`) and verify Ready production, 73 HTTP guards, seven public documents and disabled ingress. [Evidence](05_rebuild_evidence.md#verified-agentmail-parent-quotation-readback--2026-10-08).

- [x] Verify appended reply quotations against a separately fetched exact parent, preserving frozen sends and replay identity. Real stored-reply inspection now passes; forged or unavailable parent evidence stays uncertain. [Evidence](05_rebuild_evidence.md#verified-agentmail-parent-quotation-readback--2026-10-08). Full signed requester continuity remains open.

- [x] Probe real reply acceptance and stable-key replay in the controlled project inbox; record the provider-added quotation that prevents exact-body readback. Add a regression preserving uncertainty. This does not complete live requester continuity. [Evidence](05_rebuild_evidence.md#live-agentmail-reply-compatibility-probe--2026-10-08).

- [x] Deploy accepted outgoing-parent continuation (`9f84641`; deployment `dpl_CAvyjbDtux1U1kD5yx2uvqP6CTwJ`); verify remote admission/execution, uncertainty and revocation denial, zero probe residue, clean advisors and 73 production HTTP guards. [Evidence](05_rebuild_evidence.md#accepted-outgoing-requester-email-parents--2026-10-08). Controlled live mailbox acceptance is the remaining reply-change gate.

- [x] Accept signed requester continuations referencing provider-accepted service replies through one admission/execution provenance check. Verify current-link/inbox/receiver/thread isolation, earlier-source/first-attempt ordering, uncertain/unsent/suppressed denial and revocation with 1,108 SQL assertions and 26 integrations. Reconcile the pending binding spec; controlled live acceptance remains open.

- [x] Deploy the fenced requester reply worker (`8c9bff4`; deployment `dpl_3yQUayzRiFee2aoNKUm5TYN7YJFE`), verify rollback-only remote recovery/lease/suppression, clean advisors, 73 HTTP guards and the installed scheduler with zero enabled receivers. [Evidence](05_rebuild_evidence.md#fenced-requester-email-reply-delivery--2026-10-08).

- [x] Implement requester reply delivery with durable two-minute leases, final current-authority checks, frozen retry identity and first-attempt deadline, ordered uncertainty and a private scheduled worker. Verify 74-migration rebuild, 1,085 SQL assertions, 26 integrations including lost-response recovery and two real lock-expiry cases, 204 app/provider tests, both builds and browser regression. Outgoing-parent authorization and controlled live acceptance remain open.

- [x] Deploy atomic requester email reply capture (`ee4ca15`; deployment `dpl_3Vi6ofPGtPidC5FcjxmdwTYcgcH4`) and verify remote rollback-only immutability/suppression, zero remaining fixtures, clean security advisors and 72 production HTTP guards. [Evidence](05_rebuild_evidence.md#atomic-requester-email-reply-capture--2026-10-08).

- [x] Implement atomic private reply capture at runtime settlement with frozen destinations/content, concurrent replay preservation, invalid-output rollback and revoked/expired suppression. Verify 73-migration rebuild, 1,059 SQL assertions, 26 integration tests, application checks, both builds and browser regression. Delivery claims, outgoing-parent continuation and live acceptance remain open in [the reply change](../../openspec/changes/deliver-requester-email-replies/tasks.md).

Incremental completion (full phase exit remains open):

- [x] Deploy the verified reply-transport revision (`a304753`; deployment `dpl_F7QyXxJJq31XRybAdwzk8JJ7RCXz`), verify 72 production HTTP guards, seven public documents and disabled live ingress. No outbound route is enabled. [Evidence](05_rebuild_evidence.md#bounded-agentmail-reply-transport--2026-10-08).
- [x] Implement and verify the AgentMail reply transport with one frozen recipient/parent, stable idempotency key, bounded replay window, current-authority preflight and exact acceptance readback. Eight provider tests pass; durable outbound queue/runtime integration and live full-email continuity remain open.
- [x] Deploy signed routing-context enforcement (`f722a0e`; deployment `dpl_5c52qhnSqFJJNeM4vEaPLuDndCvN`), verify rollback-only parent isolation, 68 matching migrations, clean advisors and production regressions. [Evidence](05_rebuild_evidence.md#signed-requester-email-routing-context--2026-10-08).
- [x] Require signed application-recipient and reply-parent context for requester email, anchor continuation to an earlier authenticated receipt in the same link, and recheck that context for runtime grants. Signed-message tests, real-database integration and the full browser regression pass; positive live acceptance remains open.
- [x] Deploy the email execution worker and migration (`1300236`, `24d0aa6`; deployment `dpl_By9j8FNvBNrS1JhYYwb2S4bWg7es`), verify rollback-only current-authority isolation, clean advisors and 63 production HTTP guards. Live receiver enablement remains gated on controlled acceptance. [Evidence](05_rebuild_evidence.md#requester-email-worker-execution--2026-10-08).
- [x] Connect leased email ingress to protected binding and shared requester runtime preparation. Verify current email grants at output/tools, same-thread ordering, restart after saved preparation, one runtime input after a lost dispatch response, stale-lease rejection and queue acknowledgment. Binding text never enters model/history; controlled live acceptance and outbound replies remain open.
- [x] Deploy protected email-link controls (`27e507e`; deployment `dpl_CyPendCA95zhAVBu2WgmAXj8jj2X`); verify all 62 production HTTP guards, public documents and disabled live ingress. [Evidence](05_rebuild_evidence.md#protected-requester-email-controls--2026-10-08).
- [x] Add protected requester email-link state/start/revoke routes and accessible controls with exact retry identities, reload recovery, secret removal after binding/revocation/expiry and unavailable web fallback. The full browser journey verifies these cases and private/no-store, anonymous and CSRF boundaries. Worker routing and live acceptance remain open.
- [x] Deploy the email-binding foundation and migration (`a361d82`; deployment `dpl_6jzUZ4cJy6FouqC7uv7kidz2DykE`); verify rollback-only remote isolation, clean security advisors and production regressions while live ingress remains disabled. [Evidence](05_rebuild_evidence.md#protected-requester-email-binding-foundation--2026-10-08).
- [x] Implement the protected requester email-binding foundation: current verified-contact enrollment, encrypted replay recovery, independently authenticated binding, permanent invalidation and receipt-scoped authority references. Concurrent/lost-response and receiver/revocation integration cases and 1,019 SQL assertions pass. Browser controls, worker routing and positive live acceptance remain open in [the change tasks](../../openspec/changes/bind-requester-email/tasks.md).
- [x] Deploy independent author-evidence primitives and the gRPC security patch (`715b72b`, `d40963b`; deployment `dpl_BbBDptFPYouJyuz5qAHQi5F1qFvM`); verify production regressions and disabled live ingress. [Evidence](05_rebuild_evidence.md#independent-agentmail-author-evidence--2026-10-08).
- [x] Implement bounded raw-message retrieval and independent DKIM author evidence; verify cryptographic fixtures and the controlled live rejection of an unsigned Message-ID. This is domain evidence only; protected request/channel binding and positive live requester acceptance remain open.
- [x] Deploy the message-reader increment and mailbox ambiguity correction (`006730b`, `04b33b6`; deployment `dpl_9crTVuUy75S8BpKBVxVdjsSZv7Qx`); verify retained production access guards and disabled ingress. [Evidence](05_rebuild_evidence.md#agentmail-full-message-reader--2026-10-08).
- [x] Implement bounded full-message reads with exact receipt identity, restricted-label rejection, explicit unavailable text and untrusted address claims. Six contract tests and a controlled read-only provider probe pass; authorized dispatch and live continuity remain open.
- [x] Implement the fenced durable AgentMail receiver with atomic receipt/job publication, concurrent replay deduplication, conflicting identity rejection, lost-response recovery and private grants. Local rebuild, 1,019 SQL assertions and focused integration tests pass; downstream routing remains open.
- [x] Deploy durable ingress and its additive migration; verify remote rollback isolation, empty production registry, security advisors and production denial/regression checks (`db5a454`; deployment `dpl_9P6GCBqaxExwosF5GHWsG7zrWxjU`; [evidence](05_rebuild_evidence.md#agentmail-durable-receiver--2026-10-08)).
- [x] Verify AgentMail raw-body signatures with pinned Svix 2.7, five-minute freshness, one-MiB/five-second read bounds, inbox/thread isolation and minimized event/message locators. Test changed payloads, rotation signatures, omitted bodies and rejected delivery classes. Durable inbox deduplication is covered by the receiver increment above; sender/request binding and live dispatch remain open.
- [x] Deploy the tested AgentMail verification dependency/boundary without exposing an ingress endpoint; verify Ready production, retained public documents/access guards and no acknowledgment of unbound AgentMail events (`7910387`; deployment `dpl_HSgcyxzEwPDfz9PF4xbVL3Szw8Go`; [evidence](05_rebuild_evidence.md#agentmail-authenticated-transport-boundary--2026-10-08)).

Work:

- [ ] Finalize AgentMail inbox allocation, provider authentication, sender evidence, request/thread mapping and allowed recipients. Store and deduplicate authenticated ingress before acknowledgment.
- [ ] Dispatch to the requester's authorized eve context and share domain state with their protected web conversation. Unknown/forwarded/ambiguous threads must not unlock an existing request.
- [ ] Implement bounded reply/notification delivery, frozen recipients/payloads, retry identity and uncertain-send recovery using verified provider capabilities. Keep transactional mail in the Cloudflare adapter.

Exit: a controlled multi-turn email request continues on web and returns to email with the same proposal/status. Delayed/replayed messages, changed recipients, revocation, restart during dispatch and lost send responses do not leak data or repeat domain effects. Record actual received/replied/delivered evidence separately from provider acceptance.

References: [email direction](01_backend_architecture.md#email-provider-direction), [inbox/outbox](01_backend_architecture.md#8-jobs-inbox-and-outbox), PRD AC-01, AC-05, AC-09–11.

### Phase 7 — Add verified host iMessage continuity

- [x] Deploy native contact sharing (`49a9f04`; deployment `dpl_BNquS32WpumCMg2JTxPq5K5MFEjn`), verify all 107 migrations, private RPC/RLS guards, scheduler, release alias and twenty HTTP checks. Configure the verified existing Photon project credentials for production while preserving inactive receivers. [Evidence](05_rebuild_evidence.md#native-contact-sharing-production-rollout--2026-10-09). Authorized iPhone/profile acceptance remains open.

- [x] Add protected optional contact-card controls with exact retry identity, safe status recovery, link replacement fencing and truthful acceptance/uncertainty. Pass all four browser tests, 378 app/provider tests, two contact integrations, 1,830 SQL assertions, both builds and runtime guards; update product/UX/setup documentation. [Evidence](05_rebuild_evidence.md#optional-contact-card-browser-controls--2026-10-09). Production rollout and authorized device/profile acceptance remain open.

- [x] Wire protected native contact delivery, minute scheduled recovery and a separate read-only `diagnostics --contacts` mode. Verify process kills at claim/dispatch/provider/finish boundaries, lost wakeup, preflight unlink and no repeat uncertain share; pass 376 app/provider tests, four related integrations, all 1,830 SQL assertions, both builds and eight-route preview denial. [Evidence](05_rebuild_evidence.md#contact-sharing-worker-and-recovery--2026-10-09). Browser controls, production rollout and authorized iPhone acceptance remain open.
- [x] Implement the durable native contact-sharing foundation with one intent per verified link, strict host inputs, atomic audit/work, current route/session/admission guards and bounded recovery that never resends after dispatch. Rebuild 106 local migrations; pass 63 contact-sharing SQL assertions, all 1,810 SQL assertions after 49 integrations, 369 app/provider tests, typechecks and clean security advisors. [Evidence](05_rebuild_evidence.md#durable-contact-sharing-foundation--2026-10-09). Worker/scheduler, browser action, deployment and authorized device acceptance remain open.
- [x] Define the [optional native contact-sharing change](../../openspec/changes/offer-imessage-contact-card/proposal.md), including explicit host intent, saved private route, durable single dispatch and honest uncertainty. Strict OpenSpec validation passes; implementation and authorized device acceptance remain open.
- [x] Implement and verify the native Photon contact-sharing transport with exact-route and current-authority guards, no automatic resend, sanitized outcomes and preview denial. Pass 367 app/provider tests, the real Auth/linking integration, typechecks and all 1,747 SQL assertions. [Evidence](05_rebuild_evidence.md#native-contact-sharing-transport--2026-10-09). Durable intent, browser action, deployment and authorized device acceptance remain open.

Work:

- [ ] Implement the Spectrum adapter/bridge chosen in Phase 1 and scoped server authorization. Verify shared-pool target policy and actual sender route before live tests.
- [ ] Render iMessage linking directly in `/app` chat: Connect/Maybe later, inline phone entry, inline protected verification and server-verified connected state. Preserve retry/expiry/change-number and reload recovery without a settings dialog, route change or code in conversation/model/analytics data.
- [ ] From `/app`, send a short-lived six-digit code to the chosen private iMessage number; verify it in the initiating browser. Never return the code in a web response or model context. Add expiry, attempt/resend limits, replay protection, opt-in, conflict handling and unlinking.
- [ ] Resume the same host identity across web/private iMessage, with explicit request selection when ambiguous. Keep host-private context distinct from requester history and group conversations unauthorized.
- [ ] Implement current-proposal review/revise/decline and attributable approval. Ambiguous or stale replies require clarification or authenticated review in `/app`; generic agent/tool approval is insufficient.
- [ ] Offer the optional contact card from the verified sender route; contact saving does not grant identity or consent.

Exit: a linked host completes controlled private review, revision, fresh approval and a separate decline case. Wrong sender/browser/code, expired/replayed challenges, group input and unlinking deny access. Replayed approval after restart yields no second booking; a messaging outage leaves `/app` usable.

References: [linking direction](02_frontend_architecture.md#host-setup-conversation), [Photon configuration](03_provider_setup.md#photon), PRD AC-16–18.

### Phase 8 — Deliver skill entry, MCP, CLI and named clients

- [x] Verify the actual requester CLI against production: system-browser consent, private storage, scoped reads, draft retry/conflict, real refresh and revoke/logout. Confirm fixture cleanup. Host and full current-proposal/client acceptance remain open. [Evidence](05_rebuild_evidence.md#live-requester-cli-acceptance--2026-10-09).
- [x] Verify signed MCP host/requester review and booking-status parity through human approval, uncertain provider writes, reconciliation and confirmation; verify closure denies the requester grant while preserving the browser receipt. Controlled local providers only; live acceptance remains open. [Evidence](05_rebuild_evidence.md#mcp-booking-outcome-workflow--2026-10-09).
- [x] Deploy public MCP/source CLI instructions (`9535c80`; `dpl_HpRBaEM5C9Bd3732jABwq1D3sAhX`), verify Ready production, instruction version `2026-10-09.5` and 66 HTTP checks. Positive live host-profile and personal-agent acceptance remain open. [Evidence](05_rebuild_evidence.md#public-cli-entry-instructions--2026-10-09).
- [x] Implement strict internal agent-intake contracts: bounded clarification, explicit offset windows, rejected authority fields and unchanged existing OAuth acceptance. [Evidence](05_rebuild_evidence.md#agent-intake-contracts--2026-10-09). Creation and public activation remain pending; private authorization is tracked below.
- [x] Add and locally verify private intake storage with immutable host/browser/reserved-request bindings, one-way state constraints and serialized 30-per-host/300-service hourly admission counters. [Evidence](05_rebuild_evidence.md#agent-intake-storage-foundation--2026-10-09). Current-grant enforcement is tracked below; deployment remains pending.
- [x] Implement service-only intake consent/current-grant enforcement, immutable host binding, pending deadline, same-browser revoke and bound-request authority checks. Verify lock-wait expiry/revocation/readiness races, narrow refresh and denial across the legacy catalog. [Evidence](05_rebuild_evidence.md#agent-intake-database-authority--2026-10-09). HTTP/token integration is tracked below; deployment remains pending.
- [x] Integrate intake OAuth parsing, signed tokens and account-free browser grant/deny/revoke. Verify exact client/resource/PKCE, lost consent response, narrowed refresh, wrong-browser/request injection denial and readable 320px/200% consent. [Evidence](05_rebuild_evidence.md#agent-intake-oauth-and-browser-consent--2026-10-09). Initial creation, bound operations and production activation remain pending.
- [x] Extract and verify the shared server-side intake Calendar preflight, preserving encrypted host identity, refresh compare-and-swap, selected-calendar access and post-provider authority/version checks. Verify existing browser concurrent creation and lost-response recovery. [Evidence](05_rebuild_evidence.md#shared-intake-calendar-preflight--2026-10-09). Atomic agent creation is tracked below.
- [x] Complete intake task 2.1: reuse live Calendar preflight and the request insertion contract, atomically bind one reserved request, recover exact retries without another provider read, and reject changed intent, revocation and expiry during I/O or lock waits. Verify 99 local migrations, 1,660 SQL assertions, four affected integrations and both builds. [Evidence](05_rebuild_evidence.md#atomic-agent-intake-creation--2026-10-09). Bound operations, private browser handoff and production activation remain pending.
- [x] Complete intake task 2.2: resolve the bound request under the intake lock while retaining the original grant for authorization. Verify the full catalog rejects pending/foreign/host access, shared history and scheduling use the same binding, and rotation/closure/expiry/revocation deny reads and cached writes. Rebuild 100 migrations and pass 1,660 SQL assertions, four integrations, 340 app tests and both builds. [Evidence](05_rebuild_evidence.md#bound-intake-requester-operations--2026-10-09). Browser handoff and public MCP/CLI activation remain pending.
- [x] Complete intake task 2.3: install the original request proof only in the consenting browser’s HttpOnly cookie, preserve absolute expiry and receipt limits, and reject copied IDs, wrong browsers and CSRF. Verify lost-reply recovery, rotation/revocation, 101 local migrations, 1,660 SQL assertions, 342 app tests and the built browser flow. [Evidence](05_rebuild_evidence.md#private-intake-browser-handoff--2026-10-09). Public MCP/CLI and production activation remain pending.
- [x] Complete intake task 3.1: expose authenticated public-host context and one-request creation through MCP, preserving existing requester scopes and SQL binding. Verify the official SDK against the built browser app through account-free consent, clarification, lost committed creation/retry, foreign-request denial, scope narrowing and private handoff without booking-form entry. Pass three integrations, 1,660 SQL assertions, 343 app tests and both builds. [Evidence](05_rebuild_evidence.md#authenticated-mcp-intake-bootstrap--2026-10-09). CLI, named-client acceptance and production rollout remain pending.
- [x] Complete intake task 3.2: add public-handle CLI login with distinct intake identity and private storage; verify real CLI processes through loopback consent, clarification, lost creation response/retry, bound continuation, refresh, private browser handoff and logout. Confirm no access/refresh/browser secrets in argv/output and pass 345 app tests, 1,660 SQL assertions and both builds. [Evidence](05_rebuild_evidence.md#cli-intake-bootstrap--2026-10-09). Public instructions, integrated production rollout and named-client acceptance remain pending.
- [x] Complete intake task 3.3: publish source instruction version `2026-10-09.6` with pinned intake-capable CLI source, explicit fixed-host consent, clarification, one-request retry, bound continuation and truthful fallback. Align owning product/architecture/setup/CLI docs; verify both entry documents, 345 app tests, both builds and both sequential browser suites. [Evidence](05_rebuild_evidence.md#public-agent-intake-instructions--2026-10-09). Integrated production activation and full named-client acceptance remain pending.
- [x] Preserve the browser path from an expired consent page to current intake request access; verify keyboard navigation, unchanged private-cookie authority, all 345 app tests, both builds and both browser suites. Provision the dedicated production proof key without exposing its value. [Evidence](05_rebuild_evidence.md#expired-consent-return-and-intake-rollout-preparation--2026-10-09). Task 4.1 remains open for integrated deployment and acceptance.
- [x] Repair contact/recovery integration cleanup to remove active/archived queue entries and publication records before deleting fixture jobs with disabled FK triggers. Verify all 44 integrations and three runtime tests, rerun the four corrected suites followed by 1,660 SQL assertions, and pass typechecks/security advisors. [Evidence](05_rebuild_evidence.md#sequential-integration-queue-cleanup--2026-10-09).
- [x] Reconcile provider setup, backend, CLI and web documentation with the verified intake deployment; retain explicit fresh live Calendar creation, production CLI and named-client acceptance gaps. [Rollout evidence](05_rebuild_evidence.md#agent-intake-production-rollout--2026-10-09).

- [x] Deploy reviewed intake source `0fefa59` and five migrations to the selected production app/database; verify 101 matching migrations, 17 function definitions/privileges, clean advisors, Ready alias and 74 HTTP checks. Verify controlled OAuth/MCP clarification, exact retry, bound read, private handoff and revocation; confirm fixture cleanup. [Evidence](05_rebuild_evidence.md#agent-intake-production-rollout--2026-10-09). Fresh production creation through real Calendar preflight and task 4.1 completion remain open.
- [ ] Implement [agent-led initial intake](../../openspec/changes/enable-agent-request-intake/tasks.md): explicit one-host future-request consent, atomic initial creation, scoped continuation and MCP/CLI entry without manual booking-page data entry. Preserve protected MCP, browser-only secret handoff and separate host approval; verify and deploy before claiming AC-15/21/24.
- [x] Update both public skill documents with real MCP and pinned source CLI login/discovery/call/logout instructions, requester intake prerequisites, retry/recovery and browser fallback. Verify both endpoints locally without private profile leakage. Live positive host-specific and personal-agent entry acceptance remain open in task 3.3. [Evidence](05_rebuild_evidence.md#public-cli-entry-instructions--2026-10-09).

- [x] Wire the runnable CLI with ephemeral loopback browser login, private credential save/refresh, JSON MCP discovery/calls and revoke/remove logout. Verify listener cleanup and command lifecycle; document [commands and recovery](06_cli.md). Complete implementation tasks 3.1–3.2; production CLI journeys, public skill updates and named-client acceptance remain open. [Evidence](05_rebuild_evidence.md#runnable-cli-and-loopback-login--2026-10-09).

- [x] Implement the CLI OAuth protocol layer: fixed issuer/resource metadata, exact loopback registration, S256/state, single-use exchange, signed-token validation, refresh and revocation. Verify invalid callbacks/claims and uncertain exchange; listener, command wiring and live acceptance remain open. [Evidence](05_rebuild_evidence.md#cli-oauth-protocol--2026-10-09).

- [x] Implement private POSIX CLI storage with origin/grant isolation, atomic writes, cross-process refresh locks, durable uncertain-refresh state and retryable incomplete logout. Verify permissions, symlinks, scope/principal changes and two-process single refresh. Browser OAuth and runnable CLI remain open in task 3.2. [Evidence](05_rebuild_evidence.md#cli-private-credential-storage--2026-10-09).

- [x] Implement and verify the internal CLI MCP transport: bounded JSON input/output, official SDK discovery/invocation, fixed-origin bearer requests, sanitized exits, no redirect or mutation retry, and current revocation/scope failures. Runnable entry and credential lifecycle remain open in tasks 3.1–3.2. [Evidence](05_rebuild_evidence.md#cli-mcp-transport-foundation--2026-10-09).

- [x] Verify signed MCP requester availability draft/retry through explicit browser application, safe candidate/proposal reads, current-version human handoff, agreement without booking, revised/stale state and request revocation. Local provider fixtures remain distinct from live booking and client acceptance; task 2.4 stays open. [Evidence](05_rebuild_evidence.md#signed-mcp-requester-review-workflow--2026-10-09).

- [x] Verify the signed MCP host setup journey through agent draft/retry, explicit browser mode choice, stale review, provider permission recheck, concurrent agent revision, human confirmation, agent readback and logout revocation. This is local fixture evidence; complete task 2.4 and live host/provider acceptance remain open. [Evidence](05_rebuild_evidence.md#signed-mcp-host-setup-workflow--2026-10-09).

- [x] Preserve the selected host request/audience through Google sign-in and cancellation using a bounded local continuation hint. Verify real local PKCE callback success, retry, cookie consumption and agent-consent regressions. Deployed `2ab8c5f` and verified eight new plus 56 retained production checks. Full workflow task 2.4 remains open. [Evidence](05_rebuild_evidence.md#host-login-handoff-continuation--2026-10-09).

- [x] Deploy MCP scheduling/booking review (`8f85611`; deployment `dpl_4V88mYo6hbVHFco4giff2G89PuUn`), verify 87 matching migrations, rollback-only domain checks, clean advisors and 56 HTTP checks. Full workflow/client acceptance remains open. [Evidence](05_rebuild_evidence.md#mcp-scheduling-and-booking-review--2026-10-09).

- [x] Add MCP candidate/current-proposal and booking-status reads plus protected setup, connection and decision handoffs. Verify fresh/stale browser parity, current authority and no implicit decisions across 87 migrations, 1,403 SQL assertions, 264 app/provider tests, 30 integration tests and both browser suites. Complete tool task 2.3; full workflow, CLI and live client acceptance remain open. [Evidence](05_rebuild_evidence.md#mcp-scheduling-and-booking-review--2026-10-09).

- [x] Complete controlled live requester MCP acceptance: browser grant, official SDK discovery/read/draft/retry/decision handoff, role/target/scope denial, refresh narrowing and browser revocation. Verify no applied details or meeting decisions, remove fixtures/credentials and complete transport task 1.3 and protocol compatibility task 2.1. Full workflow, CLI, named clients and host Google acceptance remain open. [Evidence](05_rebuild_evidence.md#live-requester-mcp-acceptance--2026-10-08).

- [x] Deploy initial MCP transport (`2753753`; deployment `dpl_9Nh1NoY1JPKMjy5itXZhQpUEBcPH`) and verify Ready, eleven MCP/public-document checks, fourteen OAuth/browser guards and 28 retained public/login checks. Live granted tool calls remain open in task 1.3. [Evidence](05_rebuild_evidence.md#protected-mcp-transport--2026-10-08).

- [x] Implement the initial protected `/mcp` transport with official SDK 2.3.1, current bearer authority, strict origins/uploads and safe structured tool results. Verify official-client round trips, real PostgREST rotation denial, 249 app/provider tests, both builds and two browser suites. Public skill text now identifies partial coverage; production grant acceptance, full workflow/CLI and named-client gates remain open. [Evidence](05_rebuild_evidence.md#protected-mcp-transport--2026-10-08).

- [x] Define and test the internal seven-operation tool catalog with strict schemas, role discovery, scopes, retries and human-review descriptions. Create the full [MCP/CLI implementation change](../../openspec/changes/deliver-agent-tools-and-cli/tasks.md); public transport, complete workflow coverage and client acceptance remain open. [Evidence](05_rebuild_evidence.md#agent-tool-catalog--2026-10-08).

- [x] Deploy OAuth routes/consent (`23c274c`; deployment `dpl_4yXumcqvU6g7CsYBc6XyfCcFsCXC`) and browser-management migration. Verify the 81-migration production chain, rollback-only owner/privilege checks, fourteen OAuth/browser guards and retained public/private checks. Signing keys and live agent grants remain unprovisioned; activation is still open. [Evidence](05_rebuild_evidence.md#public-oauth-routes-and-browser-consent--2026-10-08).

- [x] Provision the production-only OAuth signing key, deploy activation, and complete controlled live requester browser/terminal deny/grant, exchange, refresh/narrowing, browser revocation and replay-family denial with negative resource/callback/PKCE and public-key audience/tamper checks. Remove fixtures and archive the verified authorization change. Public MCP/CLI, named-client and live host Google acceptance remain open. [Evidence](05_rebuild_evidence.md#live-agent-authorization--2026-10-08).
- [x] Deploy transactional agent operations (`5a81b62`; deployment `dpl_EjKrMymwqfTNDqTDhFyXVRaFcPoh`) and migration 82; verify remote privileges/rotation/projections, clean security advisors, fixture rollback and production HTTP guards. [Evidence](05_rebuild_evidence.md#transactional-agent-operations--2026-10-08).
- [x] Implement the transactional internal agent operation adapter with scope/target checks, current authority locks, namespaced retries, expiry rollback and browser-only human decision handoffs. Verify 241 app/provider tests, the 82-migration rebuild, SQL isolation, 30 integration tests and both browser suites. Authorization task 2.3 is complete; public MCP/CLI tools and signing-key activation remain open.
- [x] Deploy the internal credential foundation (`101840f`; deployment `dpl_DZrTjPF3y7cwKoCbKBbhcfJWnyTp`), verify Ready and all 14 production OAuth/browser guards. Signing activation and transactional operations remain open. [Evidence](05_rebuild_evidence.md#internal-agent-credential-boundary--2026-10-08).
- [x] Implement and unit-test the internal signed-token-to-agent-credential boundary: current grant binding, immutable process branding, expiry after authority lookup and separation from browser credentials. Transactional operation/scope enforcement remains open in authorization task 2.3.
- [x] Implement public OAuth discovery/registration/authorization/token/revocation adapters and explicit host/requester consent with safe Google return, same-code response recovery and owner revocation. Verify the 81-migration rebuild, 1,312 SQL assertions, 235 app/provider tests, 29 isolated integration tests, both builds and two browser suites with desktop/mobile visual checks. Authorization tasks 2.1–2.2 are complete; signing-key activation and protected operations remain open. [Evidence](05_rebuild_evidence.md#public-oauth-routes-and-browser-consent--2026-10-08).

- [x] Deploy internal OAuth HTTP/token-service adapters (`a36f571`; deployment `dpl_Gart61evCMuma3uGc2doweq8hL5K`); verify production Ready, retained 73 HTTP guards, eight namespace checks, seven public documents and disabled email ingress. Public OAuth activation remains open. [Evidence](05_rebuild_evidence.md#agent-oauth-http-and-token-service-adapter--2026-10-08).

- [x] Implement bounded OAuth HTTP input/error handling and the internal code/refresh/revocation service. Verify strict streaming deadlines, hashed credentials, current-grant signing checks and committed replay denial through local PostgREST, plus application checks and both builds. Public route integration remains open. [Evidence](05_rebuild_evidence.md#agent-oauth-http-and-token-service-adapter--2026-10-08).

- [x] Deploy reserved protocol handles (`3d9da4f`; deployment `dpl_5LLZqERJxdkvdgGWzzGTc2iXrriT`) and verify the production 80-migration chain, storage guard, eight namespace checks and retained public/private HTTP guards. Protocol endpoint implementation remains open. [Evidence](05_rebuild_evidence.md#reserved-protocol-handles--2026-10-08).

- [x] Reserve application/protocol handles across shared contracts, current/legacy setup, intake, requester identity and host storage after a zero-conflict production check. Verify the 80-migration rebuild, 29 namespace SQL assertions and built GET/POST/skill-document rejection at `/mcp` and `/oauth`. Full authorization task 2.1 remains open. [Evidence](05_rebuild_evidence.md#reserved-protocol-handles--2026-10-08).

- [x] Deploy the three OAuth lifecycle migrations from `8da0888`; verify the 79-migration production chain, rollback-only resource/PKCE/code/refresh/revocation probes, zero retained probe records, clean advisors and retained public HTTP guards. Public authorization and client-operation activation remain open. [Evidence](05_rebuild_evidence.md#durable-agent-oauth-grants--2026-10-08).

- [x] Implement the durable OAuth consent/grant/code/refresh lifecycle, current host/request authority, scope narrowing and replay revocation. Verify the 79-migration rebuild, 83 new SQL assertions and actual concurrent exchanges/rotations with expiry after lock waits. Authorization task 1.2 is complete; public routes, consent UI and operation integration remain open. [Evidence](05_rebuild_evidence.md#durable-agent-oauth-grants--2026-10-08).

- [x] Deploy registry migration `20261008115344` from `a6afcaf` to the selected production database. Verify rollback-only privilege/binding/limit checks, zero retained probe rows, clean advisors and retained HTTP guards. The existing web deployment remains Ready; token issuance is not activated. [Evidence](05_rebuild_evidence.md#agent-oauth-registry-and-consent-attempts--2026-10-08).

- [x] Add the private OAuth client registry, ten-minute browser-bound authorization attempts and atomic global/per-client budgets. Verify 73 new SQL assertions and real concurrent ceilings, expiry-after-lock and client-disablement tests. The grant/code/refresh lifecycle is tracked in the completion entry above. [Evidence](05_rebuild_evidence.md#agent-oauth-registry-and-consent-attempts--2026-10-08).

- [x] Deploy internal OAuth primitives (`f8de187`; deployment `dpl_E7ncuZJMsSaRESPB9Fjs3tutmny5`); verify Ready production, retained 73 HTTP guards, seven public documents, disabled email ingress and absent OAuth routes. Record the generic `/mcp` handle-shell collision for resolution before protocol activation. [Evidence](05_rebuild_evidence.md#agent-oauth-protocol-and-token-primitives--2026-10-08).

- [x] Implement internal resource/redirect/scope/S256 parsers and ES256 access-token verification under [agent client authorization](../../openspec/changes/archive/2026-10-08-authorize-agent-clients/tasks.md). Verify foreign/altered/expired tokens, key rotation and current-authority callbacks with ten focused tests, full application checks and both builds. Public protocol routes and durable grants remain open. [Evidence](05_rebuild_evidence.md#agent-oauth-protocol-and-token-primitives--2026-10-08).

Incremental completion (full phase exit remains open):

- [x] Deploy requester availability tools (`fd61aab`; `dpl_DCnsMnc2FcqTPqUxwcEASt22Ephq`), verify 85 matching migrations, rollback-only parity/draft checks, clean advisors and protected HTTP guards. [Evidence](05_rebuild_evidence.md#mcp-requester-availability--2026-10-09).
- [x] Add requester availability reads and window proposals to MCP, reusing browser projections and explicit details review; verify isolation, revisions, retry conflicts, browser application and preservation of failed Calendar state. [Evidence](05_rebuild_evidence.md#mcp-requester-availability--2026-10-09).
- [x] Deploy MCP conversation history (`cdf7801`; `dpl_39tvAnQp4GsKLfV4T6gH891bjWJh`), verify 84 matching migrations, rollback-only runtime resolution, clean advisors and protected route guards. [Evidence](05_rebuild_evidence.md#mcp-conversation-history-surface--2026-10-09).
- [x] Mount audience-safe MCP conversation history with encrypted bound cursors and reverified bearer relay; verify projected replies through the real eve restart fixture, cursor attacks and revoked denial. [Evidence](05_rebuild_evidence.md#mcp-conversation-history-surface--2026-10-09).
- [x] Implement the internal agent conversation authority resolver with strict audiences, current grant checks and runtime-binding isolation; verify SQL boundaries and expiry/revocation races. Public routing and end-to-end transcript acceptance remain open. [Evidence](05_rebuild_evidence.md#agent-conversation-authority-resolver--2026-10-09).
- [x] Add and verify the internal bounded runtime history reader, including captured-tail pagination, redacted events, cancellation and final authority checks. Agent authorization/routing and complete conversation-read acceptance remain open. [Evidence](05_rebuild_evidence.md#bounded-runtime-history-reader--2026-10-09).
- [x] Deploy host request discovery (`0e1f80f`; `dpl_9xbo7CetrUmSrKVgJx9NhsmPCpLd`), verify 83 matching migrations, production rollback probes, clean advisors and MCP/OAuth HTTP guards. [Evidence](05_rebuild_evidence.md#agent-host-request-discovery--2026-10-09).
- [x] Implement bounded MCP host request discovery with owned cursors, private-data redaction and current grant enforcement; verify pagination, browser parity, expiry and revocation races. Conversation reads and the full workflow remain open. [Evidence](05_rebuild_evidence.md#agent-host-request-discovery--2026-10-09).

- [x] Implement versioned root and per-host public Markdown entry routes on the reconstruction origin, current public-readiness checks, encoded profile data and honest browser fallback. Verify GET/HEAD, neutral unavailable/retry responses, no cookies/cache, fixed-origin links and public-field projection. Root-domain promotion and protected client integration remain open.
- [x] Deploy public skill entry and verify production GET/HEAD/POST behavior plus existing access guards (`df91af8`; deployment `dpl_JCbfDnWjD6B5xagyTdbgRKJ6sFX2`; [evidence](05_rebuild_evidence.md#public-agent-entry-documents--2026-10-08)).

Work:

- [ ] Serve `/SKILL.md` and `/{handle}/SKILL.md` with public instructions, versioning, missing-client recovery and no private state. Preserve both agreed paste-to-agent entry journeys.
- [ ] Implement the OAuth server/resource checks selected in Phase 1, bounded grants and grant/deny consent at `/connect/authorize`. Keep Google consent, application authorization, host admission and proposal approval distinct.
- [ ] Implement MCP tools and a thin machine-readable CLI over the same domain commands; support account-free request grants and authenticated host scopes. No client receives provider tokens or privileged database credentials.
- [ ] Record a compatibility row for each of Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code: tested version, discovery, connection, requester/host onboarding, continuation, refresh/revocation, current-proposal decision and recovery. Use direct host confirmation when in-client attribution cannot be established.

Exit: each named client passes its applicable requester and host journeys against the replacement. Wrong-audience/expired tokens, insufficient grants, revoked access, Google tokens masquerading as app credentials and fabricated host consent fail. Missing support is an explicit release gap, not inferred success from another MCP client.

References: [public skill entry](01_backend_architecture.md#public-skill-entry-documents), [interfaces](../user_experience/03_interfaces.md), PRD AC-14–15, AC-19–25.

### Phase 9 — Harden, deploy and close release gates

- [x] Extend the populated backup/restore drill to native contact acceptance, in-flight uncertainty, remembered retry aliases, claim budgets, frozen routes and post-restore session revocation. Verify exact contents across 89 tables in isolated containers, three passing restore tests and typechecks. [Evidence](05_rebuild_evidence.md#native-contact-sharing-restore-coverage--2026-10-09). Managed/full-runtime restore, snapshot-age effects and operational custody remain open.

- [x] Deploy accepted-receipt snapshot ordering from `d135901` (`dpl_HexyRfLkzhXDTouz1yzmPVRm9LuU`), verify pre-promotion service health, domain promotion, 15 composed production checks and two public pages. [Evidence](05_rebuild_evidence.md#receipt-ordering-production-deployment--2026-10-09). Hosted CI and broader release acceptance remain open.

- [x] Reproduce and fix a delayed pre-receipt snapshot overwriting newer accepted message status; retain the receipt until a fresh authorized read and verify normal later settlement. Pass the failing-before/passing-after browser regression, three browser suites, app/script/type/build/runtime/boundary checks and 1,747 SQL assertions. [Evidence](05_rebuild_evidence.md#accepted-receipt-and-delayed-snapshot-ordering--2026-10-09).

- [x] Deploy the historical-replay busy-state fix from `2ecf965` (`dpl_HE43YYm48ACEjCQUGBrMUsxgTk6c`); verify both services before promotion, the production domain, 15 runtime/access checks and two public pages. [Evidence](05_rebuild_evidence.md#historical-replay-fix-production-deployment--2026-10-09). Fresh hosted browser and live authenticated/device gates remain open.

- [x] Reproduce historical stream replay incorrectly disabling setup controls, and derive current UI busy state from saved pending application inputs instead. Verify the failing-before/passing-after browser regression and inverse pending-input case, all three browser suites, app/script checks, types/build/runtime smoke. [Evidence](05_rebuild_evidence.md#historical-replay-and-current-conversation-work--2026-10-09). Production and fresh hosted acceptance remain separate.

- [x] Preserve weekly time-control focus evidence and assert initial focus after deployed-source CI reproduced the keyboard failure. Verify privacy/type/browser checks; record passing companion CI without claiming resolution. [Evidence](05_rebuild_evidence.md#weekly-preview-keyboard-failure-evidence--2026-10-09). The intermittent weekly keyboard gate remains open.

- [x] Add a bounded public HTTP latency probe with first/repeat timing, explicit failure evidence and stop-on-challenge/rate-limit handling; pass four probe tests and diagnose the selected production Node probe’s Vercel edge challenge. [Evidence](05_rebuild_evidence.md#public-http-latency-probe-and-edge-challenge--2026-10-09). Complete baseline, numeric targets and authenticated/load performance acceptance remain open.

- [x] Deploy the inline iMessage size-container mitigation from `9e82305` to the selected production project (`dpl_Gaq4x8FwZU5ZQDupVZhyVxmN8ncz`), verify Ready/domain promotion, and pass 81 HTTP plus 15 composed runtime checks. [Evidence](05_rebuild_evidence.md#inline-imessage-mitigation-production-deployment--2026-10-09). Authenticated device/provider acceptance and full release readiness remain open.

- [x] Disable unused size-container behavior on the two inline iMessage form groups after reproducing zero-size mounted controls. Preserve focus/retry/privacy checks; verify eight fresh onboarding journeys, all three browser suites, app checks/builds/runtime smoke and 1,747 post-cleanup SQL assertions. [Evidence](05_rebuild_evidence.md#inline-imessage-size-container-mitigation--2026-10-09). Broader intermittent-browser and actual-device/provider acceptance remain open.

- [x] Verify the full pinned-stack CI run and accept the exact PostgreSQL version from CLI 2.119.0’s verified ECR/GHCR/Docker Hub fallback names. Keep immutable-ID reuse and reject other versions/repositories; pass three local restore tests. [Evidence](05_rebuild_evidence.md#verified-restore-registry-fallbacks--2026-10-09). Full hosted mirror-guard CI `37888267190` now passes.

- [x] Pin fresh CI stacks to PostgreSQL `17.11.0.003` and verify CLI resolution before startup, correcting the proven `.002`/`.003` restore-assertion mismatch without weakening its exact-version check. Clean-checkout resolution, local restore and full hosted reruns `37886909305` / `37888267190` pass. [Evidence](05_rebuild_evidence.md#clean-checkout-postgresql-pin--2026-10-09).

- [x] Add and run the repeatable public-landmark Routes probe for both adjacent directions, four modes and Seoul/New York; assert separate meeting/travel margins and preserve no-route clarification. Pass 19 deterministic adapter/evaluator tests and types. [Evidence](05_rebuild_evidence.md#bidirectional-live-routes-evaluation--2026-10-09). Complete live physical booking and compatibility task 3.5 remain open.

- [x] Preserve guided-onboarding visibility/focus evidence before its separate browser context closes, with bounded content-free JSON and an input-masked synthetic screenshot. Verify privacy/hidden-ancestor regression and actual failure capture. Intermittent hidden-phone and keyboard-focus failures remain open. [Evidence](05_rebuild_evidence.md#guided-onboarding-failure-capture--2026-10-09).

- [x] Reuse the verified local PostgreSQL image ID for isolated restore with `--pull=never` and preserve bounded, redacted Docker startup diagnostics. Local restore and types pass; the cause of hosted exit-125 failure `37884778034` remains unproven pending fresh CI. [Evidence](05_rebuild_evidence.md#isolated-restore-startup-diagnostics--2026-10-09).

- [x] Sync [Calendar analysis retention](../../openspec/specs/calendar-analysis-retention/spec.md) and archive all three verified cleanup tasks. Broader retention, backup custody, hosted restore reliability and full release acceptance remain open.

- [x] Deploy Calendar evidence retention migration `20261009044130` from `f8922d3`: verify 104 matching migrations, identical maintenance definition/privileges/index/schedule, 48 integrations, isolated restore and all 1,747 SQL assertions. Observe actual production minute cleanup while preserving recent/adopted state and removing all fixtures. [Evidence](05_rebuild_evidence.md#scheduled-calendar-cleanup-production-acceptance--2026-10-09). General retention and recovery gates remain open.

- [x] Implement bounded Calendar analysis cleanup and its minute scheduler; rebuild 104 local migrations, pass 15 new retention assertions (1,747 total), verify concurrent/locked rows and preserve adopted state, with clean local advisors. [Evidence](05_rebuild_evidence.md#calendar-evidence-cleanup-foundation--2026-10-09). Integrated and production acceptance remain open.

- [x] Define [scheduled Calendar evidence cleanup](../../openspec/changes/archive/2026-10-09-expire-calendar-analysis-evidence/tasks.md) using the existing 24-hour cutoff, bounded database-only batches and preservation of adopted settings/dismissals. Implementation and selected-production scheduler acceptance remain open.

- [x] Implement the rejection-counter schema and strict snapshot contract; review the additive migration, rebuild 103 local migrations, pass 37 new SQL assertions (1,732 total), concurrent accepted increments and lock-timeout/no-domain-mutation checks, with clean local advisors. [Evidence](05_rebuild_evidence.md#rejection-observation-schema-foundation--2026-10-09). Adapter collection, CLI inspection and production activation remain open.

- [x] Sync the three verified rejection-observation requirements into [operational diagnostics](../../openspec/specs/operational-diagnostics/spec.md) and archive all four tasks. Broader ingress coverage, alerts, ownership and full release acceptance remain open.

- [x] Deploy rejection collection from `1ee5725` (`dpl_BvKRnAmWAwbWyACF62JUhEn9Fv6x`) with production-only activation and migration `20261009041242`. Verify 47 integrations, 87-table restore, 1,732 SQL assertions, runtime smoke, hosted collection, nine unchanged domain-table fingerprints and 81 production HTTP guards. [Evidence](05_rebuild_evidence.md#rejection-observation-production-acceptance--2026-10-09).

- [x] Implement opt-in rejection collection and `diagnostics --rejections`: preserve original outcomes, bound telemetry waits to 250 ms, omit private content and verify actual local CLI inspection. Application checks and both builds pass; integrated release verification and production activation remain open. [Evidence](05_rebuild_evidence.md#rejection-collector-and-operator-cli--2026-10-09).

- [x] Define [bounded database rejection observations](../../openspec/changes/archive/2026-10-09-record-database-rejections/tasks.md): two content-free hourly counter categories, explicit best-effort activation, read-only operator inspection and disclosed coverage gaps. Implementation and production verification remain open in that change.

- [x] Replace the one-response agreement-clock fixture with an isolated, controlled browser clock that verifies the expiring proposal has rendered before advancing time; preserve failure evidence before context cleanup. Both browser suites and 1,695 post-cleanup SQL assertions pass. [Evidence](05_rebuild_evidence.md#controlled-agreement-clock-regression--2026-10-09). Fresh hosted CI acceptance remains open.

- [x] Add `npm run test:restore` and its CI gate: restore populated synthetic state between isolated databases, compare 86 application/Auth/queue tables and verify booking/delivery uncertainty, pending-message replay, revoked OAuth, expired sessions, credential-key dependence and queue sequencing. Document queue export/ownership prerequisites. [Evidence](05_rebuild_evidence.md#populated-application-restore-regression--2026-10-09). Full managed-runtime recovery, actual key custody, off-site durability and live provider reconciliation remain open.

- [x] Restore the encrypted export into a network-isolated, cron-disabled PostgreSQL destination; verify exact COPY content for 118 targets/121 rows, 124 foreign keys and 102 migration records, then remove the disposable destination. Document missing platform-role/queue prerequisites and the empty critical-state coverage limit. [Evidence](05_rebuild_evidence.md#isolated-logical-restore-rehearsal--2026-10-09). Populated application recovery, external keys, off-site durability and recovery objectives remain open.

- [x] Inspect selected-project backup availability and export roles/schema/data plus 102 migration records to private encrypted local storage; verify authenticated decryption and tamper rejection, and document [restoration boundaries](09_backup_recovery.md). [Evidence](05_rebuild_evidence.md#backup-inventory-and-private-logical-export--2026-10-09). Platform restore points, isolated restore, off-site custody, retention and numeric recovery objectives remain open.

- [x] Verify requester detail-review keyboard prerequisites and preserve intake-context failure artifacts for CI run `37879259941`; pass both browser suites and all 1,695 SQL assertions. [Evidence](05_rebuild_evidence.md#requester-review-keyboard-prerequisites--2026-10-09). Hosted intermittent UI acceptance remains open.

- [x] Add pre-cleanup requester scheduling evidence and explicit second-selection response/version assertions for CI run `37878647395`; verify types, both browser suites and all 1,695 SQL assertions. [Evidence](05_rebuild_evidence.md#requester-scheduling-ci-failure-evidence--2026-10-09). The intermittent proposal-display failure remains unresolved.

- [x] Deploy preview messaging guard source `e892779` (`dpl_Fb7nsFPjGvLja5RWzwx5Sv7dpgQk`), verify enabled system metadata, Ready release alias and 81 production HTTP checks, then sync/archive the bounded change. [Evidence](05_rebuild_evidence.md#deployed-preview-messaging-guard--2026-10-09). General environment separation and live-provider gates remain open.

- [x] Verify preview messaging integration with 45 real-database tests, all 1,695 SQL assertions after cleanup, both builds, built HTTP denial and 23 strict OpenSpec items. Production rollout remains pending in the [owning change](../../openspec/changes/archive/2026-10-09-fence-preview-messaging/tasks.md).

- [x] Implement [preview messaging admission](../../openspec/changes/archive/2026-10-09-fence-preview-messaging/tasks.md) at worker and provider boundaries; verify zero RPC/network calls for denied environments, 355 app/provider tests, both builds and all seven built messaging routes rejecting authenticated preview wakeups. Integrated regressions and production rollout remain open.

- [x] Add the final CI database invariant gate after integration/runtime/browser fixture cleanup, including failed-suite paths; verify 45 local integrations followed by all 1,695 SQL assertions without a reset. [Evidence](05_rebuild_evidence.md#ci-database-cleanup-gate--2026-10-09). Hosted execution of the new gate remains to be observed.

- [x] Define strict operational snapshot contracts and extract the shared explicit-project server credential check without changing invitation behavior. Verify category/field allowlists, count/sample consistency and invalid target/credential rejection. SQL and command activation remain pending in the diagnostics change.
- [x] Implement the stable service-only diagnostic SQL projection and reviewed additive migration. Rebuild 102 local migrations, pass 35 new permission/category/redaction/no-mutation assertions and all 1,695 database assertions, with clean local advisors. Production and CLI acceptance remain pending.
- [x] Add the explicit-project diagnostic JSON command and [signal/recovery runbook](08_operational_diagnostics.md). Verify actual local CLI reads, aggregate-only mode, target/credential denial, redacted upstream failures and unchanged uncertain deliveries; preserve invitation CLI behavior. Pass 351 app tests and both builds. Production snapshot acceptance remains pending.
- [x] Implement and deploy [read-only operational diagnostics](../../openspec/changes/archive/2026-10-09-inspect-operational-health/tasks.md) with explicit target/credential checks, redacted persisted-state signals, bounded samples and truthful missing telemetry. Keep broader rejection instrumentation, recovery, retention and operational gates separate. [Deployment evidence](05_rebuild_evidence.md#deployed-operational-diagnostics--2026-10-09): 102 matching migrations, identical function/privileges, clean advisors and rollback-only plus actual CLI acceptance.

- [x] Deploy model execution limits from `0a69f56` (`dpl_EBTshCB6ejSE4ge8qZJxCB4KrsEn`); verify 35 integration tests, runtime/browser recovery, 94 matching migrations, matching function definitions/privileges, rollback-only quota acceptance, clean advisors and 34 production HTTP guards. Sync and archive the bounded model execution change. [Evidence](05_rebuild_evidence.md#deployed-model-execution-limits--2026-10-09).

- [x] Wire conversation, automatic compaction and ranking calls to durable model reservations; verify bounded loops, restart charges, failed settlement, cached ranking reuse and browser recovery with working structured edits. Deployed and verified in the deployment evidence. [Evidence](05_rebuild_evidence.md#model-execution-runtime-integration--2026-10-09).

- [x] Deploy the model reservation database foundation from `aa9802b` (`20261008191725`); verify 94 matching migrations, three matching function definitions/privileges, clean security advisors, rollback-only quota acceptance with zero retained fixtures, and 34 public HTTP guards. Production model-path activation is still pending. [Evidence](05_rebuild_evidence.md#durable-model-allowance-foundation--2026-10-09).

- [x] Implement durable model reservations with eight attempts per conversation input, two per ranking check, and shared 24-hour principal/service allowances. Verify the 94-migration local rebuild, 1,531 SQL assertions, 35 integration tests including concurrent ceilings and expiry after lock waits, 310 app/provider tests, both builds and clean advisors. Production runtime activation remains open. [Evidence](05_rebuild_evidence.md#durable-model-allowance-foundation--2026-10-09).

- [x] Implement the bounded provider-call wrapper with 128 KiB input, output caps, enforced standard/stateless options, mandatory per-attempt reservation and a 30-second generation/stream deadline; verify 11 deterministic tests including the installed Responses adapter. Durable accounting and production integration are complete in [the model execution change](../../openspec/changes/archive/2026-10-09-bound-model-execution/tasks.md).

- [x] Deploy conversation admission budgets from `667b3dc` to `release.findmeatime.com` (`dpl_EDHhDbV2jDTJoHPY1B49u4ZMYFoc`); verify 93 matching migrations, clean security advisors, four matching function bodies, rollback-only quota acceptance and 48 public HTTP checks. [Evidence](05_rebuild_evidence.md#conversation-admission-budgets--2026-10-09).

- [x] Implement and locally verify atomic conversation admission budgets across web, iMessage and requester email: 20/minute and 100/hour per principal; 200/minute and 2,000/hour service-wide. Preserve exact retries, authority/lease fencing and ordered channel deferral; verify browser wait-and-retry feedback. [Evidence](05_rebuild_evidence.md#conversation-admission-budgets--2026-10-09). Model spend and broader operational gates remain open.

- [x] Align runtime compaction tests with same-input reconciliation retries, serialize the npm browser suites and assert keyboard target readiness/focus before Enter. Verify three runtime and two browser suites while preserving all outcome assertions. [Evidence](05_rebuild_evidence.md#runtime-retry-and-browser-test-sequencing--2026-10-09). CI acceptance and the earlier intermittent UI failures remain open.

- [x] Add bounded, sanitized private-review interaction evidence captured before fixture cleanup and retained by CI. The normal local browser run and a temporary four-times CPU-throttled 20-cycle checkbox probe passed; the intermittent CI checkbox failure remains unresolved.

Work:

- [ ] Select/document concrete rate limits, model-turn/spend caps, timeouts, retention/deletion, backup/restore policy, operational ownership and performance targets. Resolve remaining release decisions below before claiming readiness.
- [ ] Add redacted diagnostics for stale decisions, aged jobs, blocked reservations, uncertain writes, channel failures and authorization denials. Provide audited recovery without letting operators manufacture approval or booking success.
- [ ] Separate local, preview and release configuration. Identify the selected Supabase and Vercel targets before deployment; keep previews from sending live mail/messages by default. Review new migrations with `supabase db push --dry-run` before an authorized remote push; never reset a remote project for the rebuild.
- [ ] Replace obsolete deployment scripts and READMEs. Verify current Vercel tooling before using it; upgrade the outdated CLI with `npm i -g vercel@latest` and record the verified version during deployment preparation.
- [ ] Identify and fence former development consumers before enabling replacement channel processing. Do not require a legacy dual-run pilot, but verify one active consumer per intended transport and recoverable deployment configuration.
- [ ] Configure the actual Auth/Google callbacks and webhook endpoints for the replacement, verify HTTPS/domain setup and provider credentials, then run controlled end-to-end journeys. Record any external-action authorization needed at that point rather than treating this planning document as deployment approval.
- [ ] Archive only completed, verified OpenSpec changes, sync their settled behavior to main specs and publish a release evidence matrix with unresolved items explicitly named.

Exit: all phase evidence and required client/provider journeys pass against the selected deployment, current migrations rebuild locally, no unresolved duplicate-processing/authorization/booking-uncertainty defects remain, and runbooks explain recovery. A passed build alone cannot satisfy this gate.

References: [operations](01_backend_architecture.md#10-operations-and-verification), [project selection](03_provider_setup.md#selected-rebuild-supabase-project), [domain/deployment guidance](../../AGENTS.md#domain-and-dns).

## 4. Decisions with deadlines

Resolve these inside the owning change; the plan does not invent product defaults or claim provider support.

| Decision | Required by | Evidence or recorded result |
|---|---|---|
| eve storage, runtime/worker placement, recovery transport and execution limits | End of 1 | Build/deploy/restart/repeated-tool tests and recorded selected topology |
| Model ID, direct billing route and model failure policy | End of 1 | Direct-provider call, selected entitlement and safe failure results; never print keys |
| OAuth server, resource-audience enforcement and registration/client constraints | End of 1 | Early compatibility results and implementable grant/refresh/revocation contracts |
| Guest continuation/recovery, inbox dispatch receipt and per-user memory policy | Before 2 is complete | Explicit credential/session boundaries plus replay/revocation/isolation tests |
| Waitlist fields, rule defaults/classification and broader localization | Before 3–4 behavior is finalized | Preserve stable handles from the [admission contract](../../openspec/specs/host-admission/spec.md) and required English/Korean intake from the [request contract](../../openspec/specs/meeting-requests/spec.md); finalize remaining decisions with UI/domain acceptance cases. |
| Travel modes/geography, estimate freshness, manual allowance, proposal validity and follow-up limits | Before 4 exits | Preserve the settled seven-day/earlier-window request deadline and thirty-day maximum guest credential lifetime; verify deterministic policy, no-match, expiry and unsupported-region cases. |
| Online meeting link source and invitation/ICS ownership | Before 5 exits | Approved final proposal matches actual created event and one-event invitation tests |
| AgentMail allocation/sender binding and Spectrum line/hosting/linking details | Before 6–7 exit | Controlled routing, delivery and restart/revocation evidence |
| Numeric performance/cost limits, retention/deletion and backup/recovery ownership | Before 9 exits | Measured checks and operational runbook |

See the complete [PRD open decisions](../02_product_requirements.md#10-dependencies-and-open-decisions) and [technical decisions](01_backend_architecture.md#open-technical-decisions). If a decision changes agreed release scope, update those owners explicitly.

### Compatibility gates

Each gate requires fresh evidence from the selected rebuild deployment. Credential availability and isolated transport success do not prove product compatibility.

| Gate | Required evidence | Phase |
|---|---|---|
| OAuth resource enforcement | Discovery, registration, PKCE, issuer/audience checks during code exchange and refresh, wrong-resource negatives, revocation and application grants. | 1, 8 |
| Named clients | Complete host/requester journeys and permission checks separately for Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code. | 8 |
| Cloudflare/Auth delivery | Selected-project Google-only login, disabled email login, and controlled invitation, recovery and receipt inbox delivery. | 3, 5, 9 |
| Google Calendar | Exact callbacks, publishing status, separate host/requester grants, refresh, disconnect/reconnect, scoped reads and reliable event creation/reconciliation. | 3–5 |
| Routes coverage | Supported geography/modes and both travel legs; missing estimates require clarification or a confirmed manual allowance, never zero travel. | 4 |
| AgentMail | Signed/deduplicated ingestion, verified-contact continuation, reply threading and uncertain-send recovery, including the provider's verified idempotency-window limits. | 6 |
| Photon | Native-channel compatibility or justified bridge, target policy, private host binding, six-digit linking, replay/restart/unlink and browser continuation. Display names/contact cards are not identity proof. | 1, 7 |
| Model behavior | Direct OpenAI model/entitlement, safe secret loading, refusals, incomplete/invalid outputs, rate-limit/credit failures and private-data filtering without advancing domain state. | 1, 4 |

Preserve settled capability requirements, including expiry, scoped guest credentials and explicit approval; reconcile any disagreement with PRD open decisions in the owning change before implementation.

## 5. Verification and completion evidence

Create fresh tests as each slice lands; do not defer isolation or recovery tests to the final phase. Use deterministic fixtures for failure injection and real controlled accounts for provider acceptance. Tests assert scheduling outcomes and authorization, not framework internals.

| Layer | Required evidence |
|---|---|
| Static/build | Replacement typecheck, lint, server/client secret-boundary checks and production build on the pinned runtime. |
| Domain/contracts | Revision/deduplication rules, explicit decisions, time/DST and travel feasibility, audience projections and invalid model output. |
| Database | pg-delta migration review, complete disposable local reset, grants/RLS, cross-user denial, atomic state/outbox, concurrent booking reservations. |
| Runtime/effects | Session ownership and scoped memory, stream reconnect, process termination, duplicate tool execution, lost wake-up, expired lease and ambiguous provider writes/sends. |
| Browser | iPhone Safari/iMessage handoffs and desktop web, with tested browser/OS versions recorded; Android-specific device testing is deferred. One host page at `/app`, contextual settings/request selection, authorized return/reload, public intake/private booking receipt, mobile widths, 200% zoom and keyboard/focus behavior. Use the required visual-verdict loop during UI implementation. |
| Providers | Live host/requester Google consent and refresh, Routes cases, one event plus consistent invitations, Google sign-in and Cloudflare transactional delivery, AgentMail multi-turn flow and linked private iMessage. |
| Agent clients | Separate evidence for all seven named products, both skill prompts, OAuth grant/revocation and role-specific current-proposal decisions. |
| Operations | Selected environment identification, consumer fencing, backups/recovery procedure, redacted observability and enforced limits. |

Use the following coverage map when assigning concrete tests:

| Layer | Evidence required | PRD coverage |
|---|---|---|
| Domain | Timezones/DST, feasibility, travel, preferences, immutable revisions, current decisions, and closed-state guards. | AC-02–AC-04, AC-07, AC-12–AC-13. |
| Authorization and database | Host/guest isolation, direct API bypass attempts, restricted workflow writes, revoked grants, requester calendar consent/callback binding and disconnect, and audience-safe responses. | AC-10–AC-11, AC-19–AC-21, AC-27. |
| Booking fault injection | Concurrent approvals, competing requests, Runtime termination after dispatch, lost success responses, duplicate work delivery, missed wake-ups, scheduled recovery, and delivery failure after creation. | AC-06–AC-09, AC-13, AC-18. |
| Channel and agent contracts | Channel transitions, spoofed identity, ambiguous/stale replies, webhook replay, MCP/CLI parity, and every named client. | AC-05, AC-11, AC-14–AC-22. |
| Skill entry and onboarding | Both pasted prompts in every named client; invited/existing hosts, pending waitlist access, duplicate submissions, invalid/concurrent invite redemption, direct admission bypass attempts, interrupted consent, unknown handles, unsupported capabilities, selected-calendar analysis, editable time/location suggestions and manual fallback. | FR-02, FR-04, FR-33–FR-35; AC-23–AC-26, AC-28. |
| Agent session runtime | Build/deployment, verified actor/session binding, cross-audience denial, authorized stream replay/reconnect, restart recovery and tool retries without duplicate effects. | Cross-cutting rebuild gates. |
| End-to-end/accessibility | Account-free intake, clarification, agreement, host revision/approval/decline, invitation, phone layout, keyboard use, and readable errors. | AC-01, AC-04, AC-12; PRD section 8. |

Maintain a PRD acceptance matrix for **AC-01 through AC-28**, linking each case to replacement tests and any required live evidence. Record test date, dependency/client versions and environment; never include private tokens, attendee details or raw transcripts in tracked evidence.

Command contract: preserve useful root entrypoints such as `npm run check` and `npm run db:test`, but update what they execute for the chosen runtime. Add a documented browser check and include all retained packages/bridge checks in CI. For database changes, verify Supabase CLI **2.119.0**, generate with `supabase db schema declarative sync --name <name> --no-apply`, review SQL, then use `supabase start`, `supabase db reset --local` and database tests on the identified disposable local stack. Verify OpenSpec CLI **1.14.0** and validate each changed artifact. Record exact test and deployment commands when implemented.

## 6. Risks and mitigations

| Risk | Mitigation and release check |
|---|---|
| Template/runtime mismatch consumes the rebuild | Bounded Phase 1 with explicit pass/fail evidence before expanding the application; documented alternative decision if it fails. |
| One chat surface is mistaken for one shared authorization context | Server-owned actor/resource/audience selection, separate host/requester histories, two-host/two-requester and memory isolation tests. |
| Model or framework approval bypasses domain checks | Typed authorized tools, immutable proposals and independent human confirmation; reject synthetic/stale consent. |
| Calendar succeeds while the worker loses the response | Persist event identity and frozen payload before dispatch; retain reservation and reconcile before another create. |
| Email/iMessage dispatch or tool replay duplicates work | Durable inbox/outbox, scoped idempotency and provider-aware uncertain-send recovery; crash tests at acceptance/acknowledgment boundaries. |
| Old and new deployments both process events | Inventory and fence consumers before controlled tests, then verify active transport ownership. |
| Rebuilding schemas destroys recoverable work or applied history | Checkpoint the dirty checkout, retain migration history and secrets, generate new migrations and never reset remote state. |
| Late client or product-policy gaps block launch | OAuth spike in Phase 1, explicit decision deadlines, independent named-client evidence and no silent scope reduction. |

Planning is complete when this sequence is documented and checked. Product completion requires the phase exits and release evidence above; this plan itself does not certify implementation.
