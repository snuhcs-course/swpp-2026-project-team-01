# Design

## Context

See [proposal](proposal.md). The authored `propose_request_details` tool uses `detailsProposalInput`, shared with server/external agent operations. That schema rejects unexpected fields but has no intent discriminator. The retired model extractor checked its returned discriminator before accepting fields. The database already prevents direct model agreement or apply, and a clarification-bearing review is not applicable.

## Goals / Non-Goals

**Goals:** restore the conditional intent/patch invariant at the application model boundary and prove it with the actual Responses adapter plus durable runtime regression.

**Non-Goals:** prove correct semantic classification of arbitrary human language, replace free-form clarification prose, alter external-agent inputs or database mutation rules, or let a model's label express consent.

## Decisions

1. Add a model-only schema derived from `detailsProposalInput`, with required four-value intent and a refinement forbidding all patch fields for question/unknown. Preserve the base nonempty patch-or-clarification rule. An empty patch therefore needs clarification. Requiring a discriminant in the shared domain schema would unnecessarily break external authorized agent contracts.
2. Add a named model extraction entry point in `ConversationTools` that validates the enriched input and then removes only the classification before invoking existing `details_propose`. The authored tool and its crash-test fixture use that entry point. This checks the condition even if a caller bypasses framework schema validation, without adding model-controlled authority or changing retry keys.
3. Keep the classification out of the SQL payload: domain mutation is determined by the validated patch/clarifications. Identical logical drafts retain existing retry behavior. A different payload under the same accepted-message key still conflicts.
4. Update guidance to classify the current message explicitly. Bare assent is question/unknown unless it supplies an independently explicit detail; carry forward pending drafts only after resolving actual detail intent. Model misclassification remains possible, just as with the old discriminator; this restores a checked conditional invariant, not general intent-quality certification.

## Risks / Trade-offs

- Existing pending runtime work may contain old tool input → missing intent fails safely; refreshed model calls use the new schema and cannot bypass durable domain retry checks.
- Question-only review supersedes an earlier review → existing explicit draft semantics remain; the model should avoid unnecessary tool calls when answering a question and preserve current intended details only for classified details/availability messages.
- Treating the label as proof of consent → no new decision tool or domain permission is introduced.
- Fixture tests validate an unrelated schema → use the exported model schema and production extraction entry point in provider/runtime tests, with positive details and clarification controls.

## Migration Plan

No database migration. Commit the contract/tool/guidance and focused tests, then verify real review/runtime regression, post-fixture SQL, checks and builds. Deploy a scanned clean archive to the selected release project, verify Ready alias and HTTP guards, record evidence, then sync/archive. Broader model semantics and narration stay explicit release gates.
