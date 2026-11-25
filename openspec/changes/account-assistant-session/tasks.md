# Tasks

## 1. Agreement and persistence gate

- [x] 1.1 Obtain agreement on the proposal and D1–D4 before implementation; verify the review is recorded on #491 or in the follow-up instruction.
- [x] 1.2 Reverify eve 0.80.1 provider recall/capture, stable-id replacement and compaction behavior against installed docs/types; read the relevant reference repository implementations and record their names/revisions and any justified divergence in the design/PR before writing modules.
- [x] 1.3 Stop and report the required ledger/memory persistence and legacy-routing migration scope before schema work. After agreement, follow the Supabase skills and declarative workflow; verify reviewed schema/migration SQL, namespaces, grants and RLS. Ask before starting Docker/local Supabase; only then verify the full migration chain and database tests. Stop/report again if the diff exceeds this bounded plan.

## 2. One account conversation and owned projections

- [x] 2.1 Route all linked host messengers to the canonical account discussion; retire per-request host-review execution, selected-request routing and switch_conversation while preserving receipt identities, generation fences and reply destinations. Add unit coverage for channel changes, retired/revoked inputs and unchanged anonymous requester routing (A5/A7).
- [x] 2.2 Resolve received refs as owner and sent refs through verified account association/requester projection, without role selection or settings-routing heuristics. Add projection tests denying foreign refs, email-only ownership, receiving-host private fields and requester histories (A3–A5).
- [x] 2.3 Update the routing/audience sections of 04_agent_configuration.md and affected UX/testing-baseline rows; regenerate their Korean mirrors from the English sources and verify local links and descriptions match the new routing.

## 3. One tool set and independent decisions

- [x] 3.1 Replace setup/review tool-set splitting with one account resolver: list/read requests by ref, schedule/image, settings, setup while unfinished, proposals/share/dismiss, guest questions and supported exceptions. Reuse the existing MCP-shared domain operations; unit-test availability throughout setup, received and sent discussions and unchanged server guards (A2/A3).
- [x] 3.2 Add batch approve/decline/cancel dispatch over existing commands with item-level refs, versions/revisions, retry identities and results. Unit-test clear siblings beside ambiguous, inaccessible, stale and failed items, repeated calls, sample boundaries and approval-versus-booking wording (A1).
- [x] 3.3 Expose existing sent-request requester actions in the account session with explicit direction/ref and account-owned schedule access. Unit-test cross-direction refusals, per-request host-calendar choices and separation from general settings (A4/A5).
- [x] 3.4 Update instructions/tool descriptions and the owning tool matrix in 04_agent_configuration.md; add focused story/eval cases for the brief's schedule questions and multi-request decision, and update corresponding testing-baseline rows. Verify the instruction contracts with unit tests; record paid-model evals as not run unless separately executed. Regenerate changed English documents' Korean mirrors.

## 4. Context provider and private memory lifecycle

- [x] 4.1 Implement the single account-authorized Postgres custom provider and fresh snapshot recall with stable ids and empty replacements; test DB changes between turns, repeated recall, snapshot exclusion from captures/summaries and compaction re-recall (D4/A2).
- [x] 4.2 Persist the latest question's target/direction/version and deferred items with revision/idempotency guards. Remove notice-driven focus changes and test unqualified yes, stale questions, conditional replies, cross-channel ordering and a notice arriving between question and answer (A7).
- [x] 4.3 Add eligible host-only memory save/list/forget with one-line acknowledgement, rule-like preference redirection to change_settings and no scheduling authority. Test provenance exclusions, automatic acknowledgement, retries, forgotten-memory recall after compaction and requester projection isolation including host.notes (A5/A6).
- [x] 4.4 Integrate dated expiry, resolved-ledger cleanup, retention and both operator/scheduled account deletion paths. Add lifecycle tests proving forgotten/expired/deleted records cannot return through capture/replay; run DB-dependent coverage only with local-stack permission (A6).
- [x] 4.5 Update agent configuration, applicable privacy/data lifecycle documentation and testing-baseline rows for recall, ledger, memory and ordinary history; regenerate changed English documents' Korean mirrors. Verify docs describe the actual retention and never claim memory forgetting erases transcripts.

## 5. Integration validation and review

- [x] 5.1 Run npm run lint, npm run typecheck, npm test, npm run build and the repository documentation check; record each result. Run focused integration/e2e coverage only after permission to start the local stack. Report A1–A7 individually as met/not met with evidence and every check not run.
- [ ] 5.2 Reconcile the proposed deltas with final behavior and any intervening archives of related changes; run strict OpenSpec validation, archive only after completed verified implementation, and open the one planned PR with the repository template and Part of #491 or Closes #491 as appropriate. Verify references and AI usage recording; never merge or deploy from this task.

## Execution constraints and evidence

The owner approved offline schema/migration authoring and clarified that D1 keeps one active binding per host (the currently linked channel). The earlier migration/scope pause has been cleared. No Docker, local Supabase, migration application, shared-project access or deployment is permitted in this run.

The implementation, unit regressions, database/integration tests and live-model cases are written. Database-dependent tests and paid-model evals are NOT RUN. Conditional stack/application checks in tasks 1.3, 4.4 and 5.1 therefore remain deliberately unexecuted, not passing checks. Archive is deferred until database/integration acceptance and teammate review; the implementing PR references Part of #491.

Final local validation used Node.js 24.22.3: `npm ci`, lint (six existing warnings), typecheck, unit tests (157 files / 1,413 tests), Eve + Next.js build, documentation link check and strict OpenSpec validation passed. No database was contacted. A1–A7 have implementation/unit evidence; database lifecycle and end-to-end model acceptance remain unverified, as reported in the PR.
