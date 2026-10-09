# Proposal

## Why

The [legacy requester audit](../../../../tests/README.md#legacy-requester-model-assertion-map) found that the replaced extractor rejected actionable fields whenever its classified intent was question or unknown. The current model tool accepts a partial patch without classifying intent. Restore that conditional boundary while preserving the [PRD's](../../../../documentations/02_product_requirements.md) conversational review flow.

## What Changes

- Require application-owned requester extraction to classify intent as details, availability, question or unknown.
- Reject any patch accompanying question/unknown intent before domain execution; allow clarification-only outcomes with an empty patch and at least one question.
- Preserve valid advisory drafts, exact retry identity and explicit protected application. Keep external authorized agent proposal contracts stable.
- Document that a declared-intent constraint does not prove a model correctly understood the human's meaning; retain live interpretation and false-narration gates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: constrain application model extraction classified as question or unknown, alongside [constrained asynchronous interpretation](../../../specs/meeting-requests/spec.md).

## Impact

Model-specific input contract, authored tool adapter, agent guidance, synthetic provider/runtime fixtures and documentation. No schema migration or external agent API change. No new approval authority or automatic application. Free-form clarification/status narration remains separate work.
