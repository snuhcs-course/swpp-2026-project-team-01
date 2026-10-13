# Find Me a Time

An AI scheduling agent for external one-to-one meetings. **Thyme** negotiates times; booking requires the host's explicit approval of the current proposal.

Domain: [findmeatime.com](https://findmeatime.com) · SNU SWPP Project Team 01

## Reconstruction status

**Planning only — application implementation removed on 2026-10-13.** No runnable app, package manifest, application tests, CI build pipeline, schema or migration chain remains in this checkout. No replacement code has been started.

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

The pre-removal source and migration history are recoverable from Git commit `02e5a8e`. Existing completed OpenSpec records are historical; their passing tests do not establish replacement readiness. Eleven unfinished change folders were retired without marking them complete. Legacy evidence ledgers, API audits and executable runbooks were removed from active documentation.

External deployments, provider accounts, DNS and credentials were not reconfigured. The selected Supabase application schema/history was subsequently reset at the user's explicit request, with managed data preserved and private local backups retained. Previous deployments may still be running independently of this checkout. Read [provider setup](documentations/technical_specification/03_provider_setup.md) before any later integration or deployment work. The selected project now has a verified empty application baseline. Recheck it before implementing a new chain; other populated targets still require applied-history reconciliation.

## Checks available now

Use OpenSpec CLI **1.14.0** to validate the specifications and foundation proposal:

```sh
openspec validate --all --strict
```

Application build/test commands will be introduced with the future foundation change. Supabase CLI **2.119.0** remains the team version, but schema generation, database reset and deployment are outside this planning task. See [agent guidance](AGENTS.md).
