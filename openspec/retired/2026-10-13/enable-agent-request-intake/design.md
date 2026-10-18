# Design

## Context

See [proposal](proposal.md). PublicIntake already performs current host/Calendar readiness checks and idempotent request creation from a private proof. OAuth presently binds only an existing host/request. The authenticated MCP catalog and CLI cannot bootstrap their requester authority. Preserve the existing verified adapters and add the missing consent state explicitly.

## Goals / Non-Goals

**Goals:** one consent-bound initial request, no manual booking-page details, no requester account, safe lost-result recovery, ordinary requester continuation and explicit scope/expiry enforcement.

**Non-Goals:** anonymous protected MCP, auto-granted access to existing requests, host approval from delegation, provider consent from identity, real outbound messaging without recipient authorization, or claiming named-client compatibility from fixture tests.

## Decisions

- Keep `/mcp` protected. Add a distinct intake principal/grant kind and scope to the application-owned OAuth protocol. Authorization may name a public host handle, but the server resolves its stable host ID and current public profile. The consent page displays client, host, permissions and creation limit; no meeting-details form is required. Existing host and existing-request consent paths retain their semantics.
- Store intake authority privately with client/grant identity, fixed host, reserved request ID, creation deadline, browser-binding hash and eventual request binding. Intake lifetime is fifteen minutes until first creation; after creation, access is bounded by the existing grant/request deadlines. Reauthorization never silently creates another request from a consumed intake. Use existing bounded OAuth admission plus 30 intake admissions per host and 300 service-wide in independent fixed one-hour windows. During authorization start, lock the existing registry budget, service then host intake counters, public host authority and finally client/authorization state. Known-host attempts consume intake admission before later readiness/client checks; consent and exact creation retries must not charge another admission. Rejections must return an error when budget use is intended to commit. Document and test integration before enabling the route.
- Tokens identify the intake principal and granted scopes, never a browser/request proof. Before binding, permit only public host context and initial create. After binding, resolve permitted requester operations through the stored request binding under current authority locks; caller-provided request IDs must match. Refresh never changes actor, host, request or granted scope. Host operations remain unavailable for this principal.
- Reuse PublicIntake readiness and the request-create domain contract. Current checks, creation and browser revocation lock the private intake row before resolving a request binding, then follow the existing domain authority and client/grant lock order. The final transaction locks/rechecks the grant and fixed host, persists the request/binding and stable retry result together. Provider preflight is version-fenced. Do not create a preliminary fake request to obtain authorization. Normalize and validate details before creating; unresolved mandatory fields return structured clarification. A retry after commit resolves from the saved binding without requiring another Calendar read.
- Derive a high-entropy request proof with a separate server-only key domain and stable intake identity, persisting only its hash. Bind protected browser continuation to the browser that explicitly consented. The browser receives the request credential only in an HttpOnly cookie through a current, bound handoff; tools and terminal output return no continuation secret. A copied request ID or callback cannot install authority. Lost handoff responses recover the same request without rotating its authority or creating new work.
- Add intake-aware OAuth/CLI entry and MCP catalog discovery. The CLI keeps access/refresh state in its existing private store and emits only structured public/request status. Update both skill documents to describe the actual initial flow. Protected human agreement/host approval and Calendar consent remain explicit; within-delegation requester negotiation does not grant host authority.
- Introduce additive desired schema and reviewed pg-delta migrations. Existing grant rows and token families retain their meaning; do not rewrite applied history. Roll out server/schema before public instructions advertise the path. A disabled or unavailable intake feature yields a truthful fallback rather than an alternate anonymous authorization path.

## Risks / Trade-offs

- A new principal kind touches grant checks, token validation, catalog selection and SQL operations. Exercise every protected operation with both unbound and bound intake credentials; default-deny anything not explicitly allowed.
- Initial consent remains a browser OAuth step, not manual booking-page intake. This preserves explicit client authorization. Clients that cannot perform it remain unverified/unsupported until tested; do not infer seven-client coverage from SDK tests.
- Concurrent creation, consent revocation and host readiness changes need a definite lock order and atomic binding. Test both race outcomes and expiry after lock waits, including lost successful responses.
- Browser continuation cannot rely on model-delivered request credentials. Test wrong-browser/cross-origin and replay boundaries before exposing any handoff.
- This implements initial intake only. Full delegated workflow and every named-client acceptance remain under the catalog and compatibility owners; do not close AC-15/21/24 from bootstrap alone.
