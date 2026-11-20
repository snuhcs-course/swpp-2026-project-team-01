# Find Me a Time

Find Me a Time helps people arrange external one-to-one meetings. **Thyme** gathers the meeting details, finds times that fit the host's calendar and preferences, and coordinates the proposal. A calendar booking is created only after the guest agrees and the host approves the current proposal.

Domain: [findmeatime.com](https://findmeatime.com) · SNU SWPP Project Team 01

## How to use Find Me a Time

### Host a meeting

1. Open [findmeatime.com](https://findmeatime.com) and sign in with Google.
2. Link iMessage or Telegram, then connect Google Calendar through the setup flow. In that conversation, review Thyme's suggestions for meeting hours and places, confirm your preferences, and get your booking link.
3. Share the link with someone who wants to meet. Review their request in your conversation or the web workspace, then approve, revise, or decline the proposal. Your calendar dashboard shows Google events, bookings, and requests together.

### Request a meeting

1. Open a host's booking link. You do not need a Find Me a Time account.
2. Describe the meeting and your preferred times. Thyme checks the host's availability and meeting preferences before offering suitable options.
3. Agree to a proposal, and review any changes the host makes. The request waits for the host's approval; after approval and a successful calendar booking, you receive a confirmation email and invitation.

The [Iteration 4 demo](https://github.com/snuhcs-course/swpp-2026-project-team-01/tree/iteration-4-demo) shows the working service. For product details, read the [one-pager](documentations/01_one_pager.md), [PRD](documentations/02_product_requirements.md), and [documentation index](documentations/README.md).

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
