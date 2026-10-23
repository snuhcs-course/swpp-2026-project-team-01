# Find Me a Time — Iteration 2

**Thyme** is an AI scheduling agent for external one-to-one meetings. A host signs in with Google and sets up their meeting rules with Thyme, in the web chat or in iMessage. Requesters ask for a time through a public link or by email, with no account. A booking is made only when the host explicitly approves the current proposal.

## Contents

- [Demo video](#demo-video)
- [Demo scope](#demo-scope)
- [What changed in Iteration 2](#what-changed-in-iteration-2)
- [Tech stack](#tech-stack)
- [Deployed service](#deployed-service)
- [Prerequisites](#prerequisites)
- [Running locally](#running-locally)
- [Live iMessage and Google (reproducing the video)](#live-imessage-and-google-reproducing-the-video)
- [Checks](#checks)
- [Expected errors and fixes](#expected-errors-and-fixes)

## Demo video

_Added as `demos/iteration-2-demo.mov` after recording._

This branch is `main` at `873804b` plus the pull requests that were still open at the end of Iteration 2:

| PR | Contents |
|---|---|
| [#36](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/36) | Operations and release (Phase 8) |
| [#37](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/37) | Guest Google consent fix |
| [#38](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/38) | Windows local development fix |
| [#39](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/39) | iMessage link screens and setup in iMessage |

The only change beyond those pull requests is the `/privacy` link in the new landing's footer, which #36 requires. The video was recorded with the **local run** below plus live iMessage and Google.

## Demo scope

The demo video covers:

1. **Two ways in.**
   - `/` starts with Google, and its Calendar box decides whether Calendar is connected now.
   - `/?flow=imessage` starts with **Onboard with iMessage**, before any account exists.
   - Both pages work in English and Korean.
2. **Linking iMessage by sending one message.**
   - On a phone, **Open Messages** opens Messages with the message already written.
   - On a computer, a popup offers a QR code, **Open Messages on this Mac** and **Copy**.
   - The page changes by itself when the message arrives. Nothing is linked until the host confirms the masked sender (**Is this you?**).
3. **Setup that carries on in iMessage.**
   - Thyme's reply to an iMessage start carries a sign-in link.
   - After **Confirm and link**, Thyme greets the host in iMessage. It sends a Google Calendar link if Calendar is missing, and the first setup question otherwise.
   - Replies continue the same setup conversation that the web shows.

This branch also implements features that the video does not show:

- host setup that suggests values from the host's Calendar
- the public host page
- a guest's request in a chat thread
- host review and approval, through to booking with a Calendar event
- the requester email channel
- agent access over MCP
- the `/privacy` notice and the operator diagnostics CLI

## What changed in Iteration 2

The Iteration 1 prototype (Drizzle, the app's own Google OAuth, Ollama) was rebuilt on a new architecture from 2026-10-19. The phases merged during Iteration 2:

| Phase | PR | What it added |
|---|---|---|
| 1 Application foundation | #19 | Google sign-in through Supabase Auth, the `/app` workspace, the schema baseline, the command pipeline and jobs |
| 2 Host onboarding | #22 | Suggestion-first setup, public host pages and skill documents, handles, the administrator CLI |
| 3 Requester intake and feasibility | #26, #27, #28 | The guest's request thread, feasibility checks, requester Google grants |
| 4 Host review and booking | #30, #32 | Host review, explicit approval, booking that creates the Calendar event |
| 5 Agent access | #33 | An authorization server, an MCP server, a CLI and requester bootstrap |
| 6 Host iMessage channel | #35, #39 | The Photon receiver, outbox and commands; the link screens, the iMessage start and setup in iMessage |
| 7 Requester email channel | #34 | Requests and replies by email |
| 8 Operations and release | #36 | Diagnostics, recovery, retention and deletion, the privacy notice, the release workflow |

## Tech stack

| Area | Technology |
|---|---|
| Web UI / server API | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Agent | eve 0.80 (Vercel), OpenAI `gpt-5.6-terra` |
| Database / sign-in | Supabase Postgres and Auth, postgres.js, pg-delta declarative schema |
| Calendar | Google OAuth 2.0, Google Calendar API |
| iMessage | Photon Spectrum (`@spectrum-ts` 12.14.0) |
| Email | AgentMail |
| Tests | Vitest, Playwright, pgTAP |
| Web hosting | Vercel |

## Deployed service

The production deployment is at [https://findmeatime.com](https://findmeatime.com). As of 2026-10-23 it predates Phase 6 (iMessage), as #36 records, so the iMessage flow on this branch is shown with the local run below.

## Prerequisites

- Node.js 24 and npm. The video was recorded with Node.js 25.9.0.
- Docker Desktop and Supabase CLI **2.119.0** (check with `supabase --version`).
- An OpenAI API key for the agent's conversation. It costs money.
- A Google OAuth client in a Google Cloud project with the Calendar API enabled. Register `http://127.0.0.1:54321/auth/v1/callback` as a redirect URI.
- For live iMessage: a Photon Spectrum project with one line, an iPhone, and the Mac's Messages on the same Apple ID.

```bash
git clone --branch iteration-2-demo https://github.com/snuhcs-course/swpp-2026-project-team-01.git
cd swpp-2026-project-team-01
npm ci
cp .env.example .env
```

## Running locally

1. Start Docker and the local Supabase stack. `db reset --local` deletes existing local data.

```bash
supabase start
supabase db reset --local
supabase status
```

2. Fill in the values below in `.env`, and put the local stack's values from `supabase status` (URL, keys, DB URL) in `.env.local`. `.env.example` explains every variable.
   - Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`.
   - Use different random values for the two signing keys.
   - Never commit `.env` or any key.

```dotenv
OPENAI_API_KEY=<OPENAI_API_KEY>
GOOGLE_CLIENT_ID=<GOOGLE_OAUTH_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_OAUTH_CLIENT_SECRET>
APP_ORIGIN=http://localhost:3000
TOKEN_ENCRYPTION_KEY=<32 bytes, base64>
EVE_INTERNAL_SIGNING_KEY=<random value>
AGENT_TOKEN_SIGNING_KEY=<random value>
PHOTON_LINE_NUMBER=<the Photon line's number, such as +15550001111>
```

3. Run the web and agent services and the job worker, each in its own terminal. Both refuse to run against the shared or release Supabase project.

```bash
npm run dev       # web on :3000, agent on :2000
npm run jobs:dev  # iMessage receipts, sends and other jobs
```

4. Open [http://localhost:3000](http://localhost:3000) (Google first) or [http://localhost:3000/?flow=imessage](http://localhost:3000/?flow=imessage) (iMessage first).
   - After Google sign-in, `/app` shows the "Send Thyme one message" step. **Set up here in web chat** skips it and continues setup in the web chat.
   - Confirming setup creates a public link (`/{handle}`). Request a time through that link from another browser; the booking is made when the host approves it in `/app`.

## Live iMessage and Google (reproducing the video)

Messaging is production-only by design: a local run sends only to a local stand-in at `PHOTON_API_URL`. To reproduce the video with a real iPhone, prepare the following on the presenter's machine only. None of it is committed.

- **Receiving.**
  - Expose the agent's `/photon/webhook` (:2000) through an HTTPS tunnel, such as a Cloudflare quick tunnel.
  - Register that address as the Photon project's webhook, then set `PHOTON_WEBHOOK_ID` and `PHOTON_WEBHOOK_SECRET`.
- **Sending.** Point `PHOTON_API_URL` at a local stand-in that forwards to Photon only for the presenter's own number. That stand-in uses `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET`.
- **Google sign-in.** The OAuth redirect URI above must be registered. A phone cannot reach the local callback, so the web steps run in the Mac's browser and the iPhone is used only for Messages.

The video goes in this order:

1. Open `/?flow=imessage` on the Mac, scan the popup's QR code with the iPhone and send the message.
2. When the page shows the message as received, sign in with Google and press **Confirm and link**.
3. Reply to Thyme's greeting on the iPhone to carry on with setup.

## Checks

```bash
npm run lint
npm run typecheck
npm test                       # unit tests
npm run build
npm run test:integration       # needs the local Supabase stack
npx playwright install chromium
npm run test:e2e               # needs the local Supabase stack
supabase test db               # pgTAP, on a freshly reset database
npm run check:docs
```

Integration and browser tests use local stand-ins for OpenAI, Google, Photon and AgentMail, so they run without keys. The Testing Documentation page on the Wiki records how we tested and the results.

## Expected errors and fixes

- **`redirect_uri_mismatch`:** check that the Google OAuth client lists `http://127.0.0.1:54321/auth/v1/callback`. After changing environment variables, restart Auth with `supabase stop` and then `supabase start`.
- **`/app` is blank after sign-in, or `setup_session_unavailable`:** check that the agent (`:2000`) is running. `npm run dev` starts it.
- **The iMessage screen never shows the message as received.** Check that:
  - `npm run jobs:dev` is running;
  - the tunnel address matches the Photon webhook;
  - `PHOTON_WEBHOOK_SECRET` is correct.
- **`supabase test db` fails with a duplicate `agent_clients_pkey`:** a row left by the integration tests causes it. Run `supabase db reset --local` and try again.
- **`npm run jobs:dev` or `npm run dev` refuses to run:** `.env` points at the shared or release project. Use the local stack's values.
- **Browser errors in the E2E tests:** run `npx playwright install chromium` once.

References: [provider setup](documentations/technical_specification/03_provider_setup.md), [documentation index](documentations/README.md), [Supabase local development](https://supabase.com/docs/guides/local-development), [Photon webhooks](https://photon.codes/docs/webhooks/overview).
