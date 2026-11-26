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
| [User stories](user_experience/02_user_stories.md) | The ten stories of the testing baseline (H01–H04, G01–G03, M01, A01, R01) and the scope decided on 2026-11-23 |
| [Interfaces](user_experience/03_interfaces.md) | Web, requester email, host iMessage, personal agents, MCP and CLI responsibilities |
| [Page list](user_experience/04_page_list.md) | Single host workspace, the guest thread from the public page to the protected requester destination, and action cards |
| [Host onboarding flow](user_experience/05_host_onboarding_flow.md) | Setup states, step-by-step server checks, recorded data and resume behavior for hosts |
| [Guest booking flow](user_experience/06_guest_booking_flow.md) | Request states from the draft to confirmation, agent and email variants, recovery and closure |
| [Group meeting flow](user_experience/07_group_meeting_flow.md) | One host and several participants from one shared link: steps, what each side sees, and how options are found |
| [Technical overview](04_technical_specification.md) | System responsibilities and retained technical direction |
| [Backend architecture](technical_specification/01_backend_architecture.md) | Authority, domain transactions, feasibility and external-effect recovery |
| [Frontend architecture](technical_specification/02_frontend_architecture.md) | Proposed layout, UI/server boundaries, chat state and recovery |
| [Provider setup](technical_specification/03_provider_setup.md) | Recorded environment direction and future verification prerequisites |
| [Agent configuration](technical_specification/04_agent_configuration.md) | How the eve agent is defined on disk: instructions, tools, skills, connections, channels, memory and model |
| [CLI direction](technical_specification/05_cli.md) | Separate user/admin clients; administrator CLI implemented, user CLI pending |
| [Implementation plan](technical_specification/06_implementation_plan.md) | Proposed sequence of bounded OpenSpec changes, decision deadlines and acceptance evidence per phase, and the proposed next iteration plan |
| [Acceptance record](technical_specification/07_acceptance_record.md) | Evidence each phase produced, with command, date, revision and environment, and its known gaps |
| [Decision log](technical_specification/08_decision_log.md) | Every decision point per phase with its alternatives, where it is recorded and how to change it, plus steps blocked on the user |
| [Guest defense evaluation](technical_specification/10_guest_defense_evaluation.md) | Fixed attack set for the guest assistant, its grading, pre-declared pass criteria, run settings and results |
| [Host approval evaluation](technical_specification/11_host_approval_evaluation.md) | Draft: fixed set of host messages for approval in words, its grading, proposed pass criteria and run settings |
| [Testing baseline](technical_specification/12_testing_baseline.md) | Draft: step-by-step expected behavior of the ten user stories in each interface, with each row's verdicts and code status |
| [Story path evaluation](technical_specification/13_story_path_evaluation.md) | Draft: fixed set of story-path cases from the testing baseline, real-tool runner, run settings, testing progress; regression and capability tags, the pull request eval workflow, simulated guest journeys and the routing-time check and the proposed Iteration 4 metrics and baselines |
| [Host setup evaluation](technical_specification/14_host_setup_evaluation.md) | Draft: fixed set of host setup conversations graded on the setup draft they leave, the evaluation-only host setup entry, pass criteria and run settings |
| [Module test map](technical_specification/15_module_test_map.md) | The testing baseline's supported, code-decided rows mapped to the module tests that pin them, and the rows left without one |
| [QA sheet](technical_specification/16_qa_sheet.md) | Draft: one QA case per failure, branch and off-path outcome of the testing baseline, with columns to record each run |
| [Competitor research](business/competitor_research.md) | Dated research context and a comparison by user scenario for host and guest; no product compatibility claim |
| [Market and positioning](business/market_and_positioning.md) | Draft: the market we can earn from now, current players, the unsolved problem and our position, with sources |
| [Transplant guide](transplant/en/transplant-guide.md) | Iteration 1 prototype features F01–F11, journeys and design decomposed for reuse; copied from `dev` for review, not yet reconciled |

## Maintenance

Keep product purpose in the one-pager, scope and acceptance in the PRD, UX explanations in `user_experience/`, technical rationale in `technical_specification/`, and observable contracts in OpenSpec. Resolve a conflict explicitly before implementing the affected capability. Do not promote draft decisions into main specs or treat unverified evidence as current status.

Use two-digit prefixes within each ordered directory and update this index when a document moves. Preserve stable FR, AC, journey and story identifiers.
