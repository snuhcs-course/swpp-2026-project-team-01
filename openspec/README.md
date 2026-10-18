# Specification status after reconstruction reset

Date: 2026-10-13. Application implementation is absent.

`specs/` retains the agreed behavioral baseline. Retaining a specification does not claim it is implemented in this checkout. Follow the [PRD](../documentations/02_product_requirements.md) and resolve conflicts before implementing a capability.

The specifications fall into two groups for the rebuild review:

- **Product behavior**, to be checked against the PRD and kept as the contract: `meeting-requests`, `meeting-feasibility`, `host-admission`, `chat-workspaces`, `conversation-access`, `email-delivery`, `public-agent-entry`, `agent-client-authorization` and `imessage-agent`.
- **Internal mechanisms** written from the previous implementation's design: `durable-jobs`, `model-execution`, `application-commands`, `operational-diagnostics`, `messaging-environments`, `calendar-analysis-retention` and `requester-email-ingress`. Revisit, merge or rewrite these once the rebuild's architecture is decided; do not treat them as fixed constraints on the new design.

There is no pending first-slice proposal. The [implementation plan](../documentations/technical_specification/04_implementation_plan.md) sequences the proposed slices; propose S1 after the stack decision.

`changes/archive/` contains completed historical records of the removed implementation and documents where each specification came from. Historical links, paths, checkmarks and test claims describe the old snapshot; retrieve matching source/docs from the `feat/astra-reconstruction` branch (pre-removal commit `02e5a8e`) when investigating them. The previous implementation's unfinished plans were not carried over. The archive is outside the active documentation link audit.

`specs/imessage-agent/`, `changes/host-imessage-assistant/` and `changes/archive/2026-10-17-photon-imessage-agent/` were copied unchanged from the `dev` prototype branch and await team review; their overlap with the retained iMessage interface documents is unresolved.

Implementation requires a new explicit request. Validate active artifacts with OpenSpec CLI 1.14.0 and sync/archive each bounded change only after fresh implementation and verification.
