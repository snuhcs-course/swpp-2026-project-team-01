# Proposal

## Why

Conversation admission is bounded, but one accepted input can still trigger repeated provider calls. Eve checks session token limits after a call and direct OpenAI does not establish the cost metadata needed by its dollar limit. Phase 9 of the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md) requires enforceable execution and spend limits.

## What Changes

- Bound each direct model invocation's input size, output, duration and provider options, including compaction and retries.
- Reserve a conservative model allowance durably before each actual provider attempt: eight attempts per accepted conversation input, two per ranking check, and shared daily principal/service ceilings.
- Preserve current authorization, failed-turn settlement, saved ranking retries and structured recovery when a limit is reached.
- Document the selected numeric policy, pricing assumptions and verification; leave unrelated operational release gates open.

## Capabilities

### New Capabilities

- `model-execution`: Provider invocation limits and durable accounting across conversational and ranking work.

### Modified Capabilities

None. The [chat workspace recovery contract](../../specs/chat-workspaces/spec.md) remains applicable.

## Impact

Eve model selection, shared server model wrapper, candidate ranking, private SQL counters/service RPCs, error handling, deterministic provider/runtime/concurrency tests and the operational documentation. No additional provider or infrastructure service. Numeric policy is selected in this change; live provider acceptance remains a separate gate until verified.
