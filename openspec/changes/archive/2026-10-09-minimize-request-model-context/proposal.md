# Proposal

## Why

The [Phase 2 requester audit](../../../../tests/README.md#legacy-requester-model-assertion-map) found that the retired extractor excluded saved requester identity, while the replacement request read and draft result include saved names and email addresses. Restore structured contact minimization without removing conversational intake or the protected contact review required by the [PRD](../../../../documentations/02_product_requirements.md).

## What Changes

- Return presence flags instead of saved contact values in application-owned conversation tool results, including current details, proposals and nested review patches/details.
- Keep scheduling fields, current status and authorized discussion usable; preserve explicit contact edits and full protected browser review.
- Cover new reads, mutation results and exact application retries. Do not claim to erase earlier provider disclosures, user-authored free text or previously persisted runtime history.
- Document the distinction between tool-supplied structured identity and contact information a user deliberately writes in conversation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: minimize saved structured contact identity in conversation model context, extending [constrained interpretation](../../../specs/meeting-requests/spec.md).

## Impact

Application-owned conversation result projection, agent guidance, tests and technical documentation. Browser and external authorized agent contracts retain contact fields. No database mutation semantics, contact verification, agreement or booking changes. Uncertain-intent classification, false status narration, historical runtime data retention and live-provider acceptance remain separate unresolved work.
