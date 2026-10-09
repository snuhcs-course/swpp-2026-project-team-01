# Proposal

## Why

The final gap in the [legacy requester assertion map](../../../tests/README.md#legacy-requester-model-assertion-map) is that a model-generated clarification can falsely claim booking or approval in a pending review. Restore authored clarification wording while keeping the [PRD's](../../../documentations/02_product_requirements.md) English/Korean conversational intake and useful missing-field questions.

## What Changes

- Application-owned requester extraction selects checked clarification categories instead of supplying arbitrary clarification prose.
- Map those categories to authored English or Korean questions before creating a review; preserve empty clarification arrays for complete drafts.
- Reject unsupported categories/languages before any RPC, retain current intent/patch rules and explicit application semantics, and preserve retry identity.
- Keep user-authored fields, ordinary chat text, existing stored reviews and external authorized agent APIs separate. This does not claim that arbitrary generated chat can never make a false statement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: authored clarification questions for new application model extraction, extending [constrained interpretation](../../specs/meeting-requests/spec.md).

## Impact

Model input schema, authored clarification dictionary, application extraction adapter, agent guidance, provider/real-review tests and documentation. No database migration or browser rendering change. External authorized agent proposal contracts remain unchanged. Broader narration, historical content and live model/provider/client acceptance remain explicit release obligations.
