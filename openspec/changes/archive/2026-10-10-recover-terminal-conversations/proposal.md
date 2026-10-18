# Proposal

## Why

The [model failure acceptance](../../../../documentations/technical_specification/05_rebuild_evidence.md#direct-model-access-and-failure-acceptance--2026-10-10) demonstrates that an OpenAI authentication error terminates eve's canonical workflow. Saved scheduling state survives, but subsequent accepted input remains reconciliation-pending because the application correctly refuses an implicit replacement. The implementation plan requires a guarded path back to the same authorized conversation.

## What Changes

- Keep recoverable provider configuration failures at the turn boundary where possible, without erasing reservations or exposing upstream errors.
- Add an explicit authenticated browser recovery action for a positively identified terminal workflow, preserving the logical conversation and creating a fenced successor runtime generation.
- Preserve old authorized history, cursor continuity, pending input identity, tool idempotency and model allowances across recovery. Do not replay completed commands or turn assistant text into decisions.
- Deny retired runtimes at tool, model, delivery and settlement boundaries. Serialize concurrent recovery and ordinary dispatch; retain uncertain outcomes for retry rather than guessing that an inaccessible workflow is terminal.
- Verify existing failed-session recovery as well as prevention of future authentication-induced termination; deploy and record both managed and local evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conversation-access`: guarded successor generations with current authority, stable logical identity and preserved authorized history.
- `chat-workspaces`: explicit recovery status/action and accessible continuation after terminal runtime failure.
- `model-execution`: provider configuration failure remains a failed bounded attempt; recovery cannot reset accounting or silently invoke the provider again.

## Impact

Application conversation contracts, SQL session/inbox/tool authorization, additive declarative migration, eve channel delivery/history/stream adapters, browser gateway and conversation controls, model error handling, runtime/browser/SQL tests and managed acceptance. See the [PRD](../../../../documentations/02_product_requirements.md), [implementation plan](../../../../documentations/technical_specification/04_implementation_plan.md), [conversation contract](../../../specs/conversation-access/spec.md), [workspace contract](../../../specs/chat-workspaces/spec.md) and [model limits](../../../specs/model-execution/spec.md).

This change introduces no new identity provider, channel receiver, scheduling approval path, external queue or automatic session replacement. Existing model/admission limits and closed/revoked-request restrictions remain in force. SDK metadata/history behavior must be verified with pinned eve before implementation treats a successor as recoverable; unknown provider state never authorizes a transition.
