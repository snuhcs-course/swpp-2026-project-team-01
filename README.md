# Find Me a Time

An AI scheduling agent for external one-to-one meetings. **Thyme** negotiates times; booking requires the host's explicit approval of the current proposal.

Domain: [findmeatime.com](https://findmeatime.com) · SNU SWPP Project Team 01

## Reconstruction status

**Documentation baseline only.** This branch starts from `main` and carries the documentation, specifications, design assets and shared skills of the previous `feat/astra-reconstruction` implementation, without its application code, tests, schema or migration chain. The team's `dev` prototype is also not carried over, apart from the documents listed under [Carried over for review](#carried-over-for-review). No replacement code has been started.

Read the [one-pager](documentations/01_one_pager.md), [PRD](documentations/02_product_requirements.md), then the [implementation plan](documentations/technical_specification/04_implementation_plan.md). The [foundation proposal](openspec/changes/reconstruct-runtime-foundation/proposal.md) is the first bounded future change. Implementation waits for a new explicit request.

Selected rebuild Supabase project: **`anelszynxtvxoxqvzgqt`** (**FindMeATime**, `us-east-2`), CLI-linked and reset at the user's explicit request. The application schema, legacy queue/jobs and migration history are empty; managed Auth/Storage remain. See [project setup and baseline prerequisites](documentations/technical_specification/03_provider_setup.md#selected-rebuild-supabase-project).

## Repository layout

| Path | Contents |
|---|---|
| `documentations/` | Product direction, UX, proposed architecture, implementation sequence and acceptance coverage |
| `DESIGN.md` | Thyme visual direction and retained original brand assets |
| `openspec/specs/` | Agreed behavior retained as the replacement's contract baseline; implementation coverage is reset |
| `openspec/changes/` | Fresh proposals and historical completed archives |
| `openspec/retired/` | Superseded unfinished plans from the previous implementation |
| `supabase/` | Inactive local configuration and reconstruction guidance; no application SQL |
| `.agents/skills/` | Shared project workflows and reference material |

## Preservation and recovery

The previous implementation, its migration history and its full commit history remain on the `feat/astra-reconstruction` branch (pre-removal recovery point `02e5a8e`); the iteration 1 prototype remains on `dev` and `iteration-1-demo`. Existing completed OpenSpec records are historical; their passing tests do not establish replacement readiness. Eleven unfinished change folders were retired without marking them complete. Legacy evidence ledgers, API audits and executable runbooks were removed from active documentation.

External deployments, provider accounts, DNS and credentials were not reconfigured. The selected Supabase application schema/history was subsequently reset at the user's explicit request, with managed data preserved and private local backups retained. Previous deployments may still be running independently of this checkout. Read [provider setup](documentations/technical_specification/03_provider_setup.md) before any later integration or deployment work. The selected project now has a verified empty application baseline. Recheck it before implementing a new chain; other populated targets still require applied-history reconciliation.

## Carried over for review

These documents were copied unchanged from the `dev` prototype branch so the team can review and update them against this baseline. They are not yet reconciled with the documents above.

- [Transplant guide](documentations/transplant/en/transplant-guide.md): the iteration 1 prototype's features F01–F11, journeys and design decomposed for reuse.
- [iMessage agent specification](openspec/specs/imessage-agent/spec.md) and the [host iMessage assistant change](openspec/changes/host-imessage-assistant/proposal.md): the prototype's Photon-based iMessage behavior. Overlap with the retained interface documents is unresolved.
- [AI usage records](ai-usage/README.md): per-branch token and agent-time reporting required by the course; see [agent guidance](AGENTS.md#ai-usage-records) for the hook setup.

## Checks available now

Use Node.js 24 and OpenSpec CLI **1.14.0**. The link checker runs without installing dependencies:

```sh
npm run check:docs
openspec validate --all --strict
```

Application build/test commands will be introduced with the future foundation change. Supabase CLI **2.119.0** remains the team version, but schema generation, database reset and deployment are outside this planning task. See [agent guidance](AGENTS.md).
