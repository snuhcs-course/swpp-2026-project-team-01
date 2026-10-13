# Tasks

Planning only. **0 tasks implemented.** Start only after a new explicit implementation request. Existing main contracts remain unchanged; specs are intentionally skipped, not missing.

## 1. Pin the isolated runtime foundation

- [ ] 1.1 Inspect current supported Next.js/eve integration and model metadata, pin npm/runtime/dependency/template revisions, and record the compatibility decision in frontend/provider docs; verify the selected metadata and lockfile without inheriting old version claims.
- [ ] 1.2 Scaffold only root agent, web and shared safe/server boundaries with independent production builds; verify fresh installation and both builds, and document exact commands in root/app READMEs.
- [ ] 1.3 Establish an isolated disposable synthetic persistence baseline with no live effects, preserving any existing applied history; verify target separation and reviewed pg-delta/local fixture setup, and document what may be reset in the provider setup guide.
- [ ] 1.4 Wire preferred managed execution persistence and the minimum durable dispatcher/wake-up boundary; verify an accepted synthetic input survives restart, and record process/worker ownership in backend architecture.

## 2. Protect application and runtime boundaries

- [ ] 2.1 Implement verified actor/resource/audience-to-logical-conversation resolution and default runtime endpoint denial; verify anonymous, foreign, expired and revoked access across create/read/list/stream/input/control, and document the route inventory.
- [ ] 2.2 Implement scoped thin tool commands with transactional current authority, revision and retry checks; verify exact retry returns one saved synthetic effect, changed retry conflicts and expiry during a lock wait denies mutation; document the command contract mapping.
- [ ] 2.3 Separate setup/private/shared runtime history, memory, tools and output projection; verify two-host/two-requester and audience-switch denial without cross-scope content, and document UI/session ownership.
- [ ] 2.4 Protect recognizable credential text while preserving original-input retry distinction; verify encoded/query/fragment secrets never reach persistence/model output and changed original secrets still conflict; document safe input handling.
- [ ] 2.5 Add browser/shared import and secret-boundary checks for both builds; verify direct, re-export and dynamic paths cannot import privileged modules, and document the check's limitations.

## 3. Make execution and recovery durable

- [ ] 3.1 Persist accepted input, exact retry identity, dispatch receipt and synthetic tool outcome before acknowledgment; verify missing wake-up and termination after commit/before tool acknowledgment retain one effect and original identity; document dispatcher recovery.
- [ ] 3.2 Implement authorized projected streaming and cursor reconnect with current grant checks; verify replay ordering, revoked/idle stream termination and no duplicate committed output, and document browser continuation behavior.
- [ ] 3.3 Implement explicit trusted terminal inspection and one durable generation transition; verify active/missing/uncertain/stale evidence creates no successor and concurrent/exact recovery retries create at most one; document the difference from reconnect.
- [ ] 3.4 Fence retired model/tool/delivery/settlement execution and preserve pending identities/history/cursors across recovery; verify old execution denial, authority loss during I/O/locks, original pending continuation and saved tool-result reuse; document recovery invariants.
- [ ] 3.5 Add reachable structured reconnect/recovery controls and retained local unsent draft handling; verify reload/lost response, current-scope history, authority loss, mobile/keyboard/zoom/reduced-motion behavior and no silent terminal replacement; update frontend recovery guidance.

## 4. Enforce existing model and message limits

- [ ] 4.1 Implement the exact admission and model-attempt/input/output/deadline/durable-allowance contracts; verify concurrent budgets, stalled streams, compaction/retries, charged failures and no quota reset on successor/channel/credential changes; document the retained numerical limits.
- [ ] 4.2 Implement sanitized configuration/auth/credit/rate/refusal/invalid-output failure handling and durable cumulative usage; verify committed state/controls remain usable and configuration correction alone does not authorize another call; document failure and retry semantics.
- [ ] 4.3 Verify the selected model's synthetic text/tool behavior and provider entitlement only when external use is authorized; record real-versus-fixture evidence, model/context metadata and any unverified prerequisite without exposing keys or private context.

## 5. Investigate compatibility and integrate checks

- [ ] 5.1 Run bounded resource/PKCE/exact-callback/refresh/revocation OAuth fixtures against the selected authorization direction; verify wrong resource/token/actor denial and no credential-to-approval shortcut, and record precise S9 prerequisites.
- [ ] 5.2 Compare Photon native versus application-owned ingress on durable receipt, acknowledgment, replay and exact sender/chat identity using synthetic fixtures; record the chosen integration boundary, limitations and S8 live-device prerequisites without claiming channel completion.
- [ ] 5.3 Introduce foundation-only type/build/test/CI entry points with previews defaulting to no live effects; verify them from a fresh checkout and keep docs/app setup synchronized.
- [ ] 5.4 Run the integrated protected-runtime, failure/recovery and separate-build gates, validate the change, and record fresh source/date/commands/environment evidence; keep all broader PRD acceptance rows pending and leave S2–S10 implementation outside this change.
