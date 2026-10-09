# Proposal

## Why

The retired onboarding conversation removed pasted credential material, but the replacement shared runtime currently persists and delivers it unchanged. A rollback-only local database probe confirms that synthetic bearer, OAuth-link and linking-proof values survive admission and delivery. Restore that privacy boundary before treating the legacy onboarding audit as complete.

## What Changes

- Remove recognized pasted credentials from newly admitted conversation text before it becomes runtime input, covering web and the shared email/iMessage execution path.
- Preserve surrounding scheduling prose and usable nonsecret link context; display a clear replacement marker for removed values.
- Preserve exact-input retry discrimination without storing the original secret-bearing text in the runtime ledger.
- Protect pending legacy inputs before future dispatch and explicitly bound historical cleanup claims: already generated eve history and provider inboxes are not silently rewritten by this change.
- Verify ordinary messages, repeat delivery, conflicting retries, rollback and channel integration, then deploy the migration to the selected production project.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-workspaces`: recognized credential minimization before canonical conversation runtime persistence/delivery, with unchanged authority and retry semantics.

## Impact

Owning behavior: [chat workspaces](../../../specs/chat-workspaces/spec.md), [conversation access](../../../specs/conversation-access/spec.md), [PRD](../../../../documentations/02_product_requirements.md) and the [implementation plan](../../../../documentations/technical_specification/04_implementation_plan.md). Implementation touches the shared SQL runtime admission/dispatch boundary, declarative schema and a generated migration, plus database/integration tests and architecture/evidence documentation. No new provider dependency or human message is required. Free-form assistant status narration and historical transcript retention remain separate open work; this change does not claim a general secret detector or historical erasure.
