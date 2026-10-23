# Specification status

Date: 2026-10-21. Phases 1 and 2 of the [implementation plan](../documentations/technical_specification/06_implementation_plan.md) are implemented, with their evidence in the [acceptance record](../documentations/technical_specification/07_acceptance_record.md).

`specs/` holds the agreed behavioral contract. Retaining a specification does not claim it is implemented. Follow the [PRD](../documentations/02_product_requirements.md) and resolve conflicts before implementing a capability.

The specifications fall into two groups:

- **Product behavior**, to be checked against the PRD and kept as the contract: `meeting-requests`, `meeting-feasibility`, `host-admission`, `chat-workspaces`, `conversation-access`, `email-delivery`, `public-agent-entry` and `agent-client-authorization`.
- **Internal mechanisms** that constrain how the application is built: `durable-jobs`, `model-execution`, `application-commands`, `operational-diagnostics`, `messaging-environments`, `calendar-analysis-retention` and `requester-email-ingress`. Revisit, merge or rewrite these once the architecture is decided; do not treat them as fixed constraints on the design.

The first two changes, [`application-foundation`](changes/application-foundation/proposal.md) and [`host-onboarding`](changes/host-onboarding/proposal.md), are implemented and merged but not yet archived: `application-foundation` tasks 2.3 and 2.8 and `host-onboarding` task 7.1 are still open. Until `host-onboarding` is archived, its deltas (the numeric `host-admission` limits and the new `host-setup` capability) live only in that change. Completed changes are archived under `changes/archive/` once implemented and verified.

Retired on 2026-10-19: the iteration 1 `specs/imessage-agent/` (a standalone echo responder) and `changes/host-imessage-assistant/` (a service-sent welcome over the prototype's Drizzle tables). Both contradicted the PRD's selected host-sent link code and described code that does not exist in this repository. Host iMessage behavior is re-specified by the Phase 6 change [`host-imessage-channel`](changes/host-imessage-channel/proposal.md) of the [implementation plan](../documentations/technical_specification/06_implementation_plan.md). The retired text remains readable with `git show e3c01d2:openspec/changes/host-imessage-assistant/design.md`; its outbox, durable-before-acknowledgment webhook and uncertain-send lockout are design input for that change.

Validate active artifacts with OpenSpec CLI 1.14.0 (`openspec validate --all --strict`) and sync or archive each bounded change only after implementation and verification.
