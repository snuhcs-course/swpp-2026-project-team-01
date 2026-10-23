# Find Me a Time

An AI scheduling agent for external one-to-one meetings. **Thyme** negotiates times; booking requires the host's explicit approval of the current proposal.

Domain: [findmeatime.com](https://findmeatime.com) · SNU SWPP Project Team 01

## Iteration 2 demo

This branch, `iteration-2-demo`, is `main` at `873804b` plus the pull requests open at the end of Iteration 2: [#36](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/36) (operations and release), [#37](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/37) (guest Google consent), [#38](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/38) (Windows local development) and [#39](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/39) (iMessage link screens and setup in iMessage). The only change beyond those pull requests is the `/privacy` link in the new landing's footer, which #36 requires.

**Demo video:** _link added after recording._

### What the demo shows

1. **Two ways in.**
   - `/` starts with Google, and its Calendar box decides whether Calendar is connected now.
   - `/?flow=imessage` starts with **Onboard with iMessage**, before any account exists.
   - Both pages work in English and Korean.
2. **Linking iMessage by sending one message.**
   - On a phone, **Open Messages** opens Messages with the message already written.
   - On a computer, a popup offers a QR code, **Open Messages on this Mac** and **Copy**.
   - The page changes by itself when the message arrives. The host then confirms the masked sender (**Is this you?**) before anything is linked.
3. **Setup in iMessage.**
   - Thyme's reply to an iMessage start carries a sign-in link.
   - After **Confirm and link**, Thyme welcomes the host in iMessage and either sends a Google Calendar link or asks the first setup question.
   - Plain replies continue the same setup conversation that the web shows.
4. **The rest of the product on the same build:**
   - suggestion-first host setup from Google Calendar;
   - the public host page;
   - a guest's request in a chat thread (with Google consent from its forms, #37);
   - host review and approval;
   - booking;
   - the requester email channel;
   - agent access over MCP;
   - the `/privacy` notice and operator diagnostics (#36).

### Major progress during Iteration 2

| Phase | Pull request | What it added |
|---|---|---|
| 1 Application foundation | #19 | Google sign-in, the `/app` workspace, the Supabase schema baseline, the command pipeline and jobs |
| 2 Host onboarding | #22 | Suggestion-first setup, public host pages and skill documents, handles, the administrator CLI |
| 3 Requester intake and feasibility | #26, #27, #28 | The guest's request thread, feasibility, requester Google grants |
| 4 Host review and booking | #30, #32 | Host review, explicit approval and booking with the Calendar event |
| 5 Agent access | #33 | An authorization server, an MCP server, a CLI and requester bootstrap |
| 6 Host iMessage channel | #35, #39 | The Photon receiver, outbox and commands; the link screens, the iMessage start and setup in iMessage |
| 7 Requester email channel | #34 | Requests and replies by email |
| 8 Operations and release | #36 | Diagnostics, recovery, retention and deletion, the privacy notice, the release workflow |

### Environment used for the demo

- macOS 26.6.2 on Apple silicon, with Node.js 25.9.0 (the team targets Node.js 24) and npm.
- Docker Desktop, Supabase CLI 2.119.0 and a local Supabase stack.
- Chrome on the Mac. An iPhone with iMessage, on the same Apple ID as the Mac's Messages.
- One Photon Spectrum project with one line, and an OpenAI API key (the agent spends money).

### How to run it

1. Install and start the local stack:

   ```sh
   npm ci
   supabase start
   supabase db reset --local
   ```

2. Fill `.env` from `.env.example`, and put the local stack's values (`supabase status`) in `.env.local`. The demo needs:
   - `OPENAI_API_KEY`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - `TOKEN_ENCRYPTION_KEY`, `EVE_INTERNAL_SIGNING_KEY` and `AGENT_TOKEN_SIGNING_KEY`
   - `APP_ORIGIN=http://localhost:3000`
   - `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `PHOTON_LINE_NUMBER`, `PHOTON_WEBHOOK_ID` and `PHOTON_WEBHOOK_SECRET`

3. Run the services, each in its own terminal:

   ```sh
   npm run dev       # web on :3000, agent on :2000 (serves /photon/webhook)
   npm run jobs:dev  # receipt, send and other jobs
   ```

4. Open `http://localhost:3000` (Google first) or `http://localhost:3000/?flow=imessage` (iMessage first).

Steps that only a live iMessage and Google demo needs, done on the presenter's machine and never committed:

- **Receiving iMessage.**
  - Expose the agent's `/photon/webhook` over HTTPS, for example with a Cloudflare quick tunnel.
  - Register that URL as the Photon project's webhook, then set `PHOTON_WEBHOOK_ID` and `PHOTON_WEBHOOK_SECRET`.
- **Sending iMessage.** Messaging is production-only by design, so a local run sends only to a loopback stand-in at `PHOTON_API_URL`. For the demo, that stand-in forwards to Photon, and only for the presenter's own number.
- **Google sign-in.** Google must accept the local Auth callback, `http://127.0.0.1:54321/auth/v1/callback` (see [provider setup](documentations/technical_specification/03_provider_setup.md#google-identity-and-calendar)). A phone cannot reach a local callback, so the web steps run on the Mac and the iPhone is used for Messages.

Without Photon, Google or OpenAI, the checks under [Checks](#checks) run against the stand-ins that the tests use.

## Status

**Phases 1 to 8 implemented on this branch** (see [Iteration 2 demo](#iteration-2-demo)); the rest of this paragraph describes the state before Iteration 2's last pull requests. The product direction, user experience, architecture, provider setup, visual design and capability specifications are agreed in this repository. The [`application-foundation`](openspec/changes/application-foundation/proposal.md) change built Google sign-in, the `/app` workspace and the platform mechanics, and [`host-onboarding`](openspec/changes/host-onboarding/proposal.md) added suggestion-first host setup, public host pages and skill documents, and the administrator CLI. Both are deployed on `findmeatime.com` and `release.findmeatime.com`; the [acceptance record](documentations/technical_specification/07_acceptance_record.md) holds their evidence and open gaps. Requester intake and booking arrive with later phases.

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
