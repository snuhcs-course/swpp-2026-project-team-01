# Design

## Context

See [proposal.md](proposal.md) for motivation. `apps/web/src/Host.tsx` currently renders separate admission, rules, Google, and calendar forms. `supabase/functions/api/routes/onboarding.ts` and `supabase/schemas/02_onboarding.sql` already enforce verified recipient admission, idempotent commands, rules validation, writable calendars, and readiness. `SetupState.nextAction` guides resumption. The requester model extractor in `_shared/providers/model.ts` is deliberately limited to meeting details and cannot act as a host setup agent.

The website is React 19/Vite with Tailwind 4 and Base UI shadcn `base-nova`, preset `b6rtA2Hmi`; it is not Next.js. AI Elements is requested explicitly. Its current [documentation bundle](https://elements.ai-sdk.dev/llms.txt) describes Conversation scroll handling, Message/MessageResponse, PromptInput and Suggestion. Spectrum core/iMessage 12.10.1 has passed a real one-send/exact-reply transport probe, but no production host binding or bridge exists. Existing email-delivery edits in this checkout are unrelated and must be preserved.

The current PRD positions optional messaging after core setup. This proposal deliberately changes that ordering in response to the user: linked iMessage is an onboarding entry surface. Update the owning PRD/interface text during implementation, rather than treating the old order as a constraint or editing unrelated pending email sections.

## Goals / Non-Goals

**Goals:** One setup state and authorization boundary for both channels; free-text preference capture with explicit versioned review; real browser consent continuation; portable, restart-safe bridge operation.

**Non-Goals:** Agent MCP rollout, requester email chat, booking approval from setup, group iMessage, new hosting accounts, and changing existing calendar scopes. Setup chat must not become a general-purpose model tool executor.

## Decisions

### Shared durable onboarding service

Add private host-scoped conversation, turn, draft revision, review snapshot, and channel-link records through declarative schema and generated migrations. Store unconfirmed drafts separately from `fmat.hosts.rules`. Actor identity comes from the verified web session or an authenticated bridge request resolved through an active channel link, never from model output or a public hostId.

Expose bounded read, append-turn, confirm-draft, and link-management operations through the existing command boundary. Use persistent turn identifiers and expected revisions. Build one onboarding reducer/orchestrator shared by adapters; use existing setup/calendar operations for final mutations. Recheck current host admission and readiness at each privileged action. Existing hosts seed chat from their current setup, without resetting confirmed settings. Keeping transcripts only in React or separate channel-specific agents was rejected because it loses continuity and duplicates authority rules.

### Narrow language interpretation, deterministic execution

Add a separate strict host preference extraction contract using the configured existing model provider. Only supported rule fields and clarifying text are allowed; server validation rejects unknown fields, invalid times/timezones, missing values, and excessive payloads. No arbitrary tools, SQL, actor identities, tokens, provider calls, or private calendar events enter model context. Bound context to relevant recent turns and the current sanitized draft; retain no raw provider/auth payloads in transcript logs.

Show each proposed patch in a concrete review summary. Website confirmations carry a server review identifier and expected revision. iMessage confirmations must refer to the pending current review, with a short review reference if multiple summaries could be confused; an unqualified stale yes is never enough. Applying a review uses the existing setup validators and returns authoritative saved state. Provide the existing structured editor as recovery from model failure. A cosmetic chat wrapper around the old form or unchecked model writes would not meet the request.

### Website uses the requested AI Elements

Install only Conversation, Message, PromptInput, and Suggestion through their official registry CLI after inspecting dependencies and pinning resolved versions. Use `@/components/ai-elements/*`, preserve the existing CSS tokens/preset, and inspect Base UI versus Radix composition before changes. Adapt needed primitive imports rather than migrating the whole app. Add Streamdown source scanning to `src/index.css` at the correct relative path if MessageResponse is installed. The user-selected AI Elements primitives take precedence over the generic shadcn chat-component suggestions.

Replace the primary setup layout with transcript, composer, suggested replies, and compact server-derived progress. Put invitation redemption, calendar choices, and review controls in appropriate conversation actions. No model selector, file upload, fabricated transcript, or simulated streaming. A durable JSON turn endpoint is sufficient initially; real streaming can be added only with tested persistence semantics. Reuse current APIs/session storage and Vite architecture rather than copying Next.js example server routes.

### Browser handoffs keep their existing authority

Unauthenticated entry offers sign-in; unadmitted accounts redeem their email-bound invitation with a protected control that never sends the token to the model. Google actions call the current browser-bound OAuth flow and return to setup; chat reloads authoritative status and resumes its next action. Calendar choices map user-visible labels to currently authorized IDs server-side, disambiguate duplicate names, and recheck permission before saving. Do not put OAuth tokens or long-lived session credentials into iMessage URLs.

### Link iMessage with proof on both sides

Support both entry paths. From website, an authenticated admitted host requests a short-lived challenge and opens the advertised provider contact; the service requires a challenge response from that exact private sender/conversation plus explicit browser confirmation of the observed masked handle. From an inbound private iMessage, create a short-lived browser continuation bound to that sender/conversation; after verified host login/admission, require a fresh response in the originating conversation and browser confirmation. Store challenge hashes, expiry, attempts, and single-use consumption; rate-limit public initiation and reject groups. Neither possession of a phone number in a profile nor the earlier controlled test registration establishes a product account link.

Enforce one active host per channel identity and one active private iMessage link per host in this slice; conflicts require explicit unlink/relink. Use normalized provider identity and immutable verified conversation binding. Check revocation again for queued turns and outgoing messages. Website remains available after unlink.

### Narrow persistent Node Photon bridge

Create a separate Node 24 service using pinned tested Spectrum versions, not a long-running gRPC stream inside a Supabase Edge request. The bridge receives provider events, rejects untrusted shapes/group contexts, and calls authenticated internal onboarding endpoints. Store provider IDs with unique constraints and serialize turns by host conversation. Persist outgoing reply intent before send, assign stable clientMessageId, disable blind retries, and reconcile uncertain outcomes before any resend. Verify only authorized linked conversation history; no global message-history sweeps. Record provider acceptance separately from delivery and user replies.

Keep scheduling logic and database access behind the application command boundary; the bridge gets narrowly scoped service authentication and no direct arbitrary host operation surface. Deployment must supply a persistent existing Node runtime, restart policy, health status, and secret injection. A dedicated container service can run locally for integration tests; production destination selection is a rollout prerequisite, not evidence that iMessage is shipped.

## Risks / Trade-offs

- Base UI compatibility and dependency size → preview registry output, adapt only required primitives, compare production bundles and test keyboard/mobile behavior.
- Free-text ambiguity → retain draft, ask one useful clarification at a time, show explicit summary before changes.
- Concurrent website/iMessage turns → serialize and revision-check; stale review cannot overwrite newer edits.
- Token or private preference leakage → protected inputs for tokens, redacted model context/logs, host-only transcript APIs, no public transcript download.
- Provider outages or bridge restart → durable inbox/outbox, bounded operations, honest unavailable/uncertain states, website continuation.
- Scope includes a new service → complete backend contracts and bridge tests before claiming cross-channel readiness; separate transport evidence from product evidence.

## Migration Plan

1. Add declarative private tables and grants, generate migration with pinned pg-delta workflow, and rebuild/test the disposable local database.
2. Add shared onboarding endpoints and deterministic tests; keep the existing form path usable during rollout.
3. Install/adapt the AI Elements components and connect website chat to real endpoints; verify mobile, keyboard, refresh, and OAuth resumption.
4. Run the bridge locally with deterministic provider fixtures, then configure a suitable persistent production runtime and verify linking with the controlled account.
5. Run authorized live end-to-end onboarding across both channels; separately record actual Google consent. Do not send unsolicited probe messages or claim booking tests completed.
6. Update product/interface/setup documentation, preserving unrelated email changes. Archive only after required implementation and evidence exist.

Rollback disables chat/bridge entry and restores structured setup without deleting existing host settings, links, or audit evidence. Do not apply destructive schema rollback; retain data for reconciliation.

## Open Questions

Which existing persistent Node hosting environment will run the bridge? Resolve before deployment; local implementation and deterministic verification can proceed without provisioning a new paid service.
