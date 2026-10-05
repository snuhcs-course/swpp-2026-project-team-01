# Tasks

## 1. Persistent setup conversations

- [x] 1.1 Add host-owned conversation/turn/draft/review contracts and private declarative tables with revision and deduplication constraints; generate a migration and verify a complete local reset plus cross-host and public-role denial tests.
- [x] 1.2 Add authorized read/append/review-confirm commands using existing admission and setup guards; verify identical retries, conflicting keys, stale revisions, current rules preservation, and server-only sensitive fields with database/API tests.
- [x] 1.3 Document setup conversation endpoints and state ownership in the backend contract and host setup guide; verify documented DTOs match contracts and tokens never appear in examples.

## 2. Shared conversational orchestration

- [x] 2.1 Add bounded host preference extraction and deterministic orchestration of nextAction; verify explicit values, ambiguous windows/timezones, unsupported rules, invalid model output, prompt injection, and model failure without changing saved settings.
- [x] 2.2 Implement current-review confirmation and calendar selection mapping through existing setup/calendar commands; verify stale cross-channel confirmations, duplicate calendar names, read-only destinations, and no meeting/event operations.
- [x] 2.3 Add sign-in, invitation, and Google consent continuation actions with resume from server state; verify interrupted/denied/swapped callbacks, no false readiness, and no invitation/provider tokens in model context or transcripts.
- [x] 2.4 Update product onboarding intent and interfaces to make website/iMessage chat primary setup surfaces while preserving invitation and browser consent requirements; review links against the new capability and existing admission/calendar specs.

## 3. Website AI Elements experience

- [x] 3.1 Inspect and install the official Conversation, Message, PromptInput, and Suggestion registry components with pinned necessary dependencies; verify Base UI composition, existing preset b6rtA2Hmi, correct aliases/CSS source scanning, and production build.
- [x] 3.2 Replace the primary setup form layout with real persistent chat, progress, inline review/calendar actions, and structured recovery; verify keyboard submission, pending/error/retry behavior, reload/resume, and preserved input on failure with browser tests.
- [x] 3.3 Verify desktop/mobile layout, transcript scrolling, focus, accessible labels, and all setup states; run the required visual-verdict loop and store evidence under .omx/state/conversational-host-setup/ralph-progress.json before further visual edits.
- [x] 3.4 Update the host setup guide with the actual conversational journey; run web lint/typecheck/build and existing workspace smoke tests, recording regressions and bundle impact.

## 4. Verified private iMessage linking

- [x] 4.1 Add expiring single-use challenges and active channel bindings with explicit browser opt-in/unlink; verify proof of both sides, wrong sender, wrong browser, conflict, expiry, replay, rate limiting, and revocation with database/API tests.
- [x] 4.2 Implement web-initiated and iMessage-initiated linking handoffs without long-lived credentials in URLs; verify an unlinked sender sees no private host data and Google consent starts in the authenticated browser.
- [x] 4.3 Document linking, revocation, recovery, and consent continuation; verify the documented flow works locally with provider fixtures and no real messages are sent by unit tests.

## 5. Photon bridge and durable delivery

- [x] 5.1 Add the narrow Node 24 bridge with pinned Spectrum 12.10.1 dependencies, scoped backend authentication, bounded operations, and clean shutdown; verify startup/reconnect/health and reject forged events, groups, and unlinked identities using fixtures.
- [x] 5.2 Add durable provider-ID deduplication, per-conversation turn ordering, outbound intent/clientMessageId and outcome reconciliation; verify restart, duplicate/out-of-order messages, lost acknowledgements, and no blind resend.
- [x] 5.3 Recheck admission/link authority before processing and dispatch; verify unlink races and cross-host attempts cannot read or modify setup or send private replies.
- [ ] 5.4 Add container/runtime setup documentation and identify and provision a persistent production hosting target before deployment; verify secret injection, restart recovery, health checks, and an honest website fallback when the bridge is unavailable.

## 6. Cross-channel acceptance

- [x] 6.1 Run end-to-end fixture onboarding from invitation through confirmed rules, calendar selection, and ready link across website and iMessage; verify cross-channel resumption and stale-confirmation conflicts against the same persisted state.
- [ ] 6.2 With controlled-user message authorization and actual Google consent, verify one real linked-host onboarding journey and browser return; record transport, routing, consent, and readiness evidence separately without claiming booking completion.
- [ ] 6.3 Run relevant database, API, frontend and bridge checks plus strict OpenSpec validation; review the diff for unrelated email changes and secrets, update phase evidence, and archive only when implementation and required verification are complete.

## Verification record (2026-10-05)

- Complete local migration reset and 394 SQL assertions pass. Separate two-session turn/unlink locking checks pass.
- Cross-channel fixture runner proves actual local verified Auth, invitation admission, HTTP/RPC persistence, private linking/browser opt-in, iMessage draft/confirmation, website resume, bound fixture Google callback/calendar selection, readiness and stale review rejection. No external messages or live Google consent in this runner.
- Website fixtures cover host setup 14 areas/9mutations and requester 10 areas/24mutations; existing browser 25 areas/17mutations andworkspace 9 areas pass. Desktop,390px and320px layout checks pass.
- Manual visual verdict iteration6 scored 93/pass in `.omx/state/conversational-host-setup/ralph-progress.json`. The installed visual-verdict skill is a shim without its referenced full body; the accessible screenshot/review fallback and this limitation are recorded.
- Landing/public intake eager JavaScript is approximately 324 kB (entry225.11kB);654.05kB chat runtime is deferred. The remaining lazy chunk size warning is visible.
- New server requested; Fly configuration is proposed. Hosting account/billing choice and a real linked-host iMessage journey remain pending, so this change is not archived.

- Production website/API/database rollout succeeded for release `d6d1a62`; the authenticated host chat and preserved 5/5 readiness were checked in the actual browser. Disabled bridge middleware returns 503 and the website fallback is visible. This deployment does not complete tasks 5.4 or 6.2.
