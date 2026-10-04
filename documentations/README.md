# Find Me a Time — Documentation

Start with the one-pager and product requirements, read the user-experience documents, then continue to the technical specification, backend architecture, and repository structure. Numbering is local to each directory.

| Document | Purpose |
|---|---|
| [One-pager](01_one_pager.md) | Product purpose, target users, problem, solution, and core principles. |
| [Product requirements](02_product_requirements.md) | Draft release scope, waitlist/invite-only calendar hosting, agent onboarding and booking, requirements, acceptance scenarios, and open decisions. |
| [User journeys](user_experience/01_user_journeys.md) | End-to-end experiences, skill-prompt entry diagram, interface and decision flows, and MCP OAuth connection and revocation. |
| [User stories](user_experience/02_user_stories.md) | Actor-focused needs mapped to journeys and existing PRD requirements and acceptance scenarios. |
| [Interfaces](user_experience/03_interfaces.md) | Web, email, iMessage, personal-agent clients, MCP, CLI, and shared API responsibilities, including the proposed host email extension. |
| [Technical specification](03_technical_specification.md) | Selected Supabase backend, architecture, data model, authorization, booking recovery, and verification plan. |
| [Backend architecture](technical_specification/01_backend_architecture.md) | Edge Function roles and layout, shared modules, Queues/Cron processing, transactions, and operational recovery. |
| [Repository structure](technical_specification/02_repo_structure.md) | Planned monorepo layout, interface entry points, capability modules, shared contracts, and test ownership. |
| [Provider setup](technical_specification/03_provider_setup.md) | Development skills, messaging CLI credentials, verified provisioning, and remaining integration checks. |
| [Implementation plan](technical_specification/04_implementation_plan.md) | Delivery phases, dependencies, team responsibilities, and release verification gates. |
| [Competitive landscape](business/competitor_research.md) | Source-backed competitor research, comparison boundaries, and suggested benchmark scenarios. |

Supabase PostgreSQL, Auth, Edge Functions (TypeScript/Deno with Hono), Queues, and Cron are the selected backend stack. The PRD, user-experience documents, and remaining technical designs are drafts for team review, not evidence of implemented features. Journeys explain the experience and stories express user needs; both reference the PRD rather than introduce independent acceptance contracts. The interface overview marks proposed extensions that still need PRD requirements. Research distinguishes vendor claims from verified behavior and product hypotheses.

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
  technical_specification/
    01_backend_architecture.md
    02_repo_structure.md
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
