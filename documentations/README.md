# Find Me a Time — Documentation

Start with the one-pager and product requirements, read the user-experience documents, then continue to the technical specification and backend/frontend architecture. Numbering is local to each directory.

For the pre-launch rebuild, start with the [implementation plan](technical_specification/04_implementation_plan.md), [page list](user_experience/04_page_list.md) and [frontend architecture](technical_specification/02_frontend_architecture.md). The rebuild includes the Supabase scheduling backend source.

Reconstruction target: **`https://release.findmeatime.com`**, using Supabase project **`mriseqztcwmezvtawnbo`**. See [deployment setup](technical_specification/03_provider_setup.md#reconstruction-deployment-origin); selecting this target does not establish live deployment readiness.

| Document | Purpose |
|---|---|
| [One-pager](01_one_pager.md) | Product purpose, target users, problem, solution, and core principles. |
| [Product requirements](02_product_requirements.md) | Draft release scope, waitlist/invite-only calendar hosting, agent onboarding and booking, requirements, acceptance scenarios, and open decisions. |
| [User journeys](user_experience/01_user_journeys.md) | End-to-end experiences, skill-prompt entry diagram, interface and decision flows, and MCP OAuth connection and revocation. |
| [User stories](user_experience/02_user_stories.md) | Actor-focused needs mapped to journeys and existing PRD requirements and acceptance scenarios. |
| [Interfaces](user_experience/03_interfaces.md) | Web, email, iMessage, personal-agent clients, MCP, CLI, and shared API responsibilities, including the proposed host email extension. |
| [Page list](user_experience/04_page_list.md) | Proposed canonical web routes, audiences, in-chat action cards, connection surfaces, page states and requirement coverage for the rebuild. |
| [Frontend architecture](technical_specification/02_frontend_architecture.md) | Proposed Next.js/eve boundaries, feature organization, state ownership, typed actions, identity, streaming and verification against the rebuilt backend. |
| [Implementation plan](technical_specification/04_implementation_plan.md) | Dependency-ordered rebuild phases, source ownership, decision deadlines and replacement acceptance evidence. |
| [Technical specification](03_technical_specification.md) | Concise architecture overview, system guarantees and links to detailed design owners. |
| [Backend architecture](technical_specification/01_backend_architecture.md) | Replacement domain/runtime boundaries, authorized commands, transactions, durable effects and recovery; deployment placement remains open. |
| [Provider setup](technical_specification/03_provider_setup.md) | Provider configuration, host invitation operations, Google consent, integration configuration and verification. |
| [Competitive landscape](business/competitor_research.md) | Source-backed competitor research, comparison boundaries, and suggested benchmark scenarios. |

Product and architecture documents describe the target implementation. OpenSpec owns behavioral contracts and pending changes; only fresh verification establishes rebuild readiness.

## Directory layout

```text
documentations/
  README.md
  01_one_pager.md
  02_product_requirements.md
  03_technical_specification.md
  user_experience/
    01_user_journeys.md
    02_user_stories.md
    03_interfaces.md
    04_page_list.md
  technical_specification/
    01_backend_architecture.md
    02_frontend_architecture.md
    03_provider_setup.md
    04_implementation_plan.md
  business/
    competitor_research.md
```

## Documentation and specifications

- `documentations/` explains product direction, audience, release scope, research, and design rationale.
- `openspec/specs/<capability>/spec.md` holds agreed capability behavior aligned with completed, verified changes.
- `openspec/changes/<change-name>/` holds proposed behavior changes, rationale, technical decisions, and implementation tasks until completion and archival.

As capability specifications are added, link to them from product documents rather than maintaining duplicate behavioral contracts. Keep unresolved decisions marked as proposals, and resolve discrepancies before implementing affected behavior.

See [agent guidance](../AGENTS.md) for the repository's documentation and change workflow, and [OpenSpec configuration](../openspec/config.yaml) for project configuration.

## Maintaining this index

Add or update links when documents are created, moved, or renamed. Keep product intent in the one-pager and PRD, and put supporting research in `business/` with sources and research dates.

Use two-digit prefixes starting at `01` for ordered documents within each directory, followed by a concise lowercase snake_case name. Keep `README.md` as the unnumbered index. Research files use descriptive names without sequence numbers. Filename numbering does not change stable requirement, acceptance, journey, or story IDs.
