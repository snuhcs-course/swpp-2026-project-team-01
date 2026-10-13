# Design

## Context

See [proposal](proposal.md). `ConversationTools.execute` returns the audience-authorized database result for `request_read`, `details_propose` and `private_note_save` without a model projection. Current details, proposal details and review patch/merged details use the same `requesterName` and `requesterEmail` keys. Browser review and external agent operations use separate adapters. The installed eve tools guide confirms that an executor's result enters model history by default.

## Goals / Non-Goals

**Goals:** remove structured contact values from new application conversation results and repeat RPC results, retain partial-patch meaning and scheduling/authorized discussion, and leave full contact review available to the authorized person.

**Non-Goals:** rewrite database contracts or previous runtime history; redact names/emails embedded in user-authored prose; remove the ability to propose contact corrections; solve uncertain-intent interpretation or false narration. This does not undo prior provider disclosures or certify live model quality.

## Decisions

1. Project the three request-related conversation operations in `ConversationTools`, after the existing authorized RPC returns and before eve records the tool result. Browser and external agent adapters remain unchanged. A SQL-wide projection would incorrectly remove data needed by protected review. An instructions-only restriction would still transmit saved contact values.
2. Recursively replace structured `requesterName`/`requesterEmail` keys with derived `requesterNameProvided`/`requesterEmailProvided` booleans. Recursion covers current/proposal/review details and future nested copies instead of enumerating only today's two paths. A missing source key creates no flag, preserving omitted patch semantics; an explicit empty string produces false. Reject malformed contact values safely. Derived flags override any colliding source flag. Return a new JSON value without mutating the database response or caller input.
3. Preserve other audience-authorized fields, including scheduling details, revision, review state, existing private discussion and provenance. This helper is contact minimization, not a substitute for database audience/credential filtering. A broad email regex would corrupt meeting links or user intent and cannot guarantee reliable free-text redaction.
4. Tell the agent that flags indicate supplied contact fields, not verification or consent. It must preserve omitted contact edits, ask only for missing information and direct contact-value review to protected controls. User-supplied text and model-supplied contact edits necessarily remain visible within that conversation.
5. Exact database retries pass through the same projection. Completed historical eve steps can replay previously stored output without reexecuting this adapter; no retrospective sanitization is claimed. Retention/history migration remains a separate release obligation.

## Risks / Trade-offs

- Saved identity no longer supports conversational repetition of the exact address → protected contact review remains the source for exact values; flags prevent unnecessary recollection.
- Omitted patch mistaken for clearing contact → emit flags only for source keys present and retain explicit-empty false.
- Nested echo or retry bypass → unit sentinels on every nesting level and real RPC creation/read/replay coverage through the adapter.
- Generic recursion changes an unrelated object with these reserved keys → those structured contact names intentionally receive the same minimization; other keys/text remain unchanged.
- Projection failure after a committed draft → preserve the server-derived retry identity and fail safely; do not invent a successful response or repeat mutation with a new key.

## Migration Plan

No database migration is needed. First demonstrate the current contact echo with a regression, implement and verify unit/real RPC/runtime checks, run post-fixture SQL and application checks/builds. Deploy a scanned clean Git archive to the identified release project, verify the Ready alias and production HTTP guards, record evidence, then sync/archive. Rolling back would restore structured contact disclosure and requires an explicit corrective decision; do not rewrite historical migrations or silently alter existing session history.
