# Tasks

Tasks describe replacement implementation and verification. Private drafts, guided browser setup, focus recovery and protected admission/Calendar continuation are verified locally; deterministic cross-channel setup is verified; controlled live acceptance remains open. Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md).

## 1. Authorized state and shared operations

- [x] 1.1 Define host-owned conversation, turn, draft/review contracts and private persistence in root `lib/` and Supabase; verify migrations, cross-host/public denial, deduplication and revision constraints.
- [x] 1.2 Implement shared authorized read/turn/review-confirm operations called by eve tools and web actions; test idempotency conflicts, ambiguous/invalid model output, stale cross-channel review and no booking authority.
- [x] 1.3 Implement protected admission and Google continuation; test interrupted/denied/swapped callbacks, authoritative resume, no false readiness and no secrets in context/transcripts.
- [x] 1.4 Update backend/frontend documentation with the implemented contracts and recovery behavior; verify descriptions match executable operations.

- [x] 1.5 Implement application-authored English/Korean setup clarifications across eve, external-agent and database boundaries; verify malicious text, legacy projection, exact/changed retries, rebase and ordered browser resolution without confirming settings.
- [x] 1.6 Deploy the clarification boundary and verify production function/contract behavior; retain separate live onboarding and free-form narration acceptance gates.

## 2. Guided preferences and Calendar analysis

- [x] 2.1 Define selected-calendar scan inputs, bounded range, normalization, freshness and minimized summaries; verify selected scopes and revisions invalidate stale scans/reviews.
- [x] 2.2 Implement deterministic read-only analysis; test recurrence, DST/all-day/free/cancelled events, sparse/partial/revoked reads, duplicate names, read-only destinations, malicious source text and cross-host isolation.
- [x] 2.3 Implement explicit-choice/evidence/default precedence, provenance, edits/dismissals and focused clarification; test rich/no-history paths and no settings mutation before current confirmation.
- [x] 2.4 Ask explicit mode/location, transportation and extra buffer with applicable skips and per-meeting/per-trip choices; test prior-answer reuse, inference cannot answer, unsupported routing and separate route/buffer values.
- [ ] 2.5 Document scan limits, suggestions and manual recovery; verify PRD AC-28 fixtures and an authorized controlled Calendar scan.

## 3. Next.js chat and action cards

- [x] 3.1 Integrate verified AI Elements primitives with the selected shadcn preset and eve transport in `apps/web/`; verify production build, authorization and persisted reload/resume.
- [x] 3.2 Render connection/calendar cards, true scan states, editable weekly preview, location/travel actions and final review inside `/app`; test keyboard/mobile/zoom/reduced-motion behavior and structured recovery during model failure.
- [x] 3.3 Implement inline phone/code/connected states with skip, retry, expiry and change-number; verify protected fields never enter model, transcript, analytics or persisted card state.
- [x] 3.4 Run the required visual review loop and update interface documentation; verify completed steps remain editable and consent return retains focus/current progress.

## 4. Private iMessage proof and transport

- [x] 4.1 Implement browser-bound expiring hashed OTP challenges and durable code intents; test wrong browser/sender, guesses, expiry, replay, delivery failure, number change and single-use consumption.
- [x] 4.2 Implement inbound-first continuation, one-to-one identity linking and unlink; verify login/admission plus fresh private proof, conflict handling, groups rejected and queued/outbound revocation.
- [x] 4.3 Complete native eve Photon compatibility testing and implement the selected adapter boundary; verify signed/verified ingress, sender-to-host/session mapping, ordering and durable deduplication. Create a separate bridge only if the spike demonstrates necessity.
- [x] 4.4 Implement scoped outbound delivery/reconciliation; test restarts, lost acknowledgement, stale authority and no blind resend, and document actual runtime/secrets/recovery without exposing values.

- [x] 4.5 Implement deterministic `review setup` / `confirm setup <reference>` parsing and a complete bounded application-authored review formatter; verify malformed input, literal quoted preferences, overnight hours, all setting fields and oversized-summary fallback without confirmation authority.
- [x] 4.6 Persist immutable private setup reviews and attributable confirmation receipts bound to current host/link/receiver/conversation/revisions/grant; verify delivery evidence, expiry, races, replay, unlink, changed grants and no model/booking authority through SQL and service integrations.
- [x] 4.7 Connect deterministic signed-input review/confirmation dispatch, fresh Calendar permission validation and durable replies; verify web/iMessage cross-channel edits, lost acknowledgments, browser continuation and ordinary-chat denial through actual eve/provider fixtures.
- [ ] 4.8 Deploy and verify the private setup-confirmation boundary, update owning documentation and preserve the separate authorized live Google/iPhone acceptance gate.

## 5. Cross-channel acceptance

- [x] 5.1 Exercise admission through confirmed rules, calendar readiness and linked web/iMessage continuation using deterministic integration fixtures; verify stale reviews and two-host isolation.
- [ ] 5.2 With controlled message authorization and actual Google consent, verify one complete onboarding and browser-return journey at the reconstruction origin; distinguish transport, consent, linking and readiness evidence from booking verification.
- [ ] 5.3 Run relevant database/runtime/web checks and strict OpenSpec validation; verify AC-28 and update current status only from fresh replacement evidence.

Task 2.4 acceptance: [requirement-by-requirement executable evidence](../../../documentations/technical_specification/05_rebuild_evidence.md#explicit-onboarding-preference-acceptance--2026-10-09), including the online-only, per-meeting/per-trip and reviewed chat-answer browser journeys. Live scan/channel gates remain in tasks 2.5 and 5.2.

Task 3.2 acceptance: [in-chat cards and editable weekly preview](../../../documentations/technical_specification/05_rebuild_evidence.md#editable-weekly-preference-preview--2026-10-09). Local focus/consent-return and compact-interface acceptance is verified in task 3.4; live Google/iPhone acceptance remains in task 5.2.

Task 3.4 acceptance: [compact interface and requirement-by-requirement evidence](../../../documentations/technical_specification/05_rebuild_evidence.md#compact-completed-setup-and-visual-acceptance--2026-10-09), together with the retained editor and consent-return tests. Actual Google/iPhone acceptance remains separate in task 5.2.

Task 5.1 acceptance: [admission and two-host journey](../../../documentations/technical_specification/05_rebuild_evidence.md#admission-and-two-host-setup-journey--2026-10-09) and [current private-channel readiness](../../../documentations/technical_specification/05_rebuild_evidence.md#private-channel-readiness-and-cross-channel-acceptance--2026-10-09). Providers are controlled fixtures; actual Google/iPhone acceptance remains task 5.2.

Task 4.3 acceptance: [installed native adapter and selected transport evidence](../../../documentations/technical_specification/05_rebuild_evidence.md#photon-adapter-boundary-acceptance--2026-10-09). No additional process is required. Live routing/device and controlled Google journeys remain task 5.2.

Tasks 1.5–1.6 acceptance: [authored questions and production rollout](../../../documentations/technical_specification/05_rebuild_evidence.md#deployed-setup-clarification-boundary--2026-10-10). Structured guidance is verified; historical free-form narration and controlled live onboarding remain separate acceptance work.

Task 5.3 incremental evidence: [six reviewed live-model initial-setup narration cases](../../../documentations/technical_specification/05_rebuild_evidence.md#live-initial-setup-narration-acceptance--2026-10-10) verify draft versus confirmation, false completion, unconsented analysis and withheld unverified links in English/Korean. The production agent runs against isolated local state. Full AC-28, later-stage narration and actual Google/iPhone acceptance remain open.

Task 4.6 incremental evidence: [private review persistence foundation](../../../documentations/technical_specification/05_rebuild_evidence.md#private-setup-review-persistence-foundation--2026-10-10) verifies immutable snapshots/publications, one exact outgoing reply, accepted-delivery evidence, stale/foreign/expired denial and concurrent lock-wait checks. The private SQL helpers cannot save settings and are not exposed to the service role; atomic decision receipts and service integration remain unfinished. Task 4.6 stays unchecked.

Task 4.6 completion: [atomic private setup confirmation](../../../documentations/technical_specification/05_rebuild_evidence.md#atomic-private-setup-confirmation--2026-10-10) verifies the service-only permission-check protocol, immutable attributed receipts, atomic rollback, eight competing commits, changed authority and lost-response replay without another provider read. Dispatcher integration and production rollout remain tasks 4.7–4.8.

Task 4.7 completion: [leased private setup dispatch](../../../documentations/technical_specification/05_rebuild_evidence.md#leased-private-setup-dispatch--2026-10-10) verifies signed ingress through deterministic dispatch, current Calendar metadata, durable replies, cross-channel edits, exact lost-save recovery and actual-eve bare-assent denial. Production rollout remains task 4.8.
