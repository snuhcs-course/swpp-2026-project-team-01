---
name: browser-qa
description: Run a full local QA pass of Find Me a Time on the latest origin/main — the migration chain, pgTAP, Vitest integration and Playwright suites, then a hands-on pass of the testing-baseline flows (host, guest, cancel and change) in a real browser against local stand-ins — and write a dated report with drafted bug issues. Use when asked to "QA 돌려줘", "브라우저로 전체 테스트", "run the full QA pass", "check main after these merges", or before and after a batch of merges.
---

# Browser QA pass

A repeatable QA pass that a local Claude Code or Codex session runs on its own: the automated suites first, then the [testing baseline](../../../documentations/technical_specification/12_testing_baseline.md) walked by hand in a real browser, then a report. CI no longer runs the database job (#385), so this is the safety net before and after merges.

It changes nothing on GitHub, Vercel or any hosted Supabase project. It resets the **local** database. It opens issues only after the user confirms each one.

## Ground rules

- **Localhost only.** Every page you open is `http://localhost:<port>` or `http://127.0.0.1:<port>`. Never open findmeatime.com, a preview deployment, Supabase Studio of a hosted project, or a real Google, Telegram, Photon or AgentMail page. If a click would leave localhost (Continue with Google on the host landing, an Open iMessage link, a Join meeting link), do not follow it; record the row as not covered.
- **Test data only.** Use the accounts the QA control page creates (`qa-host-…@example.test`), guest names and addresses on `example.test`, and values from the repository's tests and fixtures. Never type a real person's name, address, phone number or password.
- **No env files, no keys.** Run in a fresh worktree that has no `.env`, `.env.local` or other env file. `npm run qa:stack` refuses to start otherwise, because `eve dev` would load real provider keys from them. Never copy env files into the QA worktree and never print a secret.
- **The shared and release projects are off limits.** Everything here talks to the local stack (`127.0.0.1:54321`/`54322`); `npm run qa:stack` and the Playwright config refuse anything else, as `npm run dev` and `jobs:dev` refuse `anelszynxtvxoxqvzgqt` and `mriseqztcwmezvtawnbo`.
- **No paid model calls** unless the user explicitly says so in this conversation and an `OPENAI_API_KEY` is exported in the shell. Never set `E2E_LIVE_MODEL`.
- **Say only what you saw.** A scenario is **passed** only if you watched every expected result of it happen in this run. Otherwise it is **failed** (you saw a different result), **blocked** (setup or the harness stopped you), or **not run** / **not covered** (with the reason).
- Run anything longer than about two minutes in the background and wait for it to finish; do not poll in a tight loop.

## What this pass cannot cover

List these in every report as not covered:

- **Real devices and messengers.** iMessage, WhatsApp and Telegram linking and conversations (H01 W-A4–W-A7, W-B*, every `Message ·` table, A01 messenger rows, R01), and anything on a phone other than a 375 px browser viewport. The local Photon and Telegram stand-ins only receive outbound sends; nothing can play a person replying from a phone.
- **Real Google.** Host Continue with Google (H01 W-A2) goes through Supabase Auth to accounts.google.com; the QA control page signs hosts in through the same local Auth flow with only Google's leg simulated. Calendar reads and writes go to the fake Google with fixed fixtures.
- **AgentMail.** There is no AgentMail stand-in, so email replies in a thread (`email_reply` jobs) and inbound email (G02/G03/M01 `Email ·` rows that need a reply) stay pending. Outbound notices through Cloudflare Email are covered and readable on the control page.
- **AI judgment.** With the model stand-in, Thyme answers every message with "Hello from Thyme." Rows whose verdict is **AI judgment** or that say *Expected AI behavior* need the real model (paid, explicit approval) or the eval suites in `evals/`; mark them not covered otherwise.
- **MCP and the CLI** (`MCP ·` tables) are not driven in a browser here; the integration suites cover their contracts.
- **Rows marked not supported** in the baseline are expected to fail until built (#255); record them as such, never as a new defect.

## Arguments (optional, free text)

- `suites-only`: steps 1–3 and the report; skip the hands-on pass.
- `hands-on-only`: skip the automated suites (step 3).
- `pr <N>`: check that pull request's head instead of `origin/main`.
- `quick`: in step 3, skip Playwright (the hands-on pass still runs).

## 1. Prerequisites

Stop and report if any of these fail:

```sh
node --version                         # v24.x
docker info --format '{{.ServerVersion}}'
npx --yes supabase@2.119.0 --version   # the pinned CLI; the one on PATH may be another major
npx playwright --version
df -h ~ | tail -1                      # at least 10 GB free
```

Install Chromium once if it is missing: `npx playwright install chromium`.

Check who else is using the machine: other worktrees share one local Supabase stack (project `swpp-2026-project-team-01`), and step 2 resets it.

```sh
ps -axo pid,command | grep -E 'vitest|playwright|eve dev|next dev|jobs-dev' | grep -v grep
```

If another session is running tests or dev servers against the stack, ask the user before resetting it.

## 2. Fresh worktree and local stack

From any checkout of the repository:

```sh
git fetch -q origin
REPO=$(git rev-parse --show-toplevel)
QA=$(dirname "$REPO")/swpp-qa-$(date +%Y%m%d-%H%M)
git worktree add --detach "$QA" origin/main     # for pr <N>: then `cd "$QA" && gh pr checkout <N> --detach`
cd "$QA" && git rev-parse --short HEAD          # record it for the report
npm ci --prefer-offline
```

Work only inside `$QA` from here on. Then the stack:

```sh
export SUPABASE_AUTH_SITE_URL=http://localhost:3000
export SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS=http://localhost:3000/auth/callback
export GOOGLE_CLIENT_ID=ci-placeholder.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=ci-placeholder
npx --yes supabase@2.119.0 start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor   # no-op if it is already running
npx --yes supabase@2.119.0 db reset --local
```

The reset rebuilds the whole migration chain and deletes local data; say so in the report. A failure here is a broken migration: report it first, because merging to `main` pushes migrations to the shared project.

## 3. Automated suites

Run each in the background, one after another (they share the local stack and `apps/web/.next`):

1. pgTAP: `npx --yes supabase@2.119.0 test db`
2. Integration: `npm run test:integration` (about 6 minutes)
3. Browser: `CI=1 npm run test:e2e` (about 8 minutes; skip with `quick`).
   - Always set `CI=1`: without it Playwright reuses whatever already listens on its web port, which may be another app.
   - Its services use ports 3100–3106. Check them first with `lsof -nP -iTCP:3100-3106 -sTCP:LISTEN`. If only 3100 is taken, run with `PORT=<a free port>` and say so in the report. If 3101–3106 are taken, name the process and stop; never kill another program.

**Flakes.** With `CI=1`, Playwright already retries a failed test twice and lists one that passed on a retry as **flaky**; report those as flakes. For each test that still failed, and for each failing integration file, rerun it once on one worker: `CI=1 npx playwright test tests/e2e/<file>.test.ts:<line> --workers=1 --retries=0` or `npx vitest run --project integration tests/integration/<file>.test.ts`. Passing on the rerun makes it a **flake** (report both outcomes); failing again makes it a **failure**. A rerun of one file starts cold: the first visit to `/app` compiles under `next dev` and can outlast a 5-second expectation ("Loading your workspace…" in the error context). If that is the only failure, run it once more before calling it real. For each failure, record the file and test name, the first assertion line, and the latest commit on `main` that touched the file (`git log -1 --format='%h %s' origin/main -- <file>`).

The user-level `local-db-check` skill, where a teammate has it, runs the same three suites; use it instead if the user asks for it.

## 4. Hands-on pass in a real browser

### Start the QA stack

```sh
npm run qa:stack    # in the background; add `-- --base-port 3300` to start elsewhere
```

Wait for the line starting `QA_STACK {…}` in its output (about a minute the first time); the same JSON is in `output/browser-qa/stack.json`. It names:

- `web`: the app (default `http://localhost:3200`), configured exactly as the browser tests configure it.
- `control`: the QA control page (default `http://localhost:3207`).
- The stand-ins for OpenAI, Google, Cloudflare Email, Google Routes and Photon, and the job worker (`jobs:dev`), which runs evaluations, emails, bookings and cancellations by itself about every 5 seconds.

If a port in the block is taken, it moves to the next free block of eight and prints which; use the URLs it prints.

**Do not restart the QA stack in the middle of a scenario.** The stand-ins keep their state (the fake Google's calendars for each host, the emails sent) in memory. After a restart, an existing host's booking fails Calendar revalidation; start that scenario again with a new host.

### The control page

Open `control` in the browser. It is a test harness on its own port, not part of the app:

- **New host, setup not started**: signs a new test host in through the real local Auth flow (only Google's leg is simulated) and opens `/app`, where setup starts with the messaging link step (H01 W-A3).
- **New host, set up and ready**: the same, plus a confirmed setup, a handle and a Calendar grant against the fake Google; opens the dashboard (H02–H04 and the host side of G01–M01).
- **QA test hosts**: every test host on the stack with its booking link and **Sign in as this host**.
- **Sign out**: removes the Supabase session cookies on `localhost`.
- **Guest draft**: `/guest/draft?booking=<booking page URL>&purpose=…&mode=online` records the details draft the model would have written. Use it after the guest answers the fixed question, then reload the booking page to see "Apply these details?". Only with the model stand-in.
- **Emails**: what the Cloudflare stand-in received (`?to=` filters), for booking links, confirmations and notices.

Cookies on `localhost` are shared across ports and tabs. To act as the guest while the host is signed in, either use a second browser profile or an incognito window, or press **Sign out** first and **Sign in as this host** to return.

### Browser tools

Use whichever browser tool this agent has. The steps are the same; only the mechanics differ:

- **Claude desktop built-in browser** (`Claude_Browser` tools): open the control page with `preview_start` and a `url`; prefer `find`/`read_page`/`get_page_text` over screenshots; `resize_window` with `preset: "mobile"` and `colorScheme: "dark"` for the phone and dark checks (reset to `desktop` after). Keep the browser pane **visible**: while it is hidden the page runs as a throttled background tab and React effects stall, so `/app` can sit on "Loading your workspace…" for a long time. If the pane is hidden, ask the user to show it, or wait inside the page (a `javascript_tool` call that awaits a few seconds) before judging.
- **Claude in Chrome** (`claude-in-chrome` tools): open a new tab in its own tab group; the same find/read/click flow. Use an incognito window, or Sign out on the control page, for the guest.
- **Playwright MCP** or a Playwright script: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`; a new browser context is a clean second profile for the guest; `browser_resize` 375×812 and `colorScheme: 'dark'` for the checks.
- **Codex computer use** (or any screen-driving tool): drive a normal browser window; use a private window for the guest; read the screen rather than guessing coordinates.

Take a screenshot at each scenario's last step and at every failure. Save them under `output/browser-qa/<YYYY-MM-DD>/screens/<scenario>-<step>.png` (copy the file your tool wrote, or save the image there). Screenshots show only test data; still never attach one to an issue if it shows anything that is not.

**Timing under `next dev`.** The first visit to each route compiles it; cards also stream in after the fixed messages. Wait up to 30 seconds and try once more in a fresh tab before you call something missing.

### Scenarios

Walk them in this order. For each row, compare what you see with the `Then` column of the baseline table it names, quote the screen text you saw in the report, and mark the result.

**H01 · Host sign-up and onboarding (Web · start with Google).** New host, setup not started. Check W-A3: the link step "Connect a messaging app" with iMessage and Telegram, WhatsApp hidden. W-A4: press iMessage, enter a malformed number and check the error, then the browser tests' sample number `10-1234-5678` and check the send screen with a code appears (the Photon stand-in accepts the registration; nothing is sent). W-A5–W-A7 need a real iPhone: not covered. "Set up here in web chat" is offered only because the QA stack runs the browser tests' build (`NEXT_PUBLIC_E2E_TEST=1`); in production it is hidden (W-A3 **never**), so do not report it.

**H02 · Host booking settings (Web · settings dialog).** Ready host. W-1–W-5: open the gear, edit hours, a weekly limit out of range (expect "Enter 1–50 meetings per week…"), save, review and confirm ("Your public schedule is updated."), then turn Accept new meeting requests off and check W-5.1 by opening the booking link (neutral not-found page), and back on.

**G01 · Guest request and time selection (Web · start from the booking link).** As the guest (signed out, or a second profile), open the host's booking link from the control page:

1. W-1: the landing names the host; Continue with web and Start with agent.
2. W-2, W-3.1: Continue with web → the two fixed messages and the identity card → Continue without Google → an empty or invalid email shows "Enter your name and a valid email address."; then `Grace Hopper` and a fresh `qa-guest-<n>@example.test` → `/booking/<id>`. The control page's Emails list shows the booking-link email.
3. W-4, W-5: the Calendar step (Skipped), then the fixed question with the host's meeting length and modes.
4. W-6, W-7: type a purpose such as "Talk about compilers, online."; with the stand-in Thyme answers "Hello from Thyme." (the AI rows are not covered). Record the draft on the control page with the booking page URL, reload the booking page, check "Apply these details?" and press Apply these details; "Checking both calendars…" and then, within about 15 seconds, W-8: "I found some available times…" with candidate times, Find other times and Edit details.
5. W-9, W-10: Choose this time → "Agree to this time?" → Agree to this proposal → "Request sent successfully", then the waiting card "Waiting for … to approve".

**H03 · Host review and decision (Web · request review).** Sign in as the host. The menu shows "1 request needs your decision"; Requests → the request → "Approve this meeting?" → Approve this proposal → "Booking in progress" → (the job worker books it) **Booked** with Join meeting and Open in Google Calendar. Also try Decline on a second request when the baseline lists it.

**G03 · Guest status and result (Web · booking page).** As the guest, reload the booking page: "Your meeting is booked", the details and Join meeting. The Emails list shows the booked email.

**H04 · Host schedule (Web · dashboard).** As the host: the week view shows the booked meeting on its day; the Requests list shows Booked.

**M01 · Cancel or reschedule (Web · host, Web · guest).** As the host: Cancel meeting → Confirm cancellation → "Cancelled — You cancelled this meeting. The requester was told…". Repeat the booking with a new request to try the guest's own cancel and change rows from the baseline's `Web · guest` table.

**G02 · Guest change or withdrawal before booking (Web · booking page).** On a new request before the host approves: Edit details, change the time, and withdraw, as the table lists.

**A01 · Account and connections (Web · host, Web · guest).** As the host: the settings dialog's Delete account link and its confirmation; unlinking a channel is not covered (no linked channel locally). Do the deletion last, on a throwaway host.

**Failure, branch and off-path sheet.** The QA sheet of #252 lists every fail, branch and off-path (↳) row with its precondition and steps. If it exists on `main` when you run this (search `documentations/` for it, or check #252), walk its `Web` rows the same way and record each case's result against its ID. If it does not exist yet, walk the `Web ·` tables' ↳ rows and **fail** branches of the baseline directly and say the sheet was not available.

**Phone width and dark mode.** For the landing (`/`), a booking link (`/<handle>`), a booking page (`/booking/<id>`) and `/app` (dashboard and Requests): at 375 × 812, no horizontal scroll (`document.documentElement.scrollWidth` equals the viewport width), nothing cut off, the primary button reachable. With `prefers-color-scheme: dark`, the pages keep their light palette and stay legible: DESIGN.md says there is no dark theme, so a half-inverted or unreadable page is a failure, and a light page is a pass.

### Stop the QA stack

Stop the `npm run qa:stack` process you started (Ctrl-C, or `kill -TERM` its PID); it stops every service it started. Check with `lsof -nP -iTCP:<first>-<last> -sTCP:LISTEN` that nothing still listens on its block. Leave the Supabase stack running unless the user asked you to stop it.

## 5. Report

Write `output/browser-qa/<YYYY-MM-DD>/report.md` in the QA worktree (`output/` is ignored by Git). Keep it in this shape:

```markdown
# QA pass — <date>

Commit: origin/main @ <sha> (or PR #N @ <sha>) · Machine: <host> · Agent: <Claude Code | Codex> with <browser tool> · Total time: <h:mm>
Local database reset: yes (local data was deleted)

## Automated suites
| Suite | Result | Notes |
|---|---|---|
| Migration chain (db reset) | pass | |
| pgTAP | pass | |
| Integration | 1 failed, 1 flake | tests/integration/x.test.ts › "name": `expected … received …` (last change abc1234 …) |
| Playwright | pass | PORT=3110 because 3100 was taken |

## Hands-on scenarios
| ID | Scenario | Result | Evidence | Reproduction |
|---|---|---|---|---|
| G01 W-1–W-10 | Guest from booking link to agreement | passed | screens/g01-w10.png | — |
| H03 W-… | Host approves | failed | screens/h03-approve.png | 1. … 2. … Expected "Booked", saw "…" |

## Not covered
<the list from "What this pass cannot cover", plus anything skipped in this run and why>

## Drafted issues
<one per real failure, or "None">
```

For every **failed** row, draft a bug issue with the fields of [`.github/ISSUE_TEMPLATE/bug.yml`](../../../.github/ISSUE_TEMPLATE/bug.yml): What happened, Expected behavior (with the baseline row ID and a link to the table), Steps to reproduce (starting from `npm run qa:stack` and the control page), Surface, Environment **Local development (personal sandbox)**, Commit, and Logs or screenshots (text only, never a secret). Before drafting, search for a duplicate: `gh issue list --state all --search "<words>"`. Put the drafts in the report and show them to the user.

**Create issues only after the user confirms each one**, then use `gh issue create --label bug --title … --body-file …`. Do not comment on pull requests, push, or change labels unless asked.

Tell the user in a few lines: the commit checked, each suite's result, the scenarios passed/failed/not covered, the drafted issues, and the report's path.

## 6. Clean up

- The QA stack and any Playwright run are stopped (step 4).
- The Supabase stack is left running.
- Remove the QA worktree when the user no longer needs its report: `git worktree remove "$QA"` (keep the report somewhere else first if they want it).
