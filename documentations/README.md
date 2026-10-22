# Find Me a Time — Documentation

Status: Phase 1 (foundation) and Phase 2 (host onboarding) implemented, with their evidence in the [acceptance record](technical_specification/07_acceptance_record.md); later phases are in specification. [Provider setup](technical_specification/03_provider_setup.md) records the selected environment and verification prerequisites.

Read product purpose and requirements, then UX and architecture. Detailed agreed behavior lives in [capability specifications](../openspec/specs/); pending requirements live in [active changes](../openspec/changes/). Planning documents do not establish delivery or deployment readiness.

| Document | Owner and purpose |
|---|---|
| [One-pager](01_one_pager.md) | Purpose, audience and core product principles |
| [PRD](02_product_requirements.md) | Release scope, FR-01–FR-36, AC-01–AC-28 and unresolved product decisions |
| [Design principles](03_design_principles.md) | Agent action parity, suggestion-first setup and separate user/admin CLIs |
| [Visual design](../DESIGN.md) | Thyme brand assets, palette, typography and accessible styling direction |
| [User journeys](user_experience/01_user_journeys.md) | End-to-end experience across channels |
| [User stories](user_experience/02_user_stories.md) | Actor needs linked to PRD requirements |
| [Interfaces](user_experience/03_interfaces.md) | Web, requester email, host iMessage, personal agents, MCP and CLI responsibilities |
| [Page list](user_experience/04_page_list.md) | Single host workspace, the guest thread from the public page to the protected requester destination, and action cards |
| [Host onboarding flow](user_experience/05_host_onboarding_flow.md) | Setup states, step-by-step server checks, recorded data and resume behavior for hosts |
| [Guest booking flow](user_experience/06_guest_booking_flow.md) | Request states from the draft to confirmation, agent and email variants, recovery and closure |
| [Technical overview](04_technical_specification.md) | System responsibilities and retained technical direction |
| [Backend architecture](technical_specification/01_backend_architecture.md) | Authority, domain transactions, feasibility and external-effect recovery |
| [Frontend architecture](technical_specification/02_frontend_architecture.md) | Proposed layout, UI/server boundaries, chat state and recovery |
| [Provider setup](technical_specification/03_provider_setup.md) | Recorded environment direction and future verification prerequisites |
| [Agent configuration](technical_specification/04_agent_configuration.md) | How the eve agent is defined on disk: instructions, tools, skills, connections, channels, memory and model |
| [CLI direction](technical_specification/05_cli.md) | Separate user/admin clients; administrator CLI implemented, user CLI pending |
| [Implementation plan](technical_specification/06_implementation_plan.md) | Proposed sequence of bounded OpenSpec changes, decision deadlines and acceptance evidence per phase |
| [Acceptance record](technical_specification/07_acceptance_record.md) | Evidence each phase produced, with command, date, revision and environment, and its known gaps |
| [Decision log](technical_specification/08_decision_log.md) | Every decision point per phase with its alternatives, where it is recorded and how to change it, plus steps blocked on the user |
| [Competitor research](business/competitor_research.md) | Dated research context; no product compatibility claim |
| [Transplant guide](transplant/en/transplant-guide.md) | Iteration 1 prototype features F01–F11, journeys and design decomposed for reuse; copied from `dev` for review, not yet reconciled |

## Maintenance

Keep product purpose in the one-pager, scope and acceptance in the PRD, UX explanations in `user_experience/`, technical rationale in `technical_specification/`, and observable contracts in OpenSpec. Resolve a conflict explicitly before implementing the affected capability. Do not promote draft decisions into main specs or treat unverified evidence as current status.

Use two-digit prefixes within each ordered directory and update this index when a document moves. Preserve stable FR, AC, journey and story identifiers.
