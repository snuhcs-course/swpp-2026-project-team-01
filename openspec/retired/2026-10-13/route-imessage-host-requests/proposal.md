# Proposal

## Why

Phase 7 and [J-06](../../../documentations/user_experience/01_user_journeys.md#j-06--host-review-through-imessage) require private discussion of meeting requests from a linked iMessage identity. Current `fmat_photon_dispatch` always selects `host_setup`, and conversation authorization rejects Photon grants for any other audience. Existing setup and browser-handoff tests therefore do not prove request continuity or AC-16.

## What Changes

- Expose a bounded, currently authorized host request list to the application assistant without exposing saved contact details or requester transcripts.
- Add explicit, durable request selection on each verified private link and resume that request's canonical host-private conversation. Keep setup independently selectable and never choose a request from ambiguous assent or model inference.
- Bind each accepted receipt to its selected scope so retry, restart and later selection cannot reroute it; label outbound request replies with their context.
- Support current-proposal review, proposed revisions and explicit attributable decisions on iMessage, with authored proposal context and stale/ambiguous rejection. Retain authenticated browser continuation when attribution cannot be established.
- Verify isolation, revocation, ordering, retry and decision semantics before controlled live-provider acceptance. Correct the acceptance inventory to distinguish setup-only evidence from request workflow evidence.

## Capabilities

### New Capabilities

- `imessage-request-continuity`: Private request discovery, explicit selection, canonical conversation continuity and proposal-specific decision context on a verified iMessage link.

### Modified Capabilities

None. Existing [conversation access](../../specs/conversation-access/spec.md), [application commands](../../specs/application-commands/spec.md) and [meeting requests](../../specs/meeting-requests/spec.md) remain controlling authority boundaries.

## Impact

Photon SQL ingress/dispatch/reply authorization, private selection state, conversation tool contracts and eve tools, proposal review/decision integration, deterministic database/runtime/provider tests, provider runbook, implementation plan and acceptance inventory. Use additive pg-delta migrations; preserve historical receipt bindings. No new provider dependency. Live receiver credentials and an authorized iPhone recipient remain external acceptance prerequisites, not permission to mark fixture evidence as live completion.
