# Design

> Rebuild update (2026-10-07): calendar-informed guided onboarding below is pending implementation. The [rebuild plan](../../../documentations/technical_specification/04_implementation_plan.md) and [frontend architecture](../../../documentations/technical_specification/02_frontend_architecture.md) supersede former Vite/source-preservation and fixed deployment assumptions. Historical checked tasks and deployment evidence do not verify the replacement or the new scan/recommendation flow.

## Context

See [proposal.md](proposal.md) for motivation. `apps/web/src/Host.tsx` currently renders separate admission, rules, Google, and calendar forms. `supabase/functions/api/routes/onboarding.ts` and `supabase/schemas/02_onboarding.sql` already enforce verified recipient admission, idempotent commands, rules validation, writable calendars, and readiness. `SetupState.nextAction` guides resumption. The requester model extractor in `_shared/providers/model.ts` is deliberately limited to meeting details and cannot act as a host setup agent.

The website is React 19/Vite with Tailwind 4 and Base UI shadcn `base-nova`, preset `b6rtA2Hmi`; it is not Next.js. AI Elements is requested explicitly. Its current [documentation bundle](https://elements.ai-sdk.dev/llms.txt) describes Conversation scroll handling, Message/MessageResponse, PromptInput and Suggestion. At proposal time, Spectrum core/iMessage 12.10.1 had passed a real one-send/exact-reply transport probe, but no production host binding or bridge existed. The bridge is now deployed; a real linked-host journey is still pending. Existing email-delivery edits in this checkout are unrelated and must be preserved.

The current PRD positions optional messaging after core setup. This proposal deliberately changes that ordering in response to the user: linked iMessage is an onboarding entry surface. Update the owning PRD/interface text during implementation, rather than treating the old order as a constraint or editing unrelated pending email sections.

## Goals / Non-Goals

**Goals:** One setup state and authorization boundary for both channels; free-text preference capture with explicit versioned review; real browser consent continuation; portable, restart-safe bridge operation.

**Non-Goals:** Agent MCP rollout, requester email chat, booking approval from setup, group iMessage, new hosting accounts, and changing existing calendar scopes. Setup chat must not become a general-purpose model tool executor.

## Decisions

### Agent-led onboarding and suggestion precedence

The agent explains and advances every permitted onboarding stage from entry to completion, including protected authentication/admission, Google browser handoffs and inline iMessage linking. Derive the next action from authorized server state; unauthenticated/unadmitted guidance contains no private host data. Resumption and errors receive concrete next actions instead of leaving the host at a checklist.

Suggest missing settings before requesting free-form answers. Current explicit choices and confirmed settings outrank authorized evidence; configurable starter defaults fill remaining preference gaps and are labeled as defaults, never observations. Preserve field-level provenance, uncertainty and dismissals alongside draft revision. Ask one focused question when a useful safe suggestion cannot resolve a required detail or a conflict needs a human decision. Corrections update the draft and invalidate stale reviews without silently saving policy. Never infer verified identity, consent, exact addresses or approval. The [frontend guidance](../../../documentations/technical_specification/02_frontend_architecture.md#agent-led-guidance-and-suggestion-first-preferences) owns action labels and presentation.

### Explicit location preference

Location preference is an explicit onboarding question, even when calendar-based suggestions are available: **“Do you prefer online meetings, in-person meetings, or either?”** Show **Online**, **In person** and **Either** choices, with any recommendation labeled as a suggestion. For in-person or either, follow with **“Where do you prefer to meet?”** and editable suggested areas/venues, **Enter a place** and **Decide per meeting**. The host must answer or explicitly choose per-meeting decisions before final settings confirmation; an inferred or preselected option is not an answer. Reuse an explicit answer already given instead of asking again. Online-only hosts need no physical venue. Do not infer home/work addresses or publish observed locations; per-meeting decisions leave actual booking location and travel checks to the proposal workflow.

For hosts accepting in-person meetings, follow the location question with **“How do you usually get to meetings?”** Offer supported travel modes such as **Driving**, **Public transit** and **Walking**, plus **Depends on the trip**. Ask for an explicit choice even when suggesting a mode; calendar locations alone do not establish transportation habits. Then ask **“How much extra time should I leave around travel?”** with an editable starter buffer, clearly separate from estimated journey duration. Reuse already explicit answers and skip these questions for online-only setup. A per-trip choice is valid onboarding policy but requires the applicable mode/allowance to be resolved before offering a physical candidate. Unsupported regional routing must remain unresolved or use an explicit manual allowance, never a silent mode substitution or zero travel. Final review includes transport policy and buffer.

Persist explicit-answer state separately from suggested values so a generated default cannot satisfy final-review validation.

### Shared durable onboarding service

Add private host-scoped conversation, turn, draft revision, review snapshot, and channel-link records through declarative schema and generated migrations. Store unconfirmed drafts separately from `fmat.hosts.rules`. Actor identity comes from the verified web session or an authenticated bridge request resolved through an active channel link, never from model output or a public hostId.

Expose bounded read, append-turn, confirm-draft, and link-management operations through the existing command boundary. Use persistent turn identifiers and expected revisions. Build one onboarding reducer/orchestrator shared by adapters; use existing setup/calendar operations for final mutations. Recheck current host admission and readiness at each privileged action. Existing hosts seed chat from their current setup, without resetting confirmed settings. Keeping transcripts only in React or separate channel-specific agents was rejected because it loses continuity and duplicates authority rules.

### Narrow language interpretation, deterministic execution

Add a separate strict host preference extraction contract using the configured existing model provider. Only supported rule fields and clarifying text are allowed; server validation rejects unknown fields, invalid times/timezones, missing values, and excessive payloads. No arbitrary tools, SQL, actor identities, tokens, provider calls, or private calendar events enter model context. Bound context to relevant recent turns, the current sanitized draft and minimized derived schedule summaries described below; retain no raw provider/auth payloads in transcript logs.

Show each proposed patch in a concrete review summary. Website confirmations carry a server review identifier and expected revision. iMessage confirmations must refer to the pending current review, with a short review reference if multiple summaries could be confused; an unqualified stale yes is never enough. Applying a review uses the existing setup validators and returns authoritative saved state. Provide the existing structured editor as recovery from model failure. A cosmetic chat wrapper around the old form or unchecked model writes would not meet the request.

### Website uses the requested AI Elements

Install only Conversation, Message, PromptInput, and Suggestion through their official registry CLI after inspecting dependencies and pinning resolved versions. Use `@/components/ai-elements/*`, preserve the existing CSS tokens/preset, and inspect Base UI versus Radix composition before changes. Adapt needed primitive imports rather than migrating the whole app. Add Streamdown source scanning to `src/index.css` at the correct relative path if MessageResponse is installed. The user-selected AI Elements primitives take precedence over the generic shadcn chat-component suggestions.

Replace the primary setup layout with transcript, composer, suggested replies, and compact server-derived progress. Put invitation redemption, calendar choices, and review controls in appropriate conversation actions. No model selector, file upload, fabricated transcript, or simulated streaming. A durable JSON turn endpoint is sufficient initially; real streaming can be added only with tested persistence semantics. For the replacement, follow the Next.js/eve server and session boundaries in frontend architecture; existing Vite APIs and storage are historical reference.

### Calendar-informed guided onboarding (replacement)

The [frontend flow](../../../documentations/technical_specification/02_frontend_architecture.md#guided-calendar-onboarding) owns visual interaction details and the [backend analysis boundary](../../../documentations/technical_specification/01_backend_architecture.md#calendar-informed-onboarding) owns data minimization, deterministic summaries and freshness. Show one clear next step, real connection/scan state, calendar cards with reasons and permission labels, an accessible weekly preview, private location/mode suggestions and a current final review. No fabricated data or progress; completed steps remain editable.

After Google consent, use authorized metadata to recommend calendars for conflict checking and a writable booking destination. The host selects the calendars and sees the bounded analysis period before **Analyze selected calendars** reads events. Do not broaden Google scopes. Derive occupied/free time and location/mode patterns on the server, then give the model only minimized summaries for explanations; raw events and event instructions do not enter agent context. Keep necessary venue candidates private and do not infer home/work identity. Recurring gaps suggest possible windows, not preferred hours; repeated venues suggest questions, not permission to save/publish addresses.

Each suggestion has provenance, limitations and a draft/source revision. **Use**, edit or dismiss acts on the draft only; final explicit current-review confirmation is required to save selections/rules. Recheck permissions and reject stale analysis/confirmation after calendar changes, refresh or cross-channel edits. Unknown, sparse, partial or revoked data yields honest uncertainty and manual setup, never invented preferences. Future availability is checked again during booking. Pin scan range, normalization and refresh limits before implementation and cover them with deterministic fixtures and one controlled consented scan.

### Browser handoffs keep their existing authority

Unauthenticated entry offers sign-in; unadmitted accounts redeem their email-bound invitation with a protected control that never sends the token to the model. Google actions call the current browser-bound OAuth flow and return to setup; chat reloads authoritative status and resumes its next action. Calendar choices map user-visible labels to currently authorized IDs server-side, disambiguate duplicate names, and recheck permission before saving. Do not put OAuth tokens or long-lived session credentials into iMessage URLs.

### Link iMessage with proof on both sides

Support both entry paths. From website, an authenticated admitted host chooses **Connect iMessage** in `/app` chat. An inline card collects the phone number and **Send code**, then advances to a protected code field and **Confirm and link**, then a verified connected state. **Maybe later**, delivery failures, expiry, retry and change-number stay in the conversation; no separate page or settings dialog is required. These inputs call typed linking endpoints directly, never the model or append-turn endpoint. Do not persist the entered code in transcript, analytics or card state; reload restores only safe challenge status. The code is sent to the chosen private iMessage number. The backend saves a short-lived challenge and one durable outbound intent before the bridge sends the code to that exact private conversation. The browser receives only a challenge identifier, masked recipient, and browser proof; the code itself travels only in iMessage. Entering it in the requesting browser establishes possession of both sides, with expiry, bounded attempts, and single-use consumption. An accepted/uncertain dispatch can be verified by code possession, but a known failed or revoked dispatch cannot link. The challenge's chosen sender and conversation become the immutable link binding. From an inbound private iMessage, retain a short-lived browser continuation bound to that sender/conversation; after verified host login/admission, require a fresh response in the originating conversation and browser confirmation. Rate-limit initiation and reject groups. Neither possession of a phone number in a profile nor the earlier controlled test registration establishes a product account link.

Enforce one active host per channel identity and one active private iMessage link per host in this slice; conflicts require explicit unlink/relink. Use normalized provider identity and immutable verified conversation binding. Check revocation again for queued turns and outgoing messages. Website remains available after unlink.

### Narrow persistent Node Photon bridge

Create a separate Node 24 service using pinned tested Spectrum versions, not a long-running gRPC stream inside a Supabase Edge request. The bridge receives provider events, rejects untrusted shapes/group contexts, and calls authenticated internal onboarding endpoints. Store provider IDs with unique constraints and serialize turns by host conversation. Persist outgoing reply intent before send, assign stable clientMessageId, disable blind retries, and reconcile uncertain outcomes before any resend. Verify only authorized linked conversation history; no global message-history sweeps. Record provider acceptance separately from delivery and user replies.

Keep scheduling logic and database access behind the application command boundary; the bridge gets narrowly scoped service authentication and no direct arbitrary host operation surface. Deployment must supply a persistent Node runtime, restart policy, health status, and secret injection. Fly.io is the selected target: app `fmat-photon-bridge` runs one shared CPU/512 MB Machine in Tokyo with auto-stop disabled. CLI authentication, strict configuration validation, local checks, production health and restart recovery pass. The [runbook](../../../apps/photon-bridge/README.md) owns operational commands and pricing. A real linked-host onboarding journey remains to be verified.

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

Fly.io resolves the hosting-provider choice; the production singleton is deployed and consumes billable compute. An authorized real linked-host onboarding journey remains unverified. Fly's limited trial does not provide continuous free operation; see the runtime runbook for current limits.
