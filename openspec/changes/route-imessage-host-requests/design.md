# Design

## Context

See [proposal.md](proposal.md). `22_photon_execution.sql` binds all accepted private receipts to the canonical `host_setup` scope. `08_conversation_access.sql` enforces that limitation independently. `33_host_requests.sql` already provides bounded host-owned keyset navigation; web and MCP use it. `23_photon_replies.sql` freezes one reply per runtime input and rechecks its original grant before sending. Reuse these boundaries instead of granting a model a host ID or a provider credential.

## Goals / Non-Goals

Goals: make request discovery, explicit selection and host-only request discussion available on the existing private route, then implement attributable current-proposal interaction with ordered durable receipt handling.

Non-goals: shared/group iMessage conversations, inferred selection or approval from model text, new transport infrastructure, post-booking changes, or weakening existing provider acceptance gates.

## Decisions

1. Add `host_requests_read` as a read-only conversation tool using the current execution grant. Accept the existing bounded query/cursor schema; only host-setup and host-private audiences can use it. Reuse `host_request_page`, but return only request ID, title, revision/status, timestamps and proposal version to the assistant. Omit saved requester name/contact fields. Search remains host-scoped and SQL treats query text as data. Pagination is navigation, never authority. This foundation is independently testable before routing activation.
2. Persist selection on the current private link, never globally on the host. Explicit application-recognized selection identifies the intended request; the model can display choices but cannot change routing. Give each displayed choice a stable request-bound selection reference and confirm the selected context in authored output. Reject unknown/foreign/stale references without changing the previous selection. Selecting setup clears the link selection. Never select the newest or sole request automatically.
3. Resolve selection while serializing incoming receipts for the same private route. Each accepted receipt stores its actual runtime scope through the existing immutable runtime-message binding. A later selection cannot move earlier work. Preserve request-before-host lock order when entering a request scope; coordinate link selection and receipt ordering without holding one host while waiting on another request writer. Test this with competing web edits and parallel dispatch, not only single-worker calls.
4. Permit Photon grants in host-private request scopes only after validating receipt, link, receiver, host admission and exact captured request ownership. Continue to forbid shared audience access and browser-created Photon credentials. Revocation is checked at admission, tool execution and provider send. Prefix request replies with application-authored context so delayed delivery cannot appear to answer another selected request.
5. Current-proposal display/decision context is application-owned and immutable. The displayed proposal version, request revision, current requester agreement and exact private route bind a short-lived decision challenge. Explicit decision syntax is parsed by the application and invokes existing domain commands; model prose and bare assent cannot consume it. Changed proposals, expired/revoked links and duplicate messages cannot manufacture approval. Revision discussion creates a reviewable proposed change; new shared details need requester agreement and renewed approval. Use the authenticated browser when the exact decision cannot be established.
6. Keep real-provider acceptance separate: fixture tests prove application behavior, while controlled tests must prove rendering, private route identity, actual replies, revocation and delivery behavior on the configured iPhone/Photon account.

## Risks / Trade-offs

- Request titles are untrusted free text → bound fields and treat them as data in assistant instructions; never use title matching as authority.
- Selection changes while work is pending → serialize route receipts and preserve each accepted scope, with context-labeled replies.
- Request/host lock inversion → acquire locks in the same order as existing conversation commands and test concurrent web/dispatch paths.
- An old displayed decision is replayed → bind immutable challenge to exact proposal, revision, link and expiry; domain checks still decide validity.
- Early foundation deployment could be mistaken for full continuity → leave routing/decision/live tasks unchecked and name the remaining gaps in plan and evidence.

## Migration Plan

Land and verify the read-only tool first; it neither reroutes existing inputs nor grants decision authority. Add private RLS-protected selection/challenge state and generated additive migrations with historical receipts untouched. Activate routing only with authorization, ordering, runtime and reply tests passing. Review selected-project migration dry runs, deploy and independently verify release alias/guards. Roll back application activation without deleting accepted receipts or applied migration history. Keep the change open until full request interaction and live-provider acceptance pass.
