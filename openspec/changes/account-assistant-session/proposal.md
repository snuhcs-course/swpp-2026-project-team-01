# Proposal

Tracking issue: [#491](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/491)

## Why

The host's messenger currently chooses between setup and per-request review sessions with different tools, so schedule questions and decisions across requests fail depending on the selected discussion. One ordinary assistant must manage the account's whole schedule, including requests the account sent, without conversation switching.

## What Changes

- **BREAKING:** one host-account assistant session shared by linked iMessage, WhatsApp and Telegram replaces per-request host-review sessions, `selected_request_id` routing and `switch_conversation`; notices never move the conversation.
- One host tool set operates on requests by ref, reusing MCP's domain operations and their authorization, revision checks and idempotency. A decision call accepts several items and returns independent results.
- Account holders handle sent requests through the requester projection within the same account conversation; guests without accounts retain their existing per-request sessions.
- One Postgres-backed eve custom memory provider recalls current DB state, an open-item ledger and private host memory. Existing guest-facing `assistant_notes` never stores private memory. D1–D4 are recorded verbatim in [design.md](design.md#decisions).

## Relationship to existing work

- [`host-decisions-in-one-message`](../host-decisions-in-one-message/proposal.md), #382 / #439: supersede the per-request baseline and one-call-per-decision choice with account routing and a batch call; preserve exact reference resolution, independent ambiguity handling, current versions and truthful outcomes. Its outstanding review/eval work remains outstanding; this proposal does not close it.
- [`channel-actions-in-words`](../channel-actions-in-words/proposal.md): extend its natural-language actions, language and receipt guards; supersede host setup/request selection and account-holder role pickers. Existing decision buttons and exact action commands retain their guards; legacy selection commands must no longer select a session.
- [`agent-led-flows`](../agent-led-flows/proposal.md): reuse its MCP/domain operations and consent checks; no change to MCP onboarding or linking contracts.
- [`host-as-guest-calendars-in-words`](../host-as-guest-calendars-in-words/proposal.md), #334: retain per-request calendar choices and requester projection; supersede its account-holder routing heuristics with one session.
- #480: resolve account holders' own schedule access in that session. Calendar wording and access decisions for guests without accounts remain separate work; do not close all of #480 on this basis.
- #367 / #398: retain the settings behavior already fixed there and replace the need to add settings tools separately to each host audience.
- The [host inbox contract](../../specs/chat-workspaces/spec.md) already removes host web chat; the old per-request web discussion is not a constraint. Existing conflicting audience/routing requirements are explicitly replaced by this change's deltas, not silently treated as current architecture.

## Capabilities

### New Capabilities

- `host-assistant-context`: fresh state, open-item ledger, private memory and their isolation/lifecycle.

### Modified Capabilities

- `conversation-access`: one account audience with host and account-requester projections, retaining anonymous requester separation and messenger-only host chat.
- `host-imessage-channel`: account routing and ref-addressed tools across all linked host messengers; remove switching and notice-driven selection.
- `host-schedule-lookup`: schedule lookup is available throughout the account conversation.

## Impact

Agent tool/instruction resolution and `agent/agent.ts`; conversation/session authorization; `lib/server/imessage-receipts.ts`, `imessage-notice-job.ts`, `channel-selection.ts`; setup/review adapters, MCP-shared host operations and account-requester projection; retention and account deletion. Postgres persistence requires a schema/migration review gate before implementation; this proposal writes no SQL.

Update [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md), [testing baseline](../../../documentations/technical_specification/12_testing_baseline.md) where applicable, data/UX documentation and English-owned Korean mirrors during implementation. Product basis: [one-pager](../../../documentations/01_one_pager.md) and [design principles](../../../documentations/03_design_principles.md). No deployment or shared database writes. No host web redesign, anonymous guest calendar expansion, adversarial eval work or last-N-turn rotation. No unresolved product decision within D1–D4; storage details require the explicit migration gate in the design.
