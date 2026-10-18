# Find Me a Time — Documentation

Status: reviewed against the linked clean application database on 2026-10-13. Application implementation is absent; all replacement acceptance evidence remains pending. [Provider setup](technical_specification/03_provider_setup.md#clean-project-recheck--2026-10-13) records the surviving managed state and first-migration prerequisites.

Read product purpose and requirements, then UX, architecture and the implementation sequence. Detailed agreed behavior lives in [capability specifications](../openspec/specs/); pending requirements live in [active changes](../openspec/changes/). Planning documents do not establish delivery or deployment readiness.

| Document | Owner and purpose |
|---|---|
| [One-pager](01_one_pager.md) | Purpose, audience and core product principles |
| [PRD](02_product_requirements.md) | Release scope, FR-01–FR-36, AC-01–AC-28 and unresolved product decisions |
| [Design principles](04_design_principles.md) | Agent action parity, suggestion-first setup and separate user/admin CLIs |
| [Visual design](../DESIGN.md) | Thyme brand assets, palette, typography and accessible styling direction |
| [User journeys](user_experience/01_user_journeys.md) | End-to-end experience across channels |
| [User stories](user_experience/02_user_stories.md) | Actor needs linked to PRD requirements |
| [Interfaces](user_experience/03_interfaces.md) | Web, requester email, host iMessage, personal agents, MCP and CLI responsibilities |
| [Page list](user_experience/04_page_list.md) | Single host workspace, public intake, protected requester destination and action cards |
| [Technical overview](03_technical_specification.md) | System responsibilities and retained technical direction |
| [Backend architecture](technical_specification/01_backend_architecture.md) | Authority, domain transactions, feasibility and external-effect recovery |
| [Frontend architecture](technical_specification/02_frontend_architecture.md) | Proposed layout, UI/server boundaries, chat state and recovery |
| [Provider setup](technical_specification/03_provider_setup.md) | Recorded environment direction and future verification prerequisites |
| [Implementation plan](technical_specification/04_implementation_plan.md) | Bounded slices, dependencies, decision deadlines and exit gates |
| [CLI direction](technical_specification/06_cli.md) | Separate user/admin clients; executable commands pending |
| [Acceptance inventory](technical_specification/07_acceptance_inventory.md) | Every AC mapped to a future slice and required evidence |
| [Competitor research](business/competitor_research.md) | Dated research context; no product compatibility claim |
| [Transplant guide](transplant/en/transplant-guide.md) | Iteration 1 prototype features F01–F11, journeys and design decomposed for reuse; copied from `dev` for review, not yet reconciled |

## Historical material

Completed records remain in [OpenSpec archives](../openspec/changes/archive/). Unfinished plans moved to [retired plans](../openspec/retired/2026-10-13/README.md); their checkboxes and implementation references describe the previous attempt only. Neither directory is the active implementation queue. Retired documents and source remain recoverable through the pre-removal Git commit listed in the root README.

## Maintenance

Keep product purpose in the one-pager, scope and acceptance in the PRD, UX explanations in `user_experience/`, technical rationale in `technical_specification/`, and observable contracts in OpenSpec. Resolve a conflict explicitly before implementing the affected capability. Do not promote draft decisions into main specs or copy historical evidence into replacement status.

Use two-digit prefixes within each ordered directory and update this index when a document moves. Preserve stable FR, AC, journey and story identifiers.
