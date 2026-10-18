# Specification status

Date: 2026-10-19. Application implementation has not started.

`specs/` holds the agreed behavioral contract. Retaining a specification does not claim it is implemented. Follow the [PRD](../documentations/02_product_requirements.md) and resolve conflicts before implementing a capability.

The specifications fall into two groups:

- **Product behavior**, to be checked against the PRD and kept as the contract: `meeting-requests`, `meeting-feasibility`, `host-admission`, `chat-workspaces`, `conversation-access`, `email-delivery`, `public-agent-entry`, `agent-client-authorization` and `imessage-agent`.
- **Internal mechanisms** that constrain how the application is built: `durable-jobs`, `model-execution`, `application-commands`, `operational-diagnostics`, `messaging-environments`, `calendar-analysis-retention` and `requester-email-ingress`. Revisit, merge or rewrite these once the architecture is decided; do not treat them as fixed constraints on the design.

There is no pending first change proposal; propose the first change after the stack decision. Completed changes are archived under `changes/archive/` once implemented and verified.

`specs/imessage-agent/` and `changes/host-imessage-assistant/` were copied unchanged from the iteration 1 prototype and await team review; their overlap with the interface documents is unresolved.

Validate active artifacts with OpenSpec CLI 1.14.0 (`openspec validate --all --strict`) and sync or archive each bounded change only after implementation and verification.
