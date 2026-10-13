# Find Me a Time — Backend Architecture

Status: proposed design; implementation absent

Date: 2026-10-13

Basis: [PRD](../02_product_requirements.md), [technical overview](../03_technical_specification.md), [implementation plan](04_implementation_plan.md) and [capability contracts](../../openspec/specs/).

## Deployment shape

Use Supabase for Auth and durable scheduling state, Next.js for the web boundary, and eve for conversation execution. Separately built web and agent services are the intended direction; the foundation spike must select persistence, dispatcher ownership, worker placement and deployment routing. No separate worker or bridge app is assumed before that check.

Human waits and accepted operations live in durable state. Process memory, an HTTP response and a framework checkpoint cannot be the only record of an agreement, approval or provider effect. The model provider must be selected and tested server-side while preserving the numerical limits in the [model execution](../../openspec/specs/model-execution/spec.md) and [workspace admission](../../openspec/specs/chat-workspaces/spec.md) contracts.

## Clean database starting point

The selected project's application schema/history is empty, as recorded in [provider setup](03_provider_setup.md#clean-project-recheck--2026-10-13). Existing Google identity, Vault secrets and installed extensions remain managed infrastructure. None supplies application admission, participant grants, conversation bindings or scheduling policy.

Before the first schema slice, specify the private/exposed namespace and role matrix. Existing `public` default privileges can grant newly created tables/sequences/functions to `anon` and `authenticated`; explicitly restrict service-only boundaries and apply RLS to exposed tables. Test direct access and RPC authorization with each role. Avoid editing managed Auth/Storage/Vault tables or treating old private schema/RPC names as compatibility obligations. New desired SQL and migrations must build the complete application contract from the clean baseline, with deliberate prerequisites for preinstalled extensions.

The runtime foundation uses isolated synthetic storage, with test-only principals kept out of production. Reusable product persistence is introduced through the reviewed new application chain. Before hosted schema/API activation or live effects, identify target credentials and fence competing consumers; absence of database cron jobs does not establish external deployment ownership.

## Module boundaries

| Module | Responsibility |
|---|---|
| Identity/admission | Verified host identity, invitations, request-scoped guests, current grants, channel bindings and revocation |
| Onboarding | Resumable drafts, calendar roles, explicit preferences, readiness and stable handles |
| Requests/conversations | Intake, revisioned state, lifecycle, canonical actor/resource/audience bindings |
| Feasibility | Deterministic availability, hard rules, buffers, travel and bounded evaluation |
| Proposals/decisions | Immutable versions, shared agreement, private exceptions and attributable current host approval |
| Booking | Durable identity/reservation, final revalidation, provider creation and reconciliation |
| Delivery | Frozen recipients/content, provider dispatch identity and truthful delivery status |
| Operations | Redacted diagnostics, limits, consumer ownership, audited recovery and backup/restore |

Thin web, MCP, CLI and channel adapters invoke the same authorized operations. Provider adapters implement narrow ports. Domain modules do not depend on browser cookies or framework-specific request types; [source organization](02_frontend_architecture.md#source-organization) defines the future layout.

## Authorization architecture

Authenticate before selecting private data or model context. Verify admission separately from Google login and Calendar consent. Requester continuation authorizes one request; public handles and IDs grant no private access. Personal-agent grants require current owner/resource/scope checks and revocation. Operator authority remains separate from users and their agents.

Recheck relevant authority and expected revision inside the transaction that changes state, including expiry after blocking waits. For provider I/O, recheck the context before committing its result. Project only the permitted audience; server-side filtering precedes serialization and model context construction. Default/raw runtime endpoints must fail closed.

### MCP OAuth and CLI

Use resource-specific tokens, explicit scoped consent, PKCE, exact registered callbacks, discovery, current-grant checks and refresh/revocation semantics from [agent-client authorization](../../openspec/specs/agent-client-authorization/spec.md). Supabase login or a Calendar token cannot substitute for this boundary. An authenticated SDK fixture does not prove any named client works.

Account-free requester bootstrap is a pending delta: select the host, obtain a grant for one future request, create exactly one request on retry, then permanently restrict continuation to it. Re-specify this behavior before implementation; the retired draft is reference material. Both CLIs are described in [CLI direction](06_cli.md).

## Command and query pipeline

Each command carries validated intent, resource ID, expected revision and stable retry identity. Proposal decisions name the current version. Derive identity, scope and human-confirmation evidence server-side; caller booleans and model assertions are not proof.

Authorize, validate, lock in a documented order, recheck, apply the domain transition and publish durable work atomically. Freeze idempotency inputs: exact retry returns the same outcome; changed retry conflicts. Queries use audience-safe projections and stable owner-bound pagination. Error output must not reveal foreign resource existence or secrets. Follow [application commands](../../openspec/specs/application-commands/spec.md).

## Host setup and calendar analysis

Keep an admitted host's draft separate from confirmed policy. Prefer explicit choices, then authorized evidence, then labeled starter defaults. Recommend actual visible calendars using bounded disclosed evidence, review conflict calendars separately from the writable booking destination, and save only on confirmation. Automatically analyze saved conflict calendars over the past/next four weeks, bounded by [analysis retention](../../openspec/specs/calendar-analysis-retention/spec.md), without treating free time or repeated venues as preferences.

Ask mode/location explicitly. Physical/either mode requires transportation or per-trip policy and an extra buffer; online-only omits those fields. Calendar metadata, draft/rules revisions and current authority must remain valid at final settings confirmation. Six-digit iMessage linking and private-channel answer/settings confirmation remain proposed deltas until their fresh owning changes are reviewed. Stale suggestions never overwrite explicit values.

## Request lifecycle and feasibility

Preserve [meeting requests](../../openspec/specs/meeting-requests/spec.md): complete account-free English/Korean intake, reviewed extraction, current immutable proposals, protected continuation and closure. Actionable requests expire seven days after creation or at the earlier requested-window end. Guest credentials last at most thirty days; closure removes mutation, OAuth and recovery authority, retaining only allowed minimal terminal receipt access while unexpired.

Keep optional Google identity distinct from Calendar consent and request authority. Changed/manual attendee addresses require proof; matching email never merges requests. Requester Calendar failures pause dependent evaluation until reconnection or explicit manual/agent availability replaces them.

Follow [meeting feasibility](../../openspec/specs/meeting-feasibility/spec.md): evaluate full intervals, date-specific timezones/DST, overnight windows, busy/focus constraints and both physical travel legs. Unknown or failed route data never means zero travel. Host exceptions may waive preferences only. Resolve online travel and route geography/modes in the owning slice before final behavior is approved. The model ranks valid candidates and proposes clarifications; it cannot relax hard constraints or write confirmed policy.

## Approval, booking and recovery

Require requester agreement on shared details and attributable host approval on the current proposal, including applicable private exceptions. Changes invalidate the affected decisions. If a channel/client cannot establish exact human attribution, use protected web review. Natural-language assent alone must not bypass a protected confirmation contract.

Persist booking identity, selected destination, provider-valid event identity, frozen payload, reservation and attempt before creation. Coordinate simultaneous requests for the same host and recheck feasibility immediately before dispatch. An uncertain write remains pending and retains its reservation until reconciliation establishes the outcome. Definitively rejected retries require current decisions and fresh revalidation. Do not claim a booking from a delivery/read receipt.

Generate receipt, confirmation email and Calendar invitation from confirmed event data; keep private conversation credentials out of shared event descriptions. Delivery failure is independently recoverable and cannot cause another event. See [invitation design](../user_experience/03_interfaces.md#booking-confirmation-email-and-calendar-invitation). Detailed approved-booking/notification behavior must be recreated as pending specs before its slice starts.

## Jobs, inbox and outbox

Record authenticated provider input durably before acknowledging it. Deduplicate provider IDs and freeze the receiver generation, verified sender/thread binding and selected request/audience. Forwarded links, display names and quoted claims do not confer authority. One transport has one intended consumer; old deployments must be fenced before activation.

Atomically publish jobs with domain transitions. Use bounded leases, ownership fencing, recoverable wake-ups and redelivery-safe completion from [durable jobs](../../openspec/specs/durable-jobs/spec.md). Outbound jobs freeze route, recipient and content before dispatch. Verify each provider's actual idempotency window; after uncertainty exceeds that window, reconcile or require an audited recovery decision instead of blind resend.

### Email provider direction

Cloudflare delivers transactional invitations, proof/recovery messages and confirmed-booking notices. AgentMail owns requester conversation inboxes, threads and replies. The MVP deployment must disable Auth email login for Google-only host login; the current hosted setting is not verified by this schema audit. Transactional email setup is independent of host sign-in. Private host email remains outside initial release scope.

### iMessage

Photon Spectrum is the selected transport direction. Browser phone/code proof binds a private sender to an authenticated admitted host only after confirmation. Unlinked/group senders get no private state. Freeze explicit request selection before dispatch; ambiguous replies do not select a request or approve a proposal. Unlinking revokes future access. Contact-card saving is optional and establishes no identity proof. Native versus application-owned adapter suitability needs a fresh spike.

## Operations and verification

Keep secrets, private text and provider credentials out of tracked evidence and user logs. Provide read-only private diagnostics and guarded audited recovery through separate operator authority. Verify backups with synthetic populated-state restoration into an isolated database. Reconstruct local/preview/release separation and default preview delivery fencing.

Test transactions, grants/RLS, two-host/two-requester isolation, stale decisions, concurrent writes, missing wake-ups, process death, lost provider responses, revoked grants, model limits and safe projections as each slice lands. Fresh provider/device/client evidence is required alongside fixtures. The [implementation plan](04_implementation_plan.md#verification-and-completion) owns completion criteria.

## Open technical decisions

Runtime persistence/placement, dependency pins/model ID, OAuth implementation/client versions, rule/travel policy, meeting-link/invitation ownership, transport allocation, retention and measurable limits remain decisions with deadlines in the plan. This document does not prescribe old table/RPC names, exact endpoint internals or previous executable commands as compatibility requirements.
