# Find Me a Time

An AI scheduling agent for external one-to-one meetings. **Thyme** negotiates times; booking requires the host's explicit approval of the current proposal.

Domain: [findmeatime.com](https://findmeatime.com) · SNU SWPP Project Team 01

## Status

**Phases 1 and 2 implemented.** The product direction, user experience, architecture, provider setup, visual design and capability specifications are agreed in this repository. The [`application-foundation`](openspec/changes/application-foundation/proposal.md) change built Google sign-in, the `/app` workspace and the platform mechanics, and [`host-onboarding`](openspec/changes/host-onboarding/proposal.md) added suggestion-first host setup, public host pages and skill documents, and the administrator CLI. Both are deployed on `findmeatime.com` and `release.findmeatime.com`; the [acceptance record](documentations/technical_specification/07_acceptance_record.md) holds their evidence and open gaps. Requester intake and booking arrive with later phases.

Read the [one-pager](documentations/01_one_pager.md) and the [PRD](documentations/02_product_requirements.md). The [documentation index](documentations/README.md) lists every document.

Shared Supabase project: **`anelszynxtvxoxqvzgqt`** (**FindMeATime**, `us-east-2`). Teammates develop against personal Supabase projects and local `eve dev`; the shared project tracks `main` through CI, and a release environment is split off before the first external user. See [environments and collaboration](documentations/technical_specification/03_provider_setup.md#environments-and-collaboration).

## Repository layout

| Path | Contents |
|---|---|
| `agent/` | eve agent definition, instructions and channels |
| `apps/web/` | Next.js web app: public entry at `/`, conversation at `/app` |
| `lib/` | Contracts and server code shared by the agent and the web app |
| `tests/` | Integration and browser tests; unit tests live beside their modules |
| `documentations/` | Product direction, UX, architecture and provider setup |
| `DESIGN.md` | Thyme visual direction and brand assets |
| `openspec/specs/` | Agreed capability behavior; the contract the implementation must satisfy |
| `openspec/changes/` | Pending change proposals; completed changes are archived here after verification |
| `supabase/` | Local Supabase configuration, the desired schema, the reviewed migration chain and database tests |
| `ai-usage/` | Per-branch AI token and agent-time records required by the course |
| `.agents/skills/` | Shared project workflows and reference material |

## Documents awaiting review

These documents were copied unchanged from the iteration 1 prototype so the team can review and update them against the documents above.

- [Transplant guide](documentations/transplant/en/transplant-guide.md): the prototype's features F01–F11, journeys and design decomposed for reuse.
- [AI usage records](ai-usage/README.md): see [agent guidance](AGENTS.md#ai-usage-records) for the hook setup.

## Checks

Use Node.js 24 and OpenSpec CLI **1.14.0**. The link checker runs without installing dependencies:

```sh
npm run check:docs
openspec validate --all --strict
```

Install the application with `npm ci`, then run the checks CI runs:

```sh
npm run build
npm run lint
npm run typecheck
npm test
```

`npm run test:integration` runs the integration tests, and `npm run test:e2e` runs the Playwright browser tests (install a browser once with `npx playwright install chromium`); both need the local stack from `supabase start` and never call OpenAI, except the opt-in `E2E_LIVE_MODEL=1 npm run test:e2e`, which runs the sign-in-to-first-reply journey against the real model. `npm run dev` runs the web and agent services from the root `.env`, with `.env.local` overrides. Operators suspend, restore and inspect hosts with `npm run admin -- <show|suspend|restore> --host <handle-or-id> --operator <name> (--local | --project <ref>)`, the `fmat-admin` CLI described in the [CLI direction](documentations/technical_specification/05_cli.md#administrator-cli). Supabase CLI **2.119.0** is the team version; schema generation, database reset and deployment follow [agent guidance](AGENTS.md#supabase-schema-changes).
