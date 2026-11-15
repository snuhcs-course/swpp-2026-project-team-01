# Find Me a Time — Iteration 3

**Thyme** is an AI scheduling agent for external one-to-one meetings. A host signs in with Google and sets up their meeting rules with Thyme, on the web or in a linked messenger. Requesters ask for a time through a public link, by email or from a messenger, with no account. A booking is made only when the host approves the current proposal.

## Contents

- [Demo video](#demo-video)
- [Frozen revision](#frozen-revision)
- [What this demo demonstrates](#what-this-demo-demonstrates)
- [Major progress in Iteration 3](#major-progress-in-iteration-3)
- [Tech stack](#tech-stack)
- [Deployed service](#deployed-service)
- [Prerequisites](#prerequisites)
- [Running locally](#running-locally)
- [Linked messengers](#linked-messengers)
- [Checks and evaluations](#checks-and-evaluations)
- [Expected errors and fixes](#expected-errors-and-fixes)

## Demo video

[Watch the Iteration 3 demo on YouTube](https://www.youtube.com/watch?v=mKhDZxLGpRU) (narrated).

## Frozen revision

This branch is `main` at [`57bcf883`](https://github.com/snuhcs-course/swpp-2026-project-team-01/commit/57bcf883) (#140, merged 2026-11-06 13:53 KST), the last commit on `main` before the Iteration 3 deadline (2026-11-06 23:59 KST). The only change on top of it is this README and the AI usage record that the commit hook adds. Work merged after the deadline, starting with #175 on 2026-11-13, is not included.

## What this demo demonstrates

The video follows one meeting from the host's setup to a confirmed booking.

**Host: setup**

1. The host starts with their Google account.
2. After the host chooses calendars, Thyme reads them and suggests scheduling settings. Note-like entries are excluded from busy time.
3. The host names the booking page and chooses its address. The shareable booking page is then ready.
4. Everyday scheduling can happen in iMessage. Sending one code message finishes the link, and from then on the host schedules in iMessage.

**Guest: request**

5. The guest needs no sign-in: they open the host's booking link and leave a name and email.
6. The guest describes the meeting they want in their own words. Thyme organizes the details and asks the guest to confirm them.
7. Thyme shows only times that fit the host's calendar and rules. The guest picks one and sends it to the host for approval.

**Host: decision**

8. The host approves the request in natural language in iMessage.
9. Once the booking is confirmed, the guest is notified as well.

This revision also includes features the video does not show: WhatsApp and Telegram as host channels, requests by email, timetable image setup (OCR), travel-time checks for in-person meetings, decisions with messenger buttons or on the web, and personal AI agents over MCP and the `fmat` CLI.

## Major progress in Iteration 3

From the end of Iteration 2 (`873804b3`, 2026-10-23) to the frozen revision, 55 pull requests were merged into `main`.

| Area | Pull requests | What changed |
|---|---|---|
| Operations and release | #36, #57, #65, #77 | Diagnostics, recovery, retention and deletion, `/privacy-policy` and `/terms-of-service` for Google verification |
| iMessage | #39, #85, #92, #93, #100, #123, #124, #128 | Link screens and setup in iMessage, phone-number registration, read marks and typing, approval and request switching in the host's words |
| WhatsApp | #79, #126, #136, #139 | Host WhatsApp channel for Android hosts, decision buttons, guest updates |
| Telegram | #113, #127, #130 | Telegram bot channel, linking from the card and `/?flow=telegram`, decision buttons |
| Decisions in words | #156, #157 | Hosts approve, decline and share changes in their own words in every linked chat and through their agents |
| Guest booking flow | #75, #98, #99 | A complete conversational booking flow; the host no longer reads the requester's conversation; agreement rechecks the calendar |
| Scheduling | #78, #106, #121, #70 | Weekly limit counts our bookings, far in-person meetings grouped by day, timetable image OCR, dashboard |
| Design | #42, #89, #105, #109, #120, #132 | One serif-spread design system for every screen, chat input and card refinements |
| AI evaluation | #87, #140 | Frozen evaluation sets for guest defense (25 cases) and host approval in words (17 cases), with pre-declared criteria |

The [Testing Documentation](https://github.com/snuhcs-course/swpp-2026-project-team-01/wiki/Testing-Documentation) records the test and evaluation results.

## Tech stack

| Area | Technology |
|---|---|
| Web UI / server API | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Agent | eve (Vercel), OpenAI `gpt-5.6-terra` with reasoning `medium` |
| Database / sign-in | Supabase Postgres and Auth, postgres.js, pg-delta declarative schema |
| Calendar and travel | Google OAuth 2.0, Google Calendar API, Google Routes API |
| Messengers | Photon Spectrum (iMessage, WhatsApp), Telegram Bot API |
| Email | AgentMail (inbound), Cloudflare Email Service (outbound) |
| Tests | Vitest, Playwright, pgTAP, eve evals |
| Web hosting | Vercel |

## Deployed service

The production deployment is at [https://findmeatime.com](https://findmeatime.com). It is updated after this branch was frozen, so it may differ from this revision.

## Prerequisites

- Node.js 24 and npm.
- Docker Desktop and Supabase CLI **2.119.0** (check with `supabase --version`).
- An OpenAI API key for the agent's conversation. It costs money.
- A Google OAuth **Web application** client in a Google Cloud project with the Calendar API enabled. Register `http://127.0.0.1:54321/auth/v1/callback` for host sign-in and `http://localhost:3000/connections/google/callback` for requester consent. If the consent screen is in Testing, add the accounts you will use as test users.
- The host Calendar scopes in [`lib/contracts/google-scopes.ts`](lib/contracts/google-scopes.ts): `calendar.calendarlist.readonly` and `calendar.events` (each prefixed with `https://www.googleapis.com/auth/`). Requester consent also uses `calendar.events.readonly`.

```bash
git clone --branch iteration-3-demo https://github.com/snuhcs-course/swpp-2026-project-team-01.git
cd swpp-2026-project-team-01
npm ci
cp .env.example .env
```

## Running locally

1. Fill `.env` **before** starting Supabase: its Google provider reads `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` at startup. Keep the local Auth URLs from `.env.example`. Never commit `.env` or any key.

```dotenv
OPENAI_API_KEY=<OPENAI_API_KEY>
GOOGLE_CLIENT_ID=<GOOGLE_OAUTH_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_OAUTH_CLIENT_SECRET>
APP_ORIGIN=http://localhost:3000
TOKEN_ENCRYPTION_KEY=<32 bytes, base64>
EVE_INTERNAL_SIGNING_KEY=<at least 32 characters>
AGENT_TOKEN_SIGNING_KEY=<base64 PKCS#8 Ed25519 private key>
```

Generate the keys separately and copy each output to its matching variable. `AGENT_TOKEN_SIGNING_KEY` is needed only for personal-agent access.

```bash
openssl rand -base64 32                         # TOKEN_ENCRYPTION_KEY
openssl rand -base64 48                         # EVE_INTERNAL_SIGNING_KEY
openssl genpkey -algorithm ed25519 -outform DER | openssl base64 -A  # AGENT_TOKEN_SIGNING_KEY
```

2. Start Docker and the local Supabase stack. `db reset --local` deletes existing local data.

```bash
supabase start
supabase db reset --local
supabase status
```

Put the local stack's values from `supabase status` in `.env.local`:

```dotenv
SUPABASE_PROJECT_REF=
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=<local publishable key>
SUPABASE_SECRET_KEY=<local secret key>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

3. Run the web and agent services and the job worker, each in its own terminal. Both refuse to run against the shared or release Supabase project.

```bash
npm run dev       # web on :3000, agent on :2000
npm run jobs:dev  # messenger receipts, sends, bookings and other jobs
```

4. Open [http://localhost:3000](http://localhost:3000).
   - Sign in with Google and finish setup in the web chat. Confirming setup creates a public link (`/{handle}`).
   - Request a time through that link from another browser, agree to a proposal, and approve it as the host in `/app`. The booking then appears in the host's Google Calendar.

## Linked messengers

Messaging is production-only by design: a local run sends only to local stand-ins (`PHOTON_API_URL`, `TELEGRAM_API_URL`), so a fresh clone shows the messenger screens but does not deliver real messages. The web path above and the automated tests do not need any messenger.

- `/?flow=imessage`, `/?flow=whatsapp` and `/?flow=telegram` start a host from that messenger.
- Real delivery needs, on the presenter's machine only: an HTTPS tunnel to the agent (`:2000`), the Photon project and webhook values (`PHOTON_*`) for iMessage and WhatsApp, and the bot token and webhook secret (`TELEGRAM_*`, registered with `npm run telegram:webhook`) for Telegram. See [provider setup](documentations/technical_specification/03_provider_setup.md).

## Checks and evaluations

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

Integration and browser tests use local stand-ins for OpenAI, Google, Photon, Telegram and email, so they run without keys.

The frozen AI evaluations call the real model (Git Bash, local Supabase running, `OPENAI_API_KEY` set):

```bash
FMAT_EVAL_AUDIENCE=requester npx eve eval requester/defense   # guest defense, 25 cases
FMAT_EVAL_AUDIENCE=host_review npx eve eval host-review      # host approval, 17 cases
```

Their sets, criteria and results are in [guest defense evaluation](documentations/technical_specification/10_guest_defense_evaluation.md) and [host approval evaluation](documentations/technical_specification/11_host_approval_evaluation.md).

## Expected errors and fixes

- **`redirect_uri_mismatch`:** check that the Google OAuth client lists `http://127.0.0.1:54321/auth/v1/callback`. After changing environment variables, restart Auth with `supabase stop` and then `supabase start`.
- **`/app` is blank after sign-in, or `setup_session_unavailable`:** check that the agent (`:2000`) is running. `npm run dev` starts it.
- **`TELEGRAM_API_URL` holds stray text:** in `.env.example` of this revision, the line `TELEGRAM_API_URL=` is followed by the start of the next comment on the same line. Leave the value empty in your `.env`.
- **`supabase test db` fails with a duplicate `agent_clients_pkey`:** a row left by the integration tests causes it. Run `supabase db reset --local` and try again.
- **`npm run jobs:dev` or `npm run dev` refuses to run:** `.env` points at the shared or release project. Use the local stack's values.
- **Browser errors in the E2E tests:** run `npx playwright install chromium` once.

References: [documentation index](documentations/README.md), [provider setup](documentations/technical_specification/03_provider_setup.md), [Supabase local development](https://supabase.com/docs/guides/local-development).
