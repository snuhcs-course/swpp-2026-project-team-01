# Find Me a Time

An AI scheduling agent for external one-to-one meetings. **Thyme** negotiates times; booking requires the host's explicit approval of the current proposal.

Domain: [findmeatime.com](https://findmeatime.com) · SNU SWPP Project Team 01

## Status

**Documentation and specification phase.** The product direction, user experience, architecture, provider setup, visual design and capability specifications are agreed in this repository. Application code has not been started; implementation begins with a bounded OpenSpec change once the runtime stack is decided.

Read the [one-pager](documentations/01_one_pager.md), the [PRD](documentations/02_product_requirements.md), then the [implementation plan](documentations/technical_specification/04_implementation_plan.md). The [documentation index](documentations/README.md) lists every document.

Shared Supabase project: **`anelszynxtvxoxqvzgqt`** (**FindMeATime**, `us-east-2`). Teammates develop against personal Supabase projects and local `eve dev`; the shared project tracks `main` through CI, and a release environment is split off before the first external user. See [environments and collaboration](documentations/technical_specification/03_provider_setup.md#environments-and-collaboration).

## Repository layout

| Path | Contents |
|---|---|
| `documentations/` | Product direction, UX, architecture, implementation sequence and acceptance coverage |
| `DESIGN.md` | Thyme visual direction and brand assets |
| `openspec/specs/` | Agreed capability behavior; the contract the implementation must satisfy |
| `openspec/changes/` | Pending change proposals; completed changes are archived here after verification |
| `supabase/` | Local Supabase configuration; application SQL arrives with the first schema slice |
| `ai-usage/` | Per-branch AI token and agent-time records required by the course |
| `.agents/skills/` | Shared project workflows and reference material |

## Documents awaiting review

These documents were copied unchanged from the iteration 1 prototype so the team can review and update them against the documents above.

- [Transplant guide](documentations/transplant/en/transplant-guide.md): the prototype's features F01–F11, journeys and design decomposed for reuse.
- [iMessage agent specification](openspec/specs/imessage-agent/spec.md) and the [host iMessage assistant change](openspec/changes/host-imessage-assistant/proposal.md): the prototype's Photon-based iMessage behavior. Overlap with the interface documents is unresolved.
- [AI usage records](ai-usage/README.md): see [agent guidance](AGENTS.md#ai-usage-records) for the hook setup.

## Checks

Use Node.js 24 and OpenSpec CLI **1.14.0**. The link checker runs without installing dependencies:

```sh
npm run check:docs
openspec validate --all --strict
```

Application build and test commands arrive with the first implementation slice. Supabase CLI **2.119.0** is the team version; schema generation, database reset and deployment follow [agent guidance](AGENTS.md#supabase-schema-changes).
