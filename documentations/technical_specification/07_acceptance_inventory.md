# Rebuild acceptance inventory

Date: 2026-10-09. This is an obligation and ownership map, not a release sign-off. The [PRD](../02_product_requirements.md#9-end-to-end-release-acceptance-scenarios) owns the full scenario text; each row below preserves its verification scope. The [implementation plan](04_implementation_plan.md) and [evidence ledger](05_rebuild_evidence.md) record completed increments. Fixture evidence does not establish live provider or named-client success.

## Current resource inventory

- Checkout at audit: `d135901` on `feat/reconstruct-application`; [draft PR 7](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/7). Preserve the unrelated competitor-research edit.
- Vercel readback: team `justdodos-projects`, project `findmeatime-release` (`prj_eCihziUF85AHPkfnFCNhBtdYlfnk`), production deployment `dpl_HexyRfLkzhXDTouz1yzmPVRm9LuU` is Ready at `https://release.findmeatime.com`. Deployed source is `d135901`. The [deployment checks](05_rebuild_evidence.md#receipt-ordering-production-deployment--2026-10-09) passed both public pages and 15 composed runtime checks with `releaseReady: false`. The earlier [latency probe](05_rebuild_evidence.md#public-http-latency-probe-and-edge-challenge--2026-10-09) encountered a Vercel challenge; complete performance acceptance remains open.
- Supabase CLI link remains `mriseqztcwmezvtawnbo` (FindMeATime2). The [retention deployment ledger](05_rebuild_evidence.md#scheduled-calendar-cleanup-production-acceptance--2026-10-09) records 104 matching migrations through `20261009044130`. No newer remote schema state is inferred from a local reset or this documentation refresh.
- Node 24.21.0, npm 11.19.0, Supabase 2.119.0, OpenSpec 1.14.0 and Vercel 62.5.0 were read back. Runtime pins remain in the committed manifest/lockfile. Six application eve routes and four tools are inventoried in the [runtime documentation](../../agent/README.md#runtime-authorization-inventory).
- Google OAuth remains blocked by the documented callback mismatch and Google Cloud sign-in requirement. Photon live receiver/device acceptance, authorized AgentMail journeys and invitation mailbox delivery remain open; credential presence is not delivery evidence. See [provider setup](03_provider_setup.md). Cloudflare retains authoritative DNS; the root-domain deployment is outside this reconstruction checkout’s release target.

## Named-client availability audit

The 2026-10-09 read-only workstation inventory checked exact application bundles in `/Applications` and `~/Applications`, plus executable discovery on the current PATH. It is a local availability check, not exhaustive software discovery or compatibility acceptance. Web products, differently named bundles and installations on other devices may still be available. No connection, grant or scheduling journey was performed by this inventory.

| Required client | Observed availability | Acceptance still required |
|---|---|---|
| Dots | No exact-name local bundle found in the checked directories. | Identify the actual client/version and exercise both roles. |
| Muse | No exact-name local bundle found in the checked directories. | Identify the actual client/version and exercise both roles. |
| Instinct | No exact-name local bundle found in the checked directories. | Identify the actual client/version and exercise both roles. |
| ChatGPT | `/Applications/ChatGPT.app`, version `26.1002.52244`, build `13536`. | Actual application connector/consent and both complete role journeys. |
| Codex | Bundled CLI reports `0.162.0-alpha.2`; no separate exact-name app bundle was found. CLI presence does not establish the desktop client's version or connection state. | Actual supported client connection and both role journeys; do not substitute the project's requester CLI. |
| Claude | No exact-name local bundle found in the checked directories. | Identify desktop/web client/version and exercise both roles. |
| Claude Code | `claude` was not found on the current PATH. | Locate/install the intended client, authenticate it and exercise both roles. |

The Google Cloud check found zero signed-in accounts through Aside's account inventory. Attaching the existing Cloud Console tab timed out, so its old title is not evidence of authenticated access. The operator sign-in request remains pending. No callback or OAuth client setting was changed. The full named-client tasks remain open; all seven products require independent current-proposal, stale-decision and revoked-access evidence.

## Ownership

| Short owner | Current record |
|---|---|
| Foundation | [rebuild-application-foundation](../../openspec/changes/archive/2026-10-09-rebuild-application-foundation/tasks.md) |
| Calendar | [connect-google-calendars](../../openspec/changes/connect-google-calendars/tasks.md) |
| Feasibility | [completed record](../../openspec/changes/archive/2026-10-09-evaluate-calendar-and-travel-feasibility/tasks.md) and [main contract](../../openspec/specs/meeting-feasibility/spec.md) |
| Booking | [book-approved-proposals-reliably](../../openspec/changes/book-approved-proposals-reliably/tasks.md) |
| Host setup | [conversational-host-setup](../../openspec/changes/conversational-host-setup/tasks.md) |
| Email binding/replies | [bind-requester-email](../../openspec/changes/bind-requester-email/tasks.md), [deliver-requester-email-replies](../../openspec/changes/deliver-requester-email-replies/tasks.md) |
| Operator invitations | [deliver-operator-invitations](../../openspec/changes/deliver-operator-invitations/tasks.md) |
| Agent intake | [enable-agent-request-intake](../../openspec/changes/enable-agent-request-intake/tasks.md) |
| Agent tools | [deliver-agent-tools-and-cli](../../openspec/changes/deliver-agent-tools-and-cli/tasks.md) |
| Public entry | [main contract](../../openspec/specs/public-agent-entry/spec.md); complete client journeys remain with agent tools |
| Compatibility | [validate-provider-and-agent-compatibility](../../openspec/changes/validate-provider-and-agent-compatibility/tasks.md) |

## AC-01–AC-28 obligations

The evidence column summarizes inspected tests and dated ledger entries; the last column is still required before full release acceptance. A passing local mechanism does not close the broader end-to-end criterion.

| AC | Owner | Current evidence or implementation | Remaining verification or implementation |
|---|---|---|---|
| AC-01 | Foundation, Calendar, feasibility, booking | Intake clarification, publication, agreement and approval fixtures; full booking integration. | Complete controlled live account-free journey and one Calendar event. |
| AC-02 | Feasibility; compatibility | Both legs, unresolved Routes, private allowances and changed-neighbor revalidation pass. The [legacy scheduling audit](10_legacy_scheduling_audit.md) records hard-conflict call ordering and remaining scope differences. | Retain live geography/mode checks in compatibility task 3.5. |
| AC-03 | Feasibility; booking | Private exception/browser handoff, redaction and separate approval pass. | Verify in the final live requester/host journey. |
| AC-04 | Booking; agent tools | Stale approval/changed details and fresh agreement/approval checks pass. | Complete live and named-client decision paths. |
| AC-05 | Email binding/replies; booking | Current-version binding and browser-only human decisions prevent stale email authority. | Authorized external email reply against an older proposal; preserve one request. |
| AC-06 | Booking; agent tools | Concurrent decisions/dispatch, signed MCP status parity and stable identity pass. | Controlled mobile plus actual agent concurrency journey. |
| AC-07 | Booking; feasibility | Competing host reservations, fresh Calendar reads and requester/travel changes block conflicts. [Request-evaluation audit](10_legacy_scheduling_audit.md#request-evaluation-assertions) verifies frozen booking protection during empty/differing provider reads and initial stale denial before provider access. | Live competing request/new busy event acceptance. |
| AC-08 | Booking | Actual worker kill/lost reply and stable-event reconciliation pass with controlled transport. | Controlled live Calendar lost-response reconciliation (booking task 3.4). |
| AC-09 | Calendar; booking; compatibility | Revocation/reconnect, definitive rejection, uncertain outcome and separate delivery state pass. | Complete live revocation/recovery and authorized confirmation delivery. |
| AC-10 | Foundation; agent tools | Audience isolation, forged approval denial, strict tool contracts and current authority pass. | Retain per-client explicit host-confirmation acceptance. |
| AC-11 | Email binding/replies | Request/thread binding, sender proof, shared-only history and revocation fixtures pass. | Authorized live email-to-browser continuation. |
| AC-12 | Feasibility; Calendar | Both DST transitions through real evaluation/selection/agreement preserve instants; ambiguous input rejected. | Actual-device/live Calendar display acceptance remains separate. |
| AC-13 | Foundation; booking | Late/stale closure decisions, expiry locks and withdrawal/dispatch races pass. | Include live terminal/uncertain behavior in final journey. |
| AC-14 | Agent tools; compatibility | SDK, application OAuth and actual requester CLI protocol evidence exists. | Test both roles independently in Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code; none inferred from SDK success. |
| AC-15 | Agent intake; agent tools; compatibility | Built-app SDK and actual CLI tests cover account-free fixed-host consent, clarification, initial creation, exact retries and private continuation without booking-form entry. Production consent, clarification and bound continuation pass with controlled SQL creation; [rollout evidence](05_rebuild_evidence.md#agent-intake-production-rollout--2026-10-09). | Successful fresh production creation through real Calendar preflight, full delegated scheduling and every named client remain unverified. |
| AC-16 | Host setup; booking; compatibility | Linked setup and explicit host-private request selection/discussion pass with signed eve fixtures, including restart, scope isolation and original-context replies; protected current-proposal web handoffs also pass. Private routing is deployed with rollback-only production verification; iMessage proposal decisions remain pending. | Implement [private request discovery, explicit selection and proposal decisions](../../openspec/changes/route-imessage-host-requests/tasks.md), then verify authorized real iMessage question/revision/approval and separate decline with current requester agreement. |
| AC-17 | Host setup; compatibility | Unlinked/group/stale authority denial, proof expiry and queued/outbound unlink fencing pass. | Actual private/group/ambiguous-message acceptance with controlled identities. |
| AC-18 | Host setup; booking; compatibility | Runtime restart, durable reply uncertainty and booking duplicate recovery pass separately. | Combined live message approval/restart/web race and notification failure journey. |
| AC-19 | Agent tools; compatibility | Scoped OAuth consent/deny, refresh and revocation; production requester CLI acceptance. | Actual host connection after Google login and per-client denial/revocation. |
| AC-20 | Agent tools; compatibility | Issuer/resource/token type/scope denial and no OAuth-to-meeting approval pass. | Repeat against each actual supported client and live host flow. |
| AC-21 | Agent intake; agent tools | Intake grants now bind one reserved request; local creation/continuation and production bound read, foreign-request denial, original-browser handoff and revocation pass. | Complete fresh production bootstrap through live Calendar readiness and the full account-free workflow; retain AC-15 client gates. |
| AC-22 | Agent tools; compatibility | Machine-readable CLI, SDK calls, same-request retry/version and browser handoff coverage. | Full deployed MCP/CLI scheduling parity and missing-setup journey through confirmation. |
| AC-23 | Host setup; agent tools; compatibility | Root instructions, readiness-only share links and resumable setup fixtures pass. | Both interrupted/existing/new host paste-to-agent paths in every named client, with actual consent. |
| AC-24 | Agent intake; agent tools; compatibility | Instruction version `2026-10-09.6` and pinned intake-capable CLI are deployed; local SDK/CLI bootstrap and production bounded clarification pass. | Exact paste-prompt journeys in each named client, fresh live-provider creation and pending-to-confirmed outcome remain open. |
| AC-25 | Public entry; agent tools; compatibility | Public-only documents, unavailable hosts and safe fallback fixtures pass. | Actual fetch/connect failure and denied consent paths per named client. |
| AC-26 | Foundation; operator invitations; agent tools | Waitlist deduplication, verified-recipient redemption, expiry/revocation, concurrent and direct bypass tests pass. | Complete host MCP/CLI admission journey and authorized invitation mailbox acceptance. |
| AC-27 | Calendar; feasibility; compatibility | Request-scoped consent/denial, manual replacement, busy exclusion, revocation and changed availability fixtures pass. | Actual uninvited requester Google consent, refresh, disconnect/reconnect and browser return. |
| AC-28 | Host setup; Calendar; compatibility | Private suggestion/provenance controls, sparse/failed scans, explicit choices, mobile/keyboard/zoom and two-host fixtures pass. | Authorized live Calendar scan and full actual Google/iPhone onboarding; host-setup tasks 2.5, 5.2 and 5.3 remain open. |
