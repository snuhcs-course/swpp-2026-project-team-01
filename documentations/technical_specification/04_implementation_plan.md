# Implementation Plan

Date: 2026-10-19

Status: planning complete for review; **implementation has not started**

## Scope

The [PRD](../02_product_requirements.md) owns FR-01–FR-36 and AC-01–AC-28. Deliver invite-only Google-login hosts, account-free requesters, Google availability/travel checks, requester email, optional linked host iMessage, remote MCP, separate user/admin CLIs and all seven required personal-agent clients, with explicit current host approval, privacy and uncertain-write reconciliation. Private host email and automated post-booking reschedule/cancel remain outside initial release.

Use Supabase project **`anelszynxtvxoxqvzgqt`**; [provider setup](03_provider_setup.md#supabase-project) records its observed state. Its application schema is empty and managed Auth/Storage/Vault remain. Implementation starts with a bounded OpenSpec change for S1 after the runtime stack decision; do not scaffold packages, install dependencies, generate migrations or add tests before that change exists. Provider effects, deployment and root-domain promotion are separate explicit actions.

## Entry gates

| Entry gate | Owner / timing | Required result before proceeding |
|---|---|---|
| Implementation authorization | Before S1 | A bounded OpenSpec change for S1 and the recorded stack decision |
| Synthetic runtime storage | S1 | Isolated disposable storage with no live delivery or production identity bypass; scratch fixtures never become an implicit migration backlog for the selected project |
| First application migration chain | S2 design / before any remote schema apply | Confirm the empty application baseline; author desired SQL and generate/review the chain; keep managed Auth/Storage/Vault intact and account for preinstalled extension prerequisites |
| Exposure and grants | Before first schema apply, then each schema slice | Review namespace/role/default-privilege matrix, explicit grants/revokes and RLS; test anonymous/authenticated bypass denial because new `public` objects can inherit broad existing defaults |
| Hosted identity and settings | Before S2 hosted acceptance | An existing Google identity is not an admitted host; verify Google-only login/callbacks and Cloudflare SMTP routing/sender for applicable non-login Auth notifications; create admission/profile/grants only through authorized operations |
| Environment and consumer ownership | Before the first remote schema/API activation and each live provider test in S2–S9 | Identify project-bound credentials and callbacks, default previews to no-send, and fence any competing consumers before enabling processing |

The hosted project runs PostgreSQL 17.6, consistent with the local major version. The local `config.toml` project ID identifies a disposable local stack; the ignored CLI link identifies the hosted target. Local migration/seed execution stays disabled until the reviewed chain exists.

## Delivery method

Use one bounded OpenSpec change/topic PR at a time. The names below are proposed work slices, not already-created changes; S1 is proposed after the stack decision. Before each slice, read its PRD/main contracts, resolve the listed decisions and create only the necessary pending deltas. Do not mark behavior implemented because a fixture passed.

Implement each slice vertically through authorized domain operations, persistence, thin adapters, usable UI, meaningful tests and owning documentation. Record fresh results as they land, then sync/archive only completed verified behavior. Make runtime/security/recovery tests part of their owning slice instead of deferring them to launch. The table expresses delivery dependencies.

## Dependency order

| Slice | Proposed change | Depends on | Deliverable and exit gate |
|---|---|---|---|
| S1 | `runtime-foundation` | New implementation request and stack decision | Pinned builds for the chosen stack, protected conversation/tool boundary, durable replay/restart/terminal recovery proof, deployment/persistence decision and early OAuth/Photon compatibility findings |
| S2 | `host-admission` | S1; baseline recheck and entry gates | Google-only identity, waitlist, bound invitations, stable handles, grants/RLS, separate invitation admin CLI and controlled transactional delivery |
| S3 | `host-setup` | S2 | Host Calendar consent/roles, suggestion-first private drafts/analysis, explicit preference review, readiness and share links in `/app` |
| S4 | `request-lifecycle` | S3 | Account-free intake, contact proof/recovery, optional Google identity/requester Calendar, protected continuation, proposal revisions and closure |
| S5 | `meeting-feasibility` | S4 | Bounded deterministic calendar/time/rule/travel evaluation, private exceptions, candidates and requester agreement |
| S6 | `approved-booking` | S5 | Current host approval, reservations, final revalidation, one-event dispatch/reconciliation, consistent receipt/invitations and independent delivery recovery |
| S7 | `requester-email` | S4, S6 | Initial email intake and verified enrollment, durable input/replies, outgoing-parent continuation, stale/revoked/uncertain-send recovery |
| S8 | `host-imessage` | S3, S6 | Inline six-digit linking, shared private setup, explicit request selection, attributed review/revision/approval/decline, unlink/restart and optional contact card |
| S9 | `agent-access` | S2–S8; S1 OAuth findings | Scoped OAuth/MCP, one-request bootstrap, full user CLI parity, both public skill journeys and individual named-client acceptance |
| S10 | `release-operations` | S1–S9 | Environment/consumer fencing, separate operator diagnostics/recovery, retention/budgets, populated backup restore, all acceptance evidence and reviewed deployment |

S7/S8 do not depend on each other. OAuth/transport feasibility is investigated in S1 so S9 does not first discover an unsupported client/server combination. Controlled provider checks occur as each adapter lands after the environment/consumer entry gate; S10 assembles evidence and verifies integration. Staging slices does not reduce agreed release scope.

## Slice details

### S1 — Runtime foundation

Resolve dependency/template revisions, model/provider entitlement, separately built service composition, persistence, job wake-up and worker placement. Keep synthetic persistence in isolated disposable storage; do not bootstrap the selected hosted project as a shortcut. Build only the minimum protected conversation with a synthetic non-scheduling effect. Derive actor/resource/audience server-side; deny raw runtime endpoints and cross-scope tools. Test stream reconnect, process death after commit/before acknowledgment, exact input retry, lost wake-up, explicit terminal recovery and durable cumulative limits. Preserve the settled numerical [message admission](../../openspec/specs/chat-workspaces/spec.md) and [model execution](../../openspec/specs/model-execution/spec.md) contracts; selecting a model or measuring performance does not change them. Model refusals/configuration/credit failures must be recoverable without fabricated completion.

Perform bounded OAuth resource/PKCE/current-grant and Photon receipt/sender/acknowledgment compatibility checks using fixtures first. Record remaining real-provider/client prerequisites explicitly. Do not claim all seven clients or live iMessage pass from these spikes. Introduce only verified build/check commands and minimal CI with no live effects.

Exit: production builds and protected runtime fixtures pass; persistence/placement/failure contracts are recorded. A failed spike blocks expanding the same runtime until an explicit alternative decision is documented.

### S2 — Identity, admission and database baseline

S1 synthetic fixtures use isolated disposable storage. Before S2 product SQL, confirm the empty application baseline on `anelszynxtvxoxqvzgqt` and preserve managed data/configuration. Create the desired application schema and generated migration chain. Review namespace placement, current default privileges, explicit grants/revokes, RLS and idempotent prerequisites for installed extensions before deployment. Enable local migration execution only for the reviewed chain; follow pg-delta and rebuild only an identified disposable local database.

Verify hosted Google-only login settings, exact callbacks and project-bound application credentials; the local config does not establish that acceptance. Separate Google sign-in from admission and Calendar permission; an existing Google identity must pass admission like any other. Implement deduplicated waitlist, verified-recipient seven-day invitations, atomic redeem/retry/revoke, stable/reserved handles and publication guards. Provide a distinct environment-bound administrator CLI for issuance/status/revoke/recovery so invited users can complete the journey. Add durable Cloudflare dispatch and truthful uncertainty; no Auth email login.

Verify hosted Cloudflare custom SMTP for applicable non-login Auth notifications under the [provider setup gate](03_provider_setup.md#cloudflare-email-service). Record configuration, selected sender and controlled notification evidence where applicable before hosted Auth acceptance; keep Google-only login and no fallback sender.

Exit: account/admission bypass and two-host isolation negatives pass across direct operations; controlled invitation recipient delivery/redemption is recorded before claiming live delivery. User OAuth/client guards added later must reuse this boundary.

### S3 — Guided host setup

Implement bound host Calendar consent, encrypted refresh/disconnect, actual editable conflict-calendar recommendations and separate writable booking destination. Explain bounded recommendation context and confirm selection. Automatically analyze saved selected calendars over the past/next four weeks; respect explicit choices, disclose failed/partial reads, retain bounded evidence and label starter defaults.

Persist a resumable draft, ask mode/location explicitly, and capture transport/per-trip policy plus extra buffer for physical meetings. Confirm current settings against current permissions/rules before publication. Keep precise controls and manual setup usable through model failures; apply Thyme visual/accessibility direction. Web/iMessage-first handoffs resume this draft when S8 lands; linking is optional.

Exit: consent/reload, duplicate calendar names, read-only destination, sparse/failed scan, stale review and mobile/keyboard/reduced-motion tests pass. Live Google acceptance remains distinct from fixtures.

### S4 — Guest intake and versioned lifecycle

Build public host entry and protected `/booking/[bookingId]`, with English/Korean clarification and reviewed extraction. Offer optional identity-only Google prefill and manual name/contact; verify alternate/manual addresses before attendee/private recovery use. Optional requester Calendar consent is request-bound, availability-only and independent of admission.

Provide accessible verified-contact access recovery at the booking destination without requiring prior browser access. Preserve generic issuance feedback, all retained proof/rate limits, fragment-to-HttpOnly exchange, exact retry and atomic replacement of the request credential. Replacement revokes old credentials, pending contact proofs and linked channels; closed requests cannot recover. Follow the [requester recovery design](../user_experience/04_page_list.md#requester-booking-destination); this is distinct from runtime reconnect/terminal recovery.

Preserve expected revisions, immutable proposals, audience separation, exact retry/withdrawal/decline/expiry guards and minimal terminal receipt access. Enforce seven-day/earlier-window request deadlines and at-most-thirty-day guest credentials; closure denies mutations/OAuth/recovery. Reconnect or explicit manual/agent availability replaces unavailable requester data, never assumed free time.

Exit: two-request/two-host isolation, wrong-browser callbacks, recovery without prior access, generic unknown/wrong/unverified/closed-request feedback, expired/replayed recovery proof, credential/contact rotation, stale extraction, closed access and lost-response/reload tests pass; both optional and skipped Google paths work.

### S5 — Feasibility and negotiation

Normalize timezone/DST/overnight intervals. Filter full meeting intervals against host/requester busy time, hard rules, focus blocks, duration and buffers. Check physical travel on both sides with selected geography/modes, estimate freshness and explicit manual allowances. Resolve online-meeting travel policy before implementing it. Bound evaluation work/provider reads under the agreed contracts.

AI can gather details and rank feasible candidates. Host-only exceptions/revisions stay private and cannot waive hard conflicts. Candidate selection/requester agreement bind the current shared proposal; no-match asks for clarification or private host action.

Exit: both travel legs, unsupported/failed routes, adjacent-context changes, DST ambiguity, private projections, no-match and invalid model output tests pass. Record controlled Routes acceptance separately.

### S6 — Approval and reliable booking

Present full current host review and record attributable approval. Current requester agreement is also required. Changed shared details renew both decisions; private exception changes renew affected host approval. Establish immutable event/destination/payload identity, reservations, fenced leases and durable outbox before creation.

Revalidate current permissions, decisions, rules, requester availability and travel immediately before creation. Reconcile timeout/response loss before another create; preserve pending uncertainty and truthful withdrawal cutoff. Generate Calendar invitation, confirmation email and protected receipt from confirmed event data. Notification retries cannot recreate events. Finalize online-link/invitation ownership first.

Exit: concurrent decisions/competing requests, busy changes, killed worker, lost success response, rejected write/reconnect, closure and notification failure tests pass; controlled real Calendar one-event/reconciliation evidence is recorded.

### S7 — Requester email

Support email-first intake as well as explicit enrollment from a protected verified-contact request. Authenticate origin/sender, persist deduplicated input before acknowledgment, freeze receiver/thread/request/audience and reject forwarded/unlinked/stale/revoked input. Continue the same authorized requester conversation and preserve web handoff.

Freeze outgoing replies with settlement, enforce ordering/current authority, accept only correctly bound outgoing-parent continuation and recover send uncertainty within verified provider limits. Do not infer delivery from API acceptance or email opening. Host-private email remains a separate proposal.

Exit: signed-origin fixtures, sender/thread forgery, replay/restart, old proposal selection, revoked bindings and uncertain sends pass; controlled live multi-turn email and browser continuation succeed.

### S8 — Host iMessage

Specify the six-digit binding delta, private setup answer/settings confirmation, request selection/decision context and contact sharing. Authenticate the host/browser, send proof to the intended private sender, verify in the initiating browser and confirm binding. Keep codes outside transcripts/model context; web remains available on failure/skip.

Use the adapter selected in S1. Freeze explicit request selection per accepted receipt and retain separate setup/private/shared contexts. Current authored reviews establish exact decision context; ambiguous/stale replies require clarification or web review. Unlink stops notifications/actions. Optional native contact sharing reports uncertainty and never promises contact saving or display name.

Exit: unlinked/group/foreign sender, stale/ambiguous replies, revoke, restart and concurrent web decisions pass; a controlled iPhone completes question/revision/approval and separate decline. Transport-only sends are insufficient.

### S9 — Personal agents, MCP and user CLI

Implement resource-bound OAuth discovery/registration/PKCE, explicit owner/scopes, exact callbacks, refresh/revocation and current transactional checks. Specify the one-future-request bootstrap delta; permanently bind the grant after one creation. Keep requesters account-free. Complete typed role operations and separate user CLI without provider/service credentials. Agent suggestions may draft, but never manufacture human settings/proposal confirmation.

Publish truthful root and per-host skill documents and actual connection/recovery steps. Test both pasted prompts, host setup/configuration, delegated requester coordination, current approval, denial/revocation, stale/private access and MCP/CLI parity separately in Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code. Document client versions and the direct web confirmation fallback where needed.

Exit: every required client's actual journey has independent evidence; missing clients remain release blockers. No one-paste/universal-support claim from SDK fixtures alone.

### S10 — Operations and release

Recheck the environment/consumer gates already required before each earlier activation; S10 is the final integrated audit, not the first consumer-fencing step. Default previews to no live delivery; verify callbacks/domain/HTTPS with current tooling. Extend separate administrator tooling with read-only redacted diagnostics and guarded audited recovery. Define retention/deletion, support ownership, numerical budgets and measured performance/cost targets. Restore synthetic populated data into isolated storage and document rollback/recovery limits.

Only deploy after pending schema dry run/review and authorized environment identification. Promotion/final activation is a later explicit action. Verify all AC rows against the selected deployment and preserve privacy in evidence. Document post-booking boundaries and any supported-version limits. Reconcile/sync/archive only verified capability deltas.

Exit: all AC-01–AC-28 and cross-cutting gates pass; no unresolved authorization, duplicate effect or uncertain-outcome defect. Build success alone cannot close release readiness.

## Decisions and deadlines

| Decision | Owner / deadline | Required record |
|---|---|---|
| Runtime/template/dependency/model/persistence/worker selection | S1 exit | Pinned versions, bounded authorized fixtures, failure/recovery results and selected topology |
| OAuth registration/resource enforcement and Photon adapter fit | S1 spike; S9/S8 final | Negative protocol/transport results and precise later acceptance prerequisites |
| Isolated S1 fixtures and the empty application baseline | Before S1 fixture SQL / S2 product SQL | Empty application schema confirmed on the selected project; managed data preserved; recheck before new SQL |
| Namespace/default grants and managed identity/configuration | Before S2 schema/hosted acceptance; each later schema slice | Explicit exposure/RLS/grant matrix, Google-only config evidence and no admission from an existing identity alone |
| Environment/consumer ownership | Before first remote schema/API activation; each live S2–S9 test | Verified target/credentials, no-send previews and one intended active consumer; final re-audit in S10 |
| Complete human-only exception/parity list and CLI authority | S2 design; each slice | Per-operation permission/confirmation matrix; no hidden administrator mode |
| Calendar scopes, suggestion defaults and hard/preference classification | Before S3 behavior | Reviewed pending contract and editable recommendation/confirmation semantics |
| Guest proof, consent lifetimes and connection recovery | Before S4 behavior | Credential/audience/callback/closure matrix aligned with main specs |
| Travel geography/modes/freshness/manual allowance and online travel | Before S5 behavior | Deterministic policy with unknown-route and online-neighbor cases |
| Online link creation and Calendar invitation/ICS ownership | Before S6 writes | Approved final-details model and single-event invitation evidence |
| Mail allocation/sender binding/idempotency window | Before S7 effects | Provider contract and uncertain-send procedure |
| Spectrum recipient/line policy, private-channel confirmations/profile | Before S8 effects | Reviewed pending deltas and real-device acceptance plan |
| Named client versions, setup and confirmation attribution | S1 discovery; before S9 acceptance | Separate plan/evidence per required product and both roles |
| Retention/deletion, additional measured targets and support/restore ownership | Before S10 release | Runbooks, measurements and controlled restoration evidence |

If a decision changes product scope or an agreed contract, revise its owning PRD/spec delta explicitly before implementation. Pending drafts remain pending; settled expiry/language/approval rules are not reopened silently.

## Verification and completion

All implementation tasks and acceptance rows start **pending**. Add tests as a slice lands. Record commit, exact command/result/date, dependency/client versions, environment and limitations; keep personal attendee text, tokens and raw transcripts out of tracked evidence.

| Layer | Required evidence |
|---|---|
| Build/static | Pinned separate production builds, type/lint checks, secret/import boundaries and minimal CI |
| Domain/database | Authorization/RLS, atomic state/outbox, exact retry, current revisions, full disposable migration rebuild and concurrent invariants |
| Runtime/effects | Reconnect, termination, explicit terminal successor, cumulative usage, replay, lost wake-up/response, fenced ownership and reconciliation |
| Browser/accessibility | Complete phone/desktop journeys, keyboard/focus, 200% zoom, reduced motion, long messages, readable timezone/errors and callback/reload recovery |
| Providers | Separate controlled Google/Routes, Cloudflare inbox, AgentMail thread and iPhone delivery/decision journeys |
| Agent clients | Independent two-role/skill-prompt evidence for all seven products plus OAuth/CLI parity |
| Operations | One intended consumer, preview fencing, private diagnostics, audited recovery, populated restore and measured limits |

Use the [acceptance inventory](07_acceptance_inventory.md) as the coverage map. An evidence ledger is created when implementation results exist.
