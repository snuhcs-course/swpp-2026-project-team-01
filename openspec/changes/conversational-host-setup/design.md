# Design

## Context

See [proposal.md](proposal.md). Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md): root `agent/`, Next.js in `apps/web/`, shared contracts and authorized server operations in root `lib/`, and separately built eve/web services composed through root `vercel.ts`. The reconstruction target is `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`. Runtime and provider compatibility require fresh verification.

## Goals / Non-Goals

**Goals:** one authorized setup state across web and private iMessage; useful suggestions with explicit choices; secure browser continuation; restart-safe transport and honest readiness.

**Non-Goals:** group iMessage, booking approval during setup, guest scheduling logic in the onboarding agent, new Google scopes or a mandatory separate bridge service.

## Decisions

### Shared application authority

Eve tools delegate to authorized operations in `lib/server/`; model output cannot admit a host, authorize a grant or save settings by itself. Store host-owned transcript access, versioned drafts and current-review confirmations separately from provider identity. Serialize cross-channel mutations, reject stale reviews and recheck admission and channel authority before processing and dispatch. Use typed contracts for protected actions; runtime failure leaves confirmed settings unchanged and offers structured recovery.

### Agent guidance and preference confirmation

Derive the next action from authorized server state. Explicit current answers and confirmed settings outrank authorized observations, which outrank labeled starter defaults. Keep provenance, uncertainty and dismissed suggestions with the draft. Ask one focused unresolved question, allow correction/skip where permitted, and never guess identity, consent, verification codes, exact addresses or approval.

Explicitly ask online/in-person/either unless answered. In-person/either requires preferred areas/venues or **Decide per meeting**, then supported transportation or **Depends on the trip**, and a separate extra travel buffer. Suggestions accompany these questions but cannot count as answers. Online-only skips physical venue/travel questions. Current final review includes applicable explicit answers; actual bookings still resolve locations, modes and both travel legs.

### Calendar analysis and in-chat experience

After browser consent, recommend calendar roles from authorized metadata, distinguish conflict calendars from a writable booking destination and let the host choose a disclosed bounded scan. Resolve scan range, normalization and freshness limits before implementation. Normalize recurrence, timezone/DST, all-day, cancelled and free events server-side. Only minimized summaries reach the model; event text is untrusted data, not instructions. Candidate venues remain private and are not labeled home/work or published without explicit choice.

Calendar cards, scan state, editable weekly preview, preference actions and final review live inside `/app`. Use real status, accessible text alternatives, focus management and mobile/reduced-motion behavior. Sparse, partial, failed or revoked reads produce uncertainty and manual recovery. Applying a suggestion changes only the draft. Calendar selection, permissions, refreshed analysis or cross-channel edits invalidate dependent results and reviews. Future booking availability is checked again.

### Browser handoffs and private linking

Sign-in, email-bound invitation redemption and Google consent use protected browser controls; tokens never enter model context or transcripts. Resume from server state and recheck selected calendar IDs/permissions. iMessage continuation URLs contain no long-lived credentials.

After web settings review, show **Connect iMessage** and **Maybe later** inline. Phone entry → **Send code** → protected six-digit field → **Confirm and link** → verified connected state. Typed endpoints handle phone/code actions outside the model path. Store an expiring hashed challenge bound to the initiating browser and chosen private conversation, plus one durable outbound intent. Never return the code in the API or persist it in transcript, analytics or card state. Apply bounded attempts, rate limits, expiry and single-use consumption; change-number invalidates the prior challenge. A known failed/revoked dispatch cannot link; an accepted or uncertain send still requires code possession.

For iMessage-first entry, bind the short-lived browser continuation to the original private sender/conversation; require authenticated admission, a fresh response in that conversation and browser confirmation. Reject groups and mismatched identities. Permit one active private link per host and one host per channel identity; conflicts require explicit unlink/relink. Unlink revokes queued and outbound authority while web remains available.

### Photon transport and durable effects

Test eve's native Photon channel with the selected project and current SDK contract. Application-owned verified sender-to-host/session mapping remains mandatory. Persist/deduplicate provider IDs and outgoing intents, order turns by authorized conversation and distinguish acceptance, delivery, failure and uncertainty. A lost acknowledgement cannot trigger a fresh message identity or blind resend. Scope reconciliation to the authorized conversation.

Only create a narrow persistent bridge if the runtime spike demonstrates it is necessary. In that case it receives scoped service credentials and delegates to application commands, with no arbitrary host-operation surface or embedded scheduling policy. Hosting selection remains a runtime gate, not an assumed Fly.io dependency.

## Risks / Trade-offs

- Concurrent channels → serialized operations and current revision checks.
- Private data or credential leakage → protected controls, minimized model context and host-only reads/streams.
- Provider outage or restart → durable inbox/outbox, conservative reconciliation and web continuation.
- False preferences → labeled evidence, explicit applicable answers and current final confirmation.

## Implementation and verification

Build private persistence/contracts, shared authorized onboarding operations, web guidance/cards and provider handoffs in that order. Preserve existing migration history and add reviewed migrations through pg-delta. Validate disposable local rebuilds and isolation before controlled live tests. Test current host setup, OTP linking, consent return, cross-channel resumption and revocation against the reconstruction origin. Disable affected entry points on failure without deleting settings or unresolved outbound evidence. The runtime transport choice and bounded scan contract are prerequisites to their implementation slices.

### Implemented private drafts and review controls (2026-10-07)

The browser calls `HostSetup` and service-only `fmat_host_setup`; eve calls `fmat_conversation_tool` with the current execution grant. Both use the retained host-owned setup conversation/turn/draft/review tables. Mutations lock the current admitted host and setup conversation, bind immutable input to actor/operation/idempotency identity, and advance a conversation revision. Browser-authenticated edits receive host provenance; model edits receive assistant provenance. Confirmed policy is unchanged until the explicit confirmation transaction. Model suggestions cannot overwrite explicit answers or satisfy applicable mode/location/travel questions. Online normalization clears physical-field provenance so switching back requires an explicit answer.

Read projections separate confirmed settings, draft answers, original clarification questions, computed missing fields and the current review. Changes to confirmed rules or calendar selection hide stale reviews. Protected refresh requires current conversation/rules versions, preserves draft answers/provenance/questions and generates a new review; ordinary edits reject a stale base instead of discarding earlier answers. A fresh Google list checks selected IDs and destination write permission before confirmation, followed by atomic version/grant checks. Lost-confirmation replay reauthorizes the current host and does not save again. These operations create no booking work.

Structured in-chat forms support profile, timezone, weekly windows, meeting buffer, explicit mode/location, per-trip transportation and separate extra travel buffer during model failure. They label starter defaults and preserve unresolved questions until the host explicitly resolves them. Full Calendar analysis, suggestion dismissal, preset alignment, public-link readiness and iMessage linking remain separate unfinished tasks.
