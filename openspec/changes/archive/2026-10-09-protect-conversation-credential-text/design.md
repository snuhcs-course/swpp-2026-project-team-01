# Design

## Context

See [proposal](proposal.md). `RuntimeMessages.accept` sends parsed text unchanged to `fmat_runtime_message`; both `fmat.photon_execute` and requester-email execution call that same SQL admission function directly. The durable ledger then supplies immediate delivery, sweep dispatch and inspection. Protecting only the web TypeScript adapter would leave both messaging channels unprotected.

A rollback-only real local database probe admitted the retired test's synthetic credential shapes under a valid host-setup grant. Admission retained a bearer value, delivery retained an OAuth code and the stored row retained the linking proof. Ordinary date/place text also survived. No external runtime/model or messaging provider was called; every fixture and budget mutation was rolled back.

## Goals / Non-Goals

**Goals:** enforce one deterministic protection rule before canonical runtime persistence; preserve exact retries, current authority, quota atomicity and ordinary scheduling context; protect old pending work before a future dispatch.

**Non-Goals:** a general secret detector, credential validation/revocation, rewriting external provider inboxes or already generated eve checkpoints/transcripts, and output narration guarantees. This increment must not claim historical erasure or alter the linking/recovery protocol handlers that deliberately consume proofs outside conversation text.

## Decisions

1. Put the canonical protection function in private SQL and call it at runtime admission. Retain a single shared behavior for browser, authenticated email and authenticated private iMessage execution. A browser-only regular expression or a model instruction cannot enforce this boundary.
2. Recognize bearer values, the retired UUID/proof `LINK` form, named credential assignments and credential-bearing HTTP(S) query/fragment material. Match names case-insensitively and handle percent-encoded ASCII names. Avoid network requests and URL redemption. Retain ordinary surrounding text and nonsecret URL context; replace sensitive material with a fixed visible marker. Keep normalization idempotent and bounded by the existing input limit. Explicit tests define the supported recognition grammar; do not claim arbitrary secrets are discoverable.
3. Persist a domain-separated digest of the original exact accepted input, bound to its conversation/grant/client identity, alongside protected text. Compare the digest for retries before quota charging. Never compare only the redacted text: two different credentials would otherwise become an accepted exact retry. The digest is private comparison metadata, never a DTO, credential or authorization mechanism. Do not log original input while diagnosing conflicts.
4. Add schema changes declaratively and use a separate versioned data migration for existing runtime rows: derive the comparison digest from the original text before replacing recognized credentials. This protects pending dispatch and application inbox reads while preserving message IDs, status, order and canonical-session bindings. Already copied provider/eve history remains outside this migration; document that limit explicitly. Redaction is one-way, so rollback must not attempt to reconstruct removed text.
5. Keep the current authorization and quota lock order. Protection must not create a message, grant or charge on rejected authority/size/changed-input cases. Dedicated channel proof processing remains upstream; the shared runtime receives only ordinary conversation inputs after those decisions.

## Risks / Trade-offs

- Recognized assignment syntax can appear in benign pasted documentation → retain surrounding prose and a visible replacement marker; test scheduling dates, timezones, ordinary links and multilingual text rather than deleting whole messages.
- Redaction-only equality would weaken exact retry semantics → retain private original-input digests and test changes limited to the removed value.
- Existing rows and already copied history have different owners → migrate the runtime ledger in place, test pre-migration pending/retry behavior and make no claim about rewriting external inboxes or eve history.
- SQL regex/URL edge cases can leak values or consume excess time → use bounded input, deterministic nonrecursive transformations and fixtures for repeated markers, encoded names, case changes, fragments and long inputs; verify no secret reaches model input in an actual runtime fixture.

## Migration Plan

Use pinned Supabase 2.119.0/pg-delta to generate the structural migration; keep the data backfill separately versioned. Inspect operation order and grants, rebuild the disposable local chain, run post-fixture SQL plus real browser/runtime/messaging integrations sequentially. Reidentify the selected production project, dry-run then apply migrations, perform rollback-only production checks and verify no plaintext marker reaches a protected message receipt. If application adapters change, build and deploy through the existing Vercel clean-archive workflow. Otherwise database rollout activates the protection. Retain explicit `releaseReady: false` until the remaining plan gates are satisfied.
