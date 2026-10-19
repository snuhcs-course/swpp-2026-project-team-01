# Tasks

Group 1 records the decisions and group 2 lays the schema; both are serial. Groups 3, 4 and 5 are the plan's Phase 2 lanes and can run in parallel against the merged schema. Group 6 is the join and group 7 the release.

Before each group, read the [Phase 2 reference repository files](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase) and name the files and revisions followed in the pull request. The proposal's [coverage table](proposal.md#modified-capabilities) lists which scenarios this change closes and which stay deferred.

## 1. Decisions (serial, first)

- [x] 1.1 Record the Phase 2 decisions (sign-up and handle-change limits, reserved handles, starter defaults, travel modes, retention confirmation, administrator CLI packaging and authentication) in PRD section 10, the host onboarding flow's open decisions and the CLI direction, matching the [design](design.md); verify `npm run check` passes with `openspec validate --all --strict`.

## 2. Schema (serial)

- [ ] 2.1 Add `setup_drafts`, `calendar_roles`, `calendar_analyses`, `host_settings`, `host_handles`, `signup_attempts` and `operator_actions`, plus `host_accounts.display_name` and `provider_grants.invalidated_at`, to `supabase/schemas/app/`, with row-level security on each. Add `app.cleanup_calendar_analyses` and `app.operator_set_host_status` with execution revoked from `PUBLIC`. Generate the migration with `supabase db schema declarative sync --no-apply`, and put the 15-minute cleanup schedule in its own `supabase migration new` migration mirrored under `supabase/schemas/app/cron/`. Verify `supabase db reset --local` rebuilds the chain and `supabase/tests/` shows `anon` and `authenticated` reach no new table or function.

## 3. Setup conversation and cards (Lane A)

- [ ] 3.1 Add `read_setup_state` and `draft_settings` as `defineDynamic` tools that resolve only for the `host_setup` audience, the `host-setup.md` fragment resolved the same way, the `audience` attribute in `appAuth`, the generation and eligibility fence in each tool, and `draft_settings` through `runCommand` with retry key `tool:{callId}`. Reveal the authored onboarding messages one at a time. Verify `eve info` lists both tools, plus tests for:
  - replay after commit returning the saved result without a second write;
  - a retired generation and a suspended host denied before any read;
  - a value drafted with `source: stated` only when the host stated it;
  - the authored messages appearing at once on a revisit and under reduced motion.
- [ ] 3.2 Build the suggestion cards for timezone, weekly windows (overnight windows shown as next day, equal clocks rejected), weekly meeting limit, note-like exclusions, duration and buffers, each labeled stated, inferred or starter default with its sample size and **Use this**, **Adjust** and **Choose my own**. Back them with `GET /api/setup/state` and `POST /api/setup/commands` (`setup.update_draft`). Verify unit tests for suggestion precedence and the small-sample fallback, integration tests for a stale revision and an exact retry, and Playwright keyboard use at 390 and 1280 pixels.
- [ ] 3.3 Build the mode, location and transport question cards: **Online**, **In person**, **Either**; areas, venue, **Enter a place**, **Decide per meeting**; **Driving**, **Public transit**, **Walking**, **Depends on the trip**; the extra travel buffer. Online-only skips location and transport. Verify that an unaccepted suggestion does not satisfy the requirement and that an online-only host confirms without transport.
- [ ] 3.4 Build the final review card and `setup.confirm_settings` with the transactional readiness recheck; make the shared guard derive readiness; build the share-links card. Verify integration tests for:
  - a stale review;
  - a destination that became read-only;
  - a handle collision;
  - a suspended account;
  - success making `readHostStanding` ready and the links resolve.

## 4. Google Calendar and analysis (Lane B)

- [ ] 4.1 Add the Google Calendar client built from the stored grant, with refresh, timeouts and `invalid_grant` marking the grant invalid; the calendar roles card with account and access labels and reasons; `setup.save_calendar_roles` with the writable check; **Connect Google Calendar** through `/auth/sign-in?consent=calendar`; **Manage Google connection**. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` runtime guidance to `.env.example`. Verify tests against a fake Google server for a read-only destination, duplicate calendar names, declined scopes, a revoked grant and the consent parameters on the sign-in redirect.
- [ ] 4.2 Add the `calendar_analysis` job: published with saved roles, reading the past and next four weeks, computing the four dimensions with sample sizes under the F02 rules, with `setup.analyze_again` and `setup.set_up_manually` and the analysis card. Verify unit tests over fixture events for each dimension and the place-plus-link rule, and integration tests for a partial failure, a revoked grant, a reload not rescanning and an exact retry of **Analyze again**.
- [ ] 4.3 Schedule `app.cleanup_calendar_analyses` every 15 minutes in batches of 500. Verify database or integration tests that expired rows go within bounded passes, recent rows stay, locked rows are skipped for a later pass, adopted draft and settings values are unchanged, and a Data API role cannot call it.

## 5. Identity, entry documents and operator control (Lane C)

- [ ] 5.1 Add handle validation (format, reserved list, uniqueness across released handles, the change limit) and the sign-up bounds per source and service-wide in the sign-in callback, with the temporary-limit message on `/app`. Verify unit tests for the format and reserved list, and integration tests for the source and service bounds, an existing identity at the bound, a collision and a change past the limit.
- [ ] 5.2 Add `/SKILL.md`, `/[handle]/SKILL.md`, `/llms.txt`, the landing page and the public host page with their agent sections and `<link rel="alternate" type="text/markdown">`, and Markdown negotiation in the proxy with `Vary: Accept`. Verify integration or browser tests for:
  - no cookies and `no-store`;
  - the neutral 404 for unknown, unready and suspended hosts, and the 503 on a database failure;
  - a display name containing Markdown and control characters;
  - `Accept: text/markdown` on `/` and `/{handle}`;
  - reserved routes not resolving as handles.
- [ ] 5.3 Add `scripts/admin.ts` (`npm run admin`) with `show`, `suspend` and `restore`, `--local` and `--project`, confirmation and the audit row. Verify integration tests against the local stack: suspension rejects hosting operations and hides the public profile, restoration brings back the saved setup, `--local` refuses a non-local URL, and a Data API role cannot call the operator function.

## 6. Join

- [ ] 6.1 Connect the review card to the analysis evidence and the handle validation. Run the Phase 2 evidence list: AC-26 in full, AC-28, the FR-04 checks from the onboarding flow checklist, and Google app verification status. Record each in the acceptance record with command, date, revision and environment. Verify a Playwright journey from a new sign-in to a working `/{handle}` and `/{handle}/SKILL.md` against fake Google and OpenAI.

## 7. Release

- [ ] 7.1 Show `supabase db push --linked --dry-run` for the shared project, push the migrations, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the Vercel project, and deploy to production. Verify on `https://findmeatime.com` and `https://release.findmeatime.com` that a signed-in host completes setup and gets a working `/{handle}` and `/{handle}/SKILL.md`.
- [ ] 7.2 Update the owning documents (page list, provider setup, agent configuration, backend architecture where it leaves numbers open), tick Phase 2 in the implementation plan and regenerate the Korean mirrors of changed English documents. Verify `npm run check` passes.
