# Design

## Context

See [proposal.md](proposal.md). Findings supplied in the brief were verified on `origin/main` at `b2faf8fc`; the user reconfirmed that baseline for this planning run.

- `lib/server/imessage-receipts.ts:170` routes through a binding's selected request. `imessage-notice-job.ts:311–325` selects an awaiting-approval or weekly-limit-held request; `channel-selection.ts` changes that selection in words.
- `agent/tools/setup.ts` has request listing, schedule/image and setup tools without decisions. `agent/tools/request.ts` has bound-request host-review decisions (including #439's cross-request approval/decline) without schedule reading; `read_request` takes no argument. Requester instructions forbid access beyond their request or to their own calendar.
- `lib/server/agent-host-tools.ts` and `agent-account-requester-tools.ts` already implement account-scoped reads/actions. Reuse their underlying authorized domain operations, not MCP transport credentials or duplicated business rules.
- Production `app.conversation_inputs`, 2026-11-25 KST: 18:59, the host-as-guest asked “나 11월 27일에 약속 없는지 확인한번 해줄래?” in a requester session; 19:10/19:12, host review received “Show me my schedule that day” and “What does my next week look like?”. Neither audience had the required schedule tool. The multi-request gap is from code inspection, not a reproduced production event: there were never two awaiting requests together in that data.
- The per-request review originated in the host web chat (host-review-and-booking design 2/12). The 2026-11-19 product decision removed host web chat: web supports approve/decline/details, adjustments belong in messenger. Guest web chat remains.
- The brief verified eve 0.80.1's custom-provider docs, default harness and definition types: recall on `turn.started`/`compaction.completed`; capture on `turn.completed`/`compaction.requested`; the same recall id supersedes its earlier record, but recall cannot retract a record. Recalled records are excluded from the compaction summary and recalled again. Compaction options are `thresholdPercent`, `model`, `modelContextWindowTokens`, with no keep-last-N option. `agent/agent.ts` currently sets 0.6. These API details were supplied evidence at proposal time; dependency installation and the implementation clarification below record their fresh verification.
- `lib/server/request-tools.ts:360` exposes `assistant_notes` as requester-model `host.notes`; those notes cannot store private host memory.

### Owner-approved implementation clarification (2026-11-26)

D1 means the currently linked channel; retain the one-active-binding-per-host constraint. The owner explicitly authorized hand-authoring the offline migration and matching declarations without generating/applying them against any database. Docker, local Supabase, shared-project writes and deployment remain prohibited. The migration adds `host_assistant_context`, removes selection storage, retires host-review runtimes and suppresses their queued replies; the existing catalog-driven account deletion discovers the new FK. Expired or unacknowledged content is cleared in bounded retention passes, capture dedupe rows expire after 30 days, and content-free forgotten-memory keys remain until account deletion.

References inspected: `vercel/eve` chat template `8c55ea7c132f`, `agent/memory/profile.ts`; `vercel-labs/eve-memory-agent-template` `88cb375da5a83bf93bbfbccace4f9dea0bda5ddd`, `agent/memory/user-preferences.ts`; `Merit-Systems/OpenInstinct` `d78cb0acf9724f5fa755e38e379c66138bdb8047`, `agent/lib/profile-memory.ts`. The scope-bound provider shape follows these references; Postgres replaces Blob/fileMemory to meet deletion/privacy requirements. Installed eve 0.80.1 custom-provider docs, memory types and default-harness docs were reverified in this run.

The local macOS default sandbox prewarm required an uninstalled VM package. Because all authored tools and memory run on the server and no sandbox capabilities are exposed, the root now explicitly uses eve's pure-JavaScript `JustBashSandbox` with `just-bash` 3.6.1 pinned. No container, VM or database was started. `defaultTools: false` and all model limits remain enforced.

### Live-eval repair (2026-11-26)

The owner reported two isolated-stack account eval failures: Eve rejected the `read_request` executor's captured function/schema before any tools could run, and integration `agreedRequest` fixtures sealed Calendar grants with a different key from the eval runtime. Account tools now place each `defineTool` schema and executor inline, with shared behavior called through module-level imports. The memory provider captures only scope and turn-id strings rather than its runtime context. Setup and requester tool callbacks were also checked for the same pattern.

The account eval set reuses story state builders and the runtime key, runs the canonical `host_setup` Telegram path with real tools, and adds the requested onboarding, tutorial, request-explanation, weekly-booking and ledger-target UAT cases. Each of nine cases runs three times. Its recording loopback messaging transport receives real outbox payloads and records delivery acceptance; it does not contact a real messenger. Eve 0.80.1 has no public dynamic callback transform/resolution checker; build and untransformed unit registry tests cannot establish serializability. The live account evals are the regression guard. They were NOT RUN during this repair, per the owner's instruction; see [eval instructions](../../../evals/account-assistant/README.md).

## Goals / Non-Goals

**Goals:** keep one authority-bound account session and one tool set; use explicit refs and current versions instead of routing state; preserve isolation between owned host data and another host's requester projection. Keep persisted memory under application deletion and retention.

**Non-Goals:** see the proposal. No host web chat restoration, direct MCP credential reuse, scheduling decisions based on memory, guest conversation history imports, or session rotation to force an exact context length.

## Decisions

The following D1–D4 are copied verbatim from the agreed brief. D4 describes three recalled layers followed by recent runtime history; its fourth numbered item is history, not a fourth durable memory store.

- D1. **One assistant session per host account**, shared by all linked messenger channels,
  like the current setup discussion. Requests are data addressed by `ref`, not sessions.
  Remove per-request host-review sessions, `selected_request_id` routing and
  `switch_conversation`; a notice no longer moves the conversation.
- D2. **One host tool set**, regardless of setup state, reusing the same domain operations
  as the MCP host tools (one owner per rule; no second copy): list requests, read a request
  by ref, read schedule (and image), read/change settings, decide (approve / decline /
  cancel; several in one call with a per-item result and per-item version check),
  propose / share / dismiss changes by ref, ask the guest by ref, exceptions by ref,
  setup tools while setup is unfinished.
- D3. **Host-as-guest** (an account holder's sent requests) is handled in the same account
  session through the requester projection, so they can see their own requests and
  schedule. The other host's private data stays hidden by projection.
  **Guests without an account keep the per-request requester session** (web, email,
  messenger) unchanged.
- D4. **Context layout**, three layers:
  1. State snapshot recalled every turn from the DB with one stable id (pending decisions
     with ref/version/times, bookings in the next 7 days, sent requests, setup step, now and
     timezone). Never summarized; never duplicated into memory.
  2. Ledger of open items not in the DB: the assistant's latest pending question with its
     target ref (replaces `selected_request_id` as the focus for an unqualified "yes"),
     things the host deferred.
  3. **Private host memory**: preferences and persona that are not rules and not
     guest-facing notes (tone, relationships and priorities, soft tendencies such as
     "avoid Friday afternoons", dated life context such as "exams until mid-December",
     recurring patterns). Rules:
     - only the host's own words are remembered, never requester names/purposes or calendar
       titles;
     - memory never decides feasibility; a rule-like preference is offered as
       `change_settings` instead of stored;
     - the assistant may remember without being asked, but says so in one line each time
       ("금요일 오후는 피하시는 걸로 기억해 둘게요");
     - the host can list and forget memories in words; memories are deleted with the
       account and follow the retention policy;
     - dated items expire;
     - never exposed to any requester session.
  4. Recent turns stay verbatim in eve history; rely on eve compaction first. Exact
     "last N turns" via session rotation is out of scope unless evals show the need.
  Store layers 2 and 3 in Postgres through one eve custom memory provider, not
  `fileMemory` (Vercel Blob, outside our deletion and retention).


### Applying D1–D3: session, references and domain ownership

Reuse the logical setup discussion as the canonical account conversation, retaining its identity across linked channels. Retire per-request host review runtimes from new input, tools and outbound execution with the existing generation/authority fences. Requests remain domain records. Do not concatenate old review transcripts or requester histories into the account history. Deliver each reply to the channel of its accepted input; serialize account turns across channels so one pending question has one meaning. A revoked binding never acquires authority from another linked channel.

Resolve received refs within the verified account's owned requests. Sent refs resolve only through the existing verified account-request association, never contact-email equality. Use separate host/requester result projections and action direction; a sent ref cannot authorize approval for its receiving host. Read/modify all supported received actions by ref, including proposal/share/dismiss, questions and exceptions; expose sent-request operations through the same requester domain commands already used by account MCP. Keep setup capabilities in this single set while unfinished; readiness gates operations rather than selecting a different host audience.

A batch decision is a thin dispatcher over the existing approve/decline/cancel commands. Each item carries its target ref, operation and operation-appropriate current version/revision and retry identity. Validate and execute independently; do not make the batch one all-or-nothing transaction. Return one result for every item, including ambiguous, inaccessible, stale, already-applied or failed entries, and keep processing clear siblings. Authorization, current-generation checks, explicit intent, current proposal versions, expected revisions, idempotency, booking checks and sample-request boundaries remain in their existing command owners. Exact names can resolve refs; partial or multiple matches cannot decide. Cancellation uses existing cancellation semantics, not a newly invented booking path.

Keep existing action commands/buttons functioning without advertising command syntax. `setup` and `request <ref>` may read the requested state or establish an explicit ledger question, but cannot select a runtime; remove `switch_conversation` and every selection write. Notices append/freeze their existing event content, never retarget the session or overwrite the pending question. An unsolicited proposal notice alone must not authorize an ambiguous “yes”.

### Applying D4: one custom provider

Use one account-authorized eve custom memory provider for the ledger and private memory, with the DB snapshot composed at recall. Keep each recalled layer under its own stable id and return a full replacement, including an explicit empty value after clearing; the provider must not depend on recall retraction. Recall queries fresh state every turn and again after compaction. Do not copy snapshots into captures or summaries. Retain eve's current compaction threshold initially and the usual provider/model budgets.

The snapshot includes current ref/version/times for pending decisions, the next seven days of bookings, sent requests through requester projection, setup step, now and timezone. It is a navigation aid, never command authority; commands reread current state. Capture only the latest unanswered assistant question with target ref/direction and the version it answered, plus deferred items and eligible host-authored memories. A resolved or superseded question is cleared/replaced. Deferment is not approval. A version change requires fresh clarification rather than reinterpreting an old yes. Conditional replies remain discussion.

Store ledger and memory as bounded, account-owned Postgres data (32 active memory/deferred entries plus the single latest question) with revision checks and idempotent capture so retries, compaction and concurrent channels cannot duplicate or overwrite newer updates. Retain source input identity for provenance, without copying requester or calendar text. Filter before writing and before recall: only the account holder's own eligible statements enter private memory, never tool results, guest quotations, requester names/purposes or calendar titles. Memory tools support saving, listing and forgetting within the account audience; every save, including automatic capture, gets a one-line acknowledgement in the response. Rule-like preferences use the canonical `draft_settings` writer (the `change_settings` wording in the verbatim decision denotes the same settings operation, not a second registered tool); soft preferences never become feasibility constraints. Runtime hooks must not create a silent second write after an acknowledgement was missed.

Memory persists until the host forgets it, its dated context expires, or account deletion removes it. The bounded retention worker removes expired dated entries and resolved ledger entries; all account data follows the existing deletion lifecycle, without importing per-request 90-day retention as an arbitrary lifetime for live-account preferences. Forgotten/expired entries are excluded from the next full replacement recall and cannot be regenerated from compaction capture. History retains its ordinary retention; forgetting stored memory does not promise transcript erasure. No provider records, ledger or private preferences reach requester sessions, public/MCP request projections or `assistant_notes`.

Rejected: patching schedule/settings tools into each review session (leaves routing/focus fragmentation); using guest tools with host permissions (breaks projections); storing private memory in `assistant_notes` (leaks to the requester model); `fileMemory`/Blob (outside application retention/deletion); maintaining a second snapshot in summaries (stale state); session rotation before eval evidence (extra lifecycle complexity).

## Risks / Trade-offs

- Shared account context can confuse received and sent requests → explicit direction/ref, isolated projections, ownership tests for every action.
- A notice or racing channel reply can hijack “yes” → serialized account turns and a versioned pending-question ledger; notices never replace it.
- Recalled records cannot be retracted → stable ids with complete replacement, empty records after removal, and tests after compaction/forgetting.
- Memory can become an accidental policy or leak → host-input provenance, excluded guest/calendar fields, separate persistence, no feasibility dependency and projection tests.
- New persistence and removal of routing fields require migration → stop/report before schema implementation; use the repository's declarative migration process only after agreement. This planning change generates no migration.

## Migration Plan

1. Obtain proposal agreement, verify pinned eve APIs and read reference implementation revisions before module work. The existing reference catalogue is in frontend architecture; supplied eve API findings above guide the proposal, not a claim of a fresh reference review.
2. Stop and report the required Postgres schema/migration scope before writing SQL or migration code. Persist account context under existing namespaces/RLS and include retention/account deletion; review how retired review sessions and selection columns are removed safely.
3. After that gate, implement canonical routing and ref tools with tests, then provider capture/recall. Do not import private old discussions into requester projections; preserve authorized historical records under ordinary retention.
4. Validate migrations and integration/browser flows only after explicit permission to start Docker/local Supabase. Run permitted unit/static/build checks; report unavailable checks separately. No writes to shared Supabase and no deployment by this session; CI deploys only after a separately reviewed merge.
5. Preserve existing domain rows, receipt identities and command outcomes across the transition. Before removing legacy routing storage, stop/drain legacy workers: the normal CI migration-before-deployment order otherwise leaves the old application briefly querying a removed column. This cutover must be reviewed before merge. A code-only rollback cannot restore the removed column; restore a nullable compatibility column in a separately reviewed forward migration before running old code, and never replay completed inputs or discard memory/ledger rows. Never restore a deleted account or lost authority on rollback.

## Acceptance evidence to collect

A1: batch approve/decline with independent ambiguity and stale-item results. A2: schedule at any conversation point. A3: details by ref without switching. A4: own schedule/sent requests as host-as-guest. A5: anonymous requester privacy/projection tests. A6: acknowledged save/list/forget/expiry/account deletion and requester isolation. A7: notices cannot retarget; yes follows only the current ledger question. All A1–A7 remain unimplemented/unverified at proposal time.

## Implementation validation record

The owner approved offline schema files and prohibited all database application and Docker/local-stack execution. Tests for the table, expiry, deletion and real messenger path are authored but NOT RUN; no shared database or deployment was touched. Unit tests cover tool registration, ref/projection fences, independent batch outcomes and retry keys, pending-question matching, stable recall replacement and compaction hooks, acknowledged capture, CAS and forgotten-memory replay. Live account evals are in `evals/account-assistant/session.eval.ts` (run only with an allowed local stack, a model key and `FMAT_EVAL_AUDIENCE=host_setup`). Historical review evals remain a local-only legacy audience; their removed routing-storage queries were updated. The change remains open until database/integration acceptance and teammate review; the PR uses Part of #491 rather than closing the issue.

### Second live-eval repair (2026-11-26)

The supplied same-day branch/main artifacts confirm the HS-03 regression used `draft_settings`, not the duplicate alias: alias competition remains a hypothesis, so only one account settings writer is now exposed and incomplete preferences must be clarified before labeling exact bounds stated. The manifest verified that authored `tools/account.ts` shadowed Eve's derived memory resolver of the same name, omitting ledger tools. The helper moves to `agent/lib/account-tools.ts`; a filename collision regression and fresh build manifest check guard this boundary.

Linked tool projections now count stated mode/place/travel answers with the existing `withStatedAnswers` policy, while web acceptance remains unchanged. Write results return this current projection and preview delivery, including an explicit idempotent no-change outcome. This removes the observed repeated incomplete-field/write loop. Schedule reads include separately week-labeled confirmed bookings around this/next week using the existing list projection and week guidance. Request reads/evaluations expose the exact current proposal's feasibility basis and account tool guidance instead of obsolete review tool names; model call-count improvement remains unverified until the owner reruns live evals.

Corrected UAT fixtures/cases and reversed switching expectations are recorded under documentation 13's Appended cases, without removing historical cases or out-of-scope failures. No stack lifecycle commands, database application, live eval, shared project access or deployment was performed in this repair.

### Third live-eval repair (2026-11-26)

The supplied rerun confirms ledger tools are registered, but every pending-question write failed the JSONB object check: pre-stringified content was encoded again by postgres.js. Context staging and capture now use typed JSON object parameters with the driver's encoder, retaining the schema's object/size constraint. Offline unit regressions use the real driver serializer, not a mock of stringified content.

The account schedule adapter no longer returns two conflicting notes. A single schedule reply rule uses the shared booking-week guidance and separately labeled nearby bookings. Sample batch decisions return terminal tutorial completion text, and the account finish tool accepts only change/end, avoiding a second finish after approve/decline. No real event/notification is created by that path.

A service hours question exists in the production outbox, outside Eve history. The setup projection now joins its original analysis, reports delivery/currentness/answer state, and lets an eligible service question supply an onboarding yes only when no confirmed ledger question takes precedence. This is DB-backed service state, not private host memory or request-decision authority. Later analysis does not replace the sent suggestion.

The duplicate request reads in the supplied traces bracket compaction, while duplicate defers follow failed JSON writes. Account request details now keep alternative lists in candidate discovery rather than returning them for a simple current-proposal explanation. Same-turn staged context is recalled as inFlight across compaction, clearly unconfirmed and awaiting final acknowledgement; it cannot authorize a decision. No eval assertion/trial count was relaxed. Live call-count improvement and DB execution remain unverified because this repair does not run evals or a stack.

### Fourth targeted repair (2026-11-26)

The supplied targeted artifacts show the A7 repair holding, but a deferral acknowledgement field echoed the host's own first-person text. Deferral staging now stores a separate service acknowledgement; capture confirms that acknowledgement, never the host quote. The first BASIS answer may legitimately use list_host_requests or read_request, recorded as an explicit required-call correction in documentation 13 without relaxing duplicate bounds.

Reply completeness is represented as structured product data rather than more notes: schedule coverage combines the requested period with other-week confirmed bookings; setup confirmation groups status, booking link and tutorial offer; the next setup question contains all place/online/travel parts. Successful sample batches expose completion at the top level, and list/current-state reads reconstruct same-input finished-sample receipts from owned DB records. Targeted reads can still read a finished owned sample, so a later read cannot turn completed work into an unavailable-request error. No new migration is needed.

The remaining duplicate read occurs immediately after compaction even with compact tool output. Per-turn Eve navigation stores only authorized request IDs (maximum 20), cleared at the next turn. The existing provider re-authorizes and reads those IDs afresh after compaction; no domain snapshot, ledger or private memory is copied into this working-state slot. This follows Eve 0.80.1's defineState working-context contract and preserves D4's single Postgres private-context provider. Live behavior remains unverified here because evals and stack operations are prohibited.
