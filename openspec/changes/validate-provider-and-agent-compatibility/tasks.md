# Tasks

Tasks describe reconstruction checks and decisions. Incremental provider boundaries are distinguished from complete live compatibility gates. Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md#compatibility-gates).

## 1. Runtime and repeatable checks

- [x] 1.1 Pin reference commits, runtime/dependency versions and direct OpenAI model configuration; verify separate eve/Next.js builds, shared `lib/` boundaries and root `vercel.ts` composition with a deployed smoke test.
- [x] 1.2 Select eve persistence, worker/recovery placement and execution limits; verify two-host/two-request isolation, revocation, restart mid-turn and repeated tool execution without duplicate domain effects. [Managed and local acceptance](../../../documentations/technical_specification/05_rebuild_evidence.md#managed-workflow-recovery-acceptance--2026-10-10).
- [ ] 1.3 Add sanitized read-only and deterministic provider probes; verify Supabase Auth/discovery, Google/Routes, AgentMail, Photon, Cloudflare mail and OpenAI contracts without treating credential presence as product readiness.
- [x] 1.3a Verify the AgentMail Svix transport boundary with pinned SDK, raw UTF-8 signatures, time/size/read bounds, inbox/thread isolation, minimized locators and signed-payload digest fixtures; document SDK behavior and omitted-body recovery. This does not complete durable deduplication, sender binding, dispatch or live webhook acceptance.
- [x] 1.3b Implement and verify bounded AgentMail full-message reads against receipt identity, restricted delivery labels, explicit unavailable text states and untrusted address claims; cover redirect, malformed/oversized/stalled responses and a read-only controlled inbox probe. Sender/request binding and dispatch remain separate gates.
- [x] 1.3c Verify raw-message retrieval and independent aligned DKIM evidence with pinned library, whole-body/signed-identity checks, bounded DNS/downloads, forged/altered/partial-signature fixtures and a controlled read-only live probe. Contact proof and protected request binding remain separate.
- [ ] 1.4 Document verified runtime, callbacks, provider contracts and recovery limitations in the owning architecture/setup docs; confirm exact reconstruction origin and selected Supabase project without revealing secrets.

## 2. Personal-agent compatibility

The application-owned OAuth and initial MCP transport pass the controlled requester browser/terminal acceptance recorded in [live authorization](../../../documentations/technical_specification/05_rebuild_evidence.md#live-agent-authorization--2026-10-08) and [live MCP calls](../../../documentations/technical_specification/05_rebuild_evidence.md#live-requester-mcp-acceptance--2026-10-08). The [actual requester CLI](../../../documentations/technical_specification/05_rebuild_evidence.md#live-requester-cli-acceptance--2026-10-09) also passes production browser consent, calls, refresh and revoke/logout on macOS. Task 2.1 covers that protocol boundary; actual named-client, host Google and complete scheduling journeys remain open.

- [x] 2.1a Probe pinned local Supabase OAuth discovery, public registration, S256/code replay, form/JSON resource checks, token audience, refresh and revocation. Record stock GoTrue v2.197.0 resource-isolation failures and reject it as an unmodified MCP authorization boundary; retain full task 2.1 until an enforcing implementation passes.

- [x] 2.1 Configure and test protected MCP OAuth discovery, registration, PKCE, issuer/resource audience, refresh and revocation in browser and terminal paths; verify application-owned grants and captured negative cases.
- [ ] 2.2 Exercise Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code separately using their actual versions; verify requester/host permissions, current-proposal confirmation, stale decisions and revoked access.
- [ ] 2.3 Document client-by-client results and limitations; verify untested clients stay open and no model field substitutes for human approval.

## 3. Messaging and provider journeys

- [ ] 3.1 Test native eve Photon authentication and controlled inbound/reply routing; verify signatures/provider identity, private host linking, delivery/restart recovery and web confirmation continuation. Document any evidence-based bridge requirement before creating one.
- [x] 3.2a Implement the bounded single-recipient AgentMail reply transport, stable idempotency identity/window and exact acceptance readback; verify redirects, malformed/oversized/stalled responses, current-authority denial and no blind retry with deterministic tests. Durable outbound processing and controlled live compatibility remain open.
- [ ] 3.2 Exercise AgentMail raw-body signature verification, replay rejection, received-parent reply threading, idempotency windows and uncertain-send recovery with dedicated identities; verify changed-payload conflicts and sanitized evidence.
- [ ] 3.3 Test Cloudflare transactional/Auth mail against the selected Supabase project and reconstruction links; verify sender setup, accepted/delivered distinction and contact-safe failure handling.
- [ ] 3.4 Complete actual host/requester Google consent, refresh, disconnect/reconnect, controlled reads and Calendar booking reconciliation; verify separate scopes, browser callback binding and exact event identity after a lost response.
- [ ] 3.5 Validate Routes for intended geography/modes and both adjacent trip directions with host margins; verify unknown/no-route/failure and explicit manual allowances remain distinct.
  - Incremental evidence: [2026-10-09 bidirectional live Routes/evaluator probe](../../../documentations/technical_specification/05_rebuild_evidence.md#bidirectional-live-routes-evaluation--2026-10-09) verifies fixed public landmarks and both margins. Full selected-deployment physical booking and live host manual-allowance acceptance remain unverified.
- [ ] 3.6 Update current provider setup and implementation gates with dated sanitized results; verify no fixture, credential probe or transport-only check is claimed as a full product journey.
