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

Structured in-chat forms support profile, timezone, weekly windows, meeting buffer, explicit mode/location, per-trip transportation and separate extra travel buffer during model failure. They label starter defaults and preserve unresolved questions until the host explicitly resolves them. Preset alignment, public-link readiness and iMessage linking remain separate unfinished tasks.

### Bounded Calendar analysis contract

An explicit browser scan selects 1–10 authorized calendars, an IANA display timezone, and an exclusive-end 14–56-day range within 90 days of today. Its default UI range is the next 28 days and is disclosed before reading events. Analysis selection does not change conflict calendars or the booking destination. Event reads use `singleEvents=true` and complete pagination (250 per page, ten pages per calendar), with a 20-second deadline, 10,000-event total cap, 2 MiB per-page and 8 MiB total response limits. Any failed, inaccessible, malformed or truncated calendar produces no usable result. No additional OAuth scope is requested.

Provider fields omit titles, descriptions and attendee identities; only the self attendee response is requested to exclude declined invitations. Recurrence expands at Google; normalization clips half-open intervals, uses each calendar's timezone for all-day exclusive dates, and rejects ambiguous offset-free times. Cancelled, transparent, declined and working-location entries do not count as busy. The suggested-window search frame is disclosed as weekdays 09:00–18:00: choose at most one two-hour gap per weekday that was clear on at least 75% of sampled dates. These are candidate preferences, never actual availability or a reservation. Fewer than five busy entries yields labeled weekday-afternoon starter defaults; a dense range with no qualifying gap requires manual times. Repeated plain-text locations (at least two entries, at most five candidates) and video-link counts remain unconfirmed observations. Source locations are private browser text and cannot issue instructions or imply home/work.

Scans bind current Auth/admission, connection generation, rules version and setup revision. Starting one advances the setup revision and supersedes pending reviews. Completion and application recheck those versions; applying also fetches current Calendar permissions. Results expire in 15 minutes; an interrupted scan becomes failed after 90 seconds and requires an explicit new attempt. Start identity prevents duplicate provider dispatch; up to three starts per host per minute are allowed. Scan rows are removed on that host's next scan/status operation after 24 hours; global retention cleanup remains an operations task. Dismissal fingerprints suppress unchanged result content across later scans. Applying only fills missing nonexplicit schedule fields; explicit/confirmed values win, a conflicting display timezone requires manual correction or a new scan, and settings still require final confirmation. Replay does not create another draft.

Model reads expose only scope dates/timezone/count, derived windows/counts and fixed limitation codes; observed places and calendar IDs are excluded. Models cannot select/scan/apply/dismiss through these operations. The browser offers retry, refresh, dismissal and manual edits without a provider-success claim. Complete cross-channel guidance and live AC-28 remain acceptance work.

API semantics follow the [Google events list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) and [event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), checked on 2026-10-07.

### Focused guidance progress

A shared browser-safe derivation supplies one next question to the UI and authorized model read. Host-only progress actions remember optional-analysis skip and schedule/mode dismissal/re-offering under current authority, revision and immutable idempotency identity. Scan start also persists the analysis choice; temporary summary deletion does not reset it. Existing scan evidence is backfilled separately from generated schema changes. These actions do not change settings. Schedule suggestions preserve existing values, label missing defaults, and offer use/adjust/manual paths; dismissed defaults are not repopulated in blank manual fields. Explicit physical location, transportation and extra buffer are paced separately, and the first clarification is resolved independently of later questions. Cross-channel acceptance remains open.

### Atomic reviewed suggestions and source retention

The shared guide directs hosts to current ready Calendar evidence before proposing starter defaults. The browser can review/edit windows, explicitly answer mode and applicable location, and apply the choices in one scan-bound action. Existing explicit answers are retained; a conflicting proposed replacement fails and must use ordinary editing. Place inputs reference a current private candidate index with an editable label, or provide a manual label. Online excludes place input; no venue can infer a mode. Each action rechecks fresh provider access and the existing grant/rules/setup fences before making one private draft.

Draft `origins` is separate from the human/assistant decision provenance: Calendar suggestions, host-edited Calendar suggestions and starter defaults keep their derivation after explicit acceptance. Minimal dates/timezone and scan ID remain with these origins after temporary summaries expire. Changed ordinary edits replace only their own origin; unrelated and unchanged values preserve it. Browser default actions can name bounded `starterFields` only when their values match the documented defaults; models cannot use that input or change dismissed schedule/mode guesses. Old drafts without evidence remain unannotated. End-to-end fixtures cover a no-history manual/default path and a rich edited-place path; live Calendar and linked-channel acceptance remain independent gates.

### Reusing extracted chat answers

The shared guide offers an `answers_review` step for supported assistant-provenance mode/location/transport/buffer values already in the current draft. It shows those values for explicit selection rather than asking the host to re-enter them. No checkbox starts selected; physical choices cannot be accepted while their suggested mode remains unchosen. Hosts can edit any extraction, accept a subset, and leave missing answers or clarification questions pending. Dismissed modes, stale drafts and online-only physical fields are excluded.

The existing protected draft action records only selected exact values at the displayed revision, with host provenance while preserving their assistant origin. This selection changes neither saved policy nor booking state. Reload resets unsubmitted checkboxes; a new revision remounts the review so an older selection cannot implicitly accept changed values. Final current-review confirmation remains separate. Natural-language extraction is not treated as proof of human authority, even when it appears to restate a host message. Model output and retained Calendar observations cannot bypass these controls. The actual linked iMessage equivalent and live model acceptance remain independent verification work.
