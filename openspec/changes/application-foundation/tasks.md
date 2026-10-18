# Tasks

Groups 2, 3 and 4 are the plan's Phase 1 lanes and can run in parallel once group 1 is merged. Group 5 is the join. Read the [reference repository files for Phase 1](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase) before starting each group, and name the files and revisions followed in the pull request.

## 1. Skeleton (serial, first)

- [ ] 1.1 Copy `vercel/eve` `apps/templates/eve-chat-template` at `8c55ea7c132f` into the repository root (`agent/`, `apps/web/`, `vercel.ts`, `components.json`) and add `THIRD_PARTY_NOTICES.md` with source, commit and Apache-2.0 license; verify the copied tree matches the upstream listing for that commit.
- [ ] 1.2 Convert to the root npm package with the exact pins in design decision 4, including `eve` 0.80.1 and `ai` 7.0.143, and delete the pnpm files; verify `npm ci` succeeds from the committed `package-lock.json` and `npm ls eve ai next react` prints the pinned versions.
- [ ] 1.3 Build and run the unmodified template on eve 0.80.1 with a local password before any replacement; verify `eve build` and `next build apps/web` pass and a chat turn streams locally, so upgrade breakage is isolated from later work.
- [ ] 1.4 Remove Better Auth, password auth, Drizzle and Neon, Upstash, the browser-local store, sidebar, integrations menu, connections, Slack channel, memory profile, sample tool and skill, and analytics; verify `rg -i "better-auth|drizzle|neon|upstash|@vercel/connect|password-auth"` finds nothing outside `THIRD_PARTY_NOTICES.md` and the build still passes.
- [ ] 1.5 Create `lib/contracts/`, `lib/server/`, `tests/integration/`, `tests/e2e/`, `supabase/tests/` and add `build`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e` scripts; verify each script runs successfully on the skeleton.
- [ ] 1.6 Extend `.github/workflows/check.yml` with install, build, lint, typecheck and unit tests on Node.js 24; verify the workflow passes on the pull request.
- [ ] 1.7 Replace the `apps/` placeholder in agent guidance and the README checks with the real commands; verify `npm run check:docs` passes and a teammate can follow the commands on a fresh clone.

## 2. Data and identity (Lane B)

- [ ] 2.1 Write `supabase/schemas/` for a private `app` schema not exposed through the Data API, the role matrix, revoked default privileges for `anon` and `authenticated` in `app` and `public`, and row-level security on every table; verify `supabase/tests/` grant tests show `anon` and `authenticated` can neither read tables nor execute functions.
- [ ] 2.2 Generate the first migration with `supabase db schema declarative sync --name app_baseline --no-apply`, review it, and add a CI job that runs the database tests on `supabase start`; verify `supabase db reset --local` rebuilds the chain and the CI job passes.
- [ ] 2.3 Add host account, Google identity and provider grant tables, with refresh tokens encrypted by AES-256-GCM under `TOKEN_ENCRYPTION_KEY`; verify unit tests round-trip encryption, reject a wrong key, and confirm no plaintext token appears in table data or logs.
- [ ] 2.4 Configure Supabase Auth Google sign-in with the verified least Calendar scopes, PKCE, offline access, and `/auth/callback` restricted to allowlisted relative destinations; disable email sign-in locally and on the hosted project; verify integration tests for cancelled, replayed and wrong-browser callbacks, and that an email sign-in request is rejected without sending mail.
- [ ] 2.5 Record the scopes Google actually granted and store the refresh token in the callback transaction; verify a test where the Calendar scopes are unchecked still creates the account and records no Calendar grant.
- [ ] 2.6 Create exactly one active host account per Google identity and add the shared eligibility-and-readiness guard returning the next required action; verify tests for first sign-in, repeated sign-in, two concurrent callbacks for one identity, a suspended account rejected without data change, and an unready host having no public profile (AC-26 first half).
- [ ] 2.7 Register local, sandbox and release callbacks in the Google OAuth client and Supabase Auth allowlist, and document the exact values in provider setup; verify `npm run check:docs` passes and sign-in completes on a sandbox.

## 3. Platform mechanics (Lane C)

- [ ] 3.1 Implement the command pipeline with verified actor derivation, expected revision, retry identity bound to actor, operation, resource and normalized input, and audience-safe error categories; verify tests for identical retry, conflicting retry key, a supplied foreign actor rejected, and errors that omit secrets.
- [ ] 3.2 Add the jobs table and claim function with `FOR UPDATE SKIP LOCKED`, lease deadline and fencing token, atomic publication with domain changes, redelivery-safe completion and visible exhaustion; verify tests for rollback publishing nothing, duplicate completion as a no-op, an expired owner reclaimed with a higher fence, and an exhausted job left visible.
- [ ] 3.3 Add the internal worker route authenticated by the shared secret, the `pg_net` wake-up trigger, the every-minute `pg_cron` sweep and `npm run jobs:dev` for local polling; verify tests for a public caller denied without claiming, a lost wake-up processed by the sweep, and process death mid-job recovered.
- [ ] 3.4 Fence the worker to production: preview, development and contradictory deployment metadata refuse before touching job state; verify tests for each environment case.
- [ ] 3.5 Implement the model execution guard: 128 KiB input cap, text and function tools only, 4,096 and 2,048 output caps, 30-second stall deadline, provider storage off and standard tier, USD 0.60 reservation per attempt, eight attempts per input, USD 30 per principal and USD 300 service-wide 24-hour windows; verify tests for oversized input, a stalled stream, a restart after reservation, concurrent capacity exhaustion, and a saved ranking read charging nothing.
- [ ] 3.6 Implement the messaging-environment denial for every transport; verify tests that preview and contradictory metadata reject before any network call and leave delivery state untouched.

## 4. Web and runtime (Lane A)

- [ ] 4.1 Configure `agent/agent.ts` with `openai("gpt-5.6-terra")`, `providerOptions.openai` storage off and standard tier, `modelContextWindowTokens: 32_000` and `limits.maxTokenCostUsdPerSession: 30`; confirm the model ID and price against the team's key; verify one live turn on a sandbox and record the confirmed price in the design.
- [ ] 4.2 Write `agent/instructions/base.md` and `host-setup.md` with the invariants from agent configuration, and register no tools; verify `eve info` lists no tools for the setup audience.
- [ ] 4.3 Put the application `AuthFn` first in `channels/eve.ts`, keep `localDev()` only in local development, disable uploads, and fail closed on deployments; verify tests that a raw `/eve/v1` request without application auth, a foreign session ID and a revoked grant are each denied with no model work.
- [ ] 4.4 Add the application index from discussion to eve session (session ID, last stream index, agent version, state) and the session-owner hook; verify tests that one host cannot read, stream or continue another host's session.
- [ ] 4.5 Keep stored stream events and cursors for reconnect, and add explicit terminal recovery that creates at most one successor; verify tests for reconnect with an old cursor, concurrent recovery, uncertain runtime state refused, and a retired generation denied.
- [ ] 4.6 Build the `/app` shell: centered conversation, reachable composer, compact keyboard-operable menu with sign-out, no sidebar; verify Playwright at 320, 390 and 1280 pixels, keyboard-only menu use with Escape returning focus, and 200% zoom without horizontal scroll.
- [ ] 4.7 Apply the Thyme tokens, Merriweather and Geist, and the paper layer per DESIGN.md, mapped onto shadcn variables; verify contrast of the documented pairs, texture omitted in print and forced colors, and reduced motion respected.

## 5. Join and release

- [ ] 5.1 Wire sign-in to the host account, the eligibility guard, the session index and the command pipeline so a new host lands on `/app` with an authorized empty setup session; verify a Playwright journey from sign-in to the first Thyme reply on a sandbox.
- [ ] 5.2 Link the Vercel project, set Production and Preview variables separately, set the function region to `cle1`, and attach `release.findmeatime.com` following domain guidance; verify `vercel domains inspect`, a DNS lookup and an HTTPS request reaching `/app`.
- [ ] 5.3 Add the CI job that pushes migrations to the shared project on merge after a printed dry run; verify the first merge applies the baseline and `supabase db diff --linked` is empty afterwards.
- [ ] 5.4 Run the Phase 1 evidence set: two-host isolation, unauthorized raw runtime routes, cancelled and replayed sign-in, reconnect versus terminal recovery, model limit exhaustion, preview messaging and worker denial, and AC-26's first half; verify each result is recorded with command, date, revision and environment in the acceptance record.
- [ ] 5.5 Update frontend architecture with the pinned versions actually installed, tick Phase 1 in the implementation plan, and regenerate the Korean mirrors of changed English documents; verify `npm run check` passes.
