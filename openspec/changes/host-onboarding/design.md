# Design

## Context

See [proposal.md](proposal.md). Phase 1 left these pieces to build on:

- a private `app` schema reached only by server code as the owner role;
- one host account per Google identity, with the granted Calendar scopes and a sealed refresh token in `app.provider_grants`;
- the shared guard in `lib/server/host-eligibility.ts`, which reports every active host as not ready;
- the command pipeline (`runCommand`), with retry identity, expected revision and audience-safe errors;
- durable jobs with a production-only worker woken by `pg_net` and swept by `pg_cron`;
- one host setup discussion per host, served by eve sessions that the application indexes by generation;
- an agent with no tools and only `base.md`.

Before designing each module, the reference files the plan names for Phase 2 were read: OpenInstinct's Google Workspace client and its generated-client tests, `ask_question` and the revision-checked profile memory; the personal-agent template's typed authorization and input cards and its internal API boundary; the eve memory template's scope test; and cal.diy's weekly availability editor, for design only. The pull request names the revisions.

## Goals / Non-Goals

**Goals:** a host completes H3–H10 on the web; the shared guard derives readiness from durable records; a ready host has `/{handle}` and `/{handle}/SKILL.md`; operators can suspend and restore; sign-ups and handle changes are bounded; analysis evidence expires on schedule.

**Non-goals:** request intake and feasibility (Phase 3); the personal-agent authorization and MCP setup path (Phase 5); iMessage linking and setup over iMessage (Phase 6); travel-time lookups (Phase 3).

## Decisions

### 1. Records

All new tables live in the private `app` schema with row-level security enabled and no client grants, like the Phase 1 tables.

| Table | Holds | Authoritative for |
|---|---|---|
| `setup_drafts` | One row per host: `revision`, `values` (JSON per field: value, source `stated`/`inferred`/`starter_default`, whether the host accepted it, sample size, evidence reference), `analysis_skipped` | In-progress values. Never read by scheduling |
| `calendar_roles` | One row per host: conflict calendars and the booking destination (provider ID, name, access role), `revision`, the time the destination was last verified writable | Confirmed roles (H4) |
| `calendar_analyses` | One row per scan: state (`pending`, `completed`, `failed`), scanned range and calendars, evidence JSON, failure category, `created_at` | Temporary evidence; deleted after 24 hours |
| `host_settings` | One row per host: `revision`, the confirmed policy JSON, the draft revision it confirmed, `confirmed_at` | The only source for feasibility |
| `host_handles` | Every handle ever assigned: handle, host, `assigned_at`, `released_at` | Public identity. The handle is the primary key, so a released handle is never reassigned to another host |
| `signup_attempts` | Keyed hash of the source address and the time of each new-account creation | Sign-up bounds; deleted after 24 hours |
| `operator_actions` | Operator name, action, host, reason, environment, time | The suspension and restoration audit |

`host_accounts` gains `display_name`, taken from the Google profile at sign-in. Adopted values are copied into the draft and the confirmed policy with a provenance note, so evidence cleanup never changes them.

Rejected: putting the draft in eve memory. Memory is non-authoritative by [decision](../../../documentations/technical_specification/04_agent_configuration.md#memory), and a card must read the same record the tool wrote.

### 2. Setup state is derived

`lib/server/setup.ts` derives the step from durable records on every read, never from the browser:

| Next action | When |
|---|---|
| `connect_calendar` | No grant with the three Calendar scopes, or the grant was marked invalid |
| `choose_calendars` | No saved roles |
| `analyzing` | The latest scan is pending and the host has not chosen manual setup |
| `review_suggestions` | Required values are missing or not yet accepted |
| `confirm_settings` | Every required value is present and accepted |
| `ready` | Confirmed settings, a current handle, a booking destination and a valid grant |

The guard's `ready` uses the same derivation, so `readHostStanding` and `/{handle}` agree. A ready host who edits the draft stays public on the confirmed policy until confirming again (the flow's Ready → Drafting edge). A grant marked invalid by a refresh failure makes the host not ready, because the destination can no longer be shown writable ([interruption table](../../../documentations/user_experience/05_host_onboarding_flow.md#interruption-resume-and-failure)).

Required values: timezone, at least one weekly window, duration, buffer before, buffer after, mode, display name and handle; for in-person or either, a location answer (areas or venue, or **Decide per meeting**), a transport answer (a mode or **Depends on the trip**) and an extra travel buffer. The weekly meeting limit and note-like exclusions are optional. Mode, location and transport count only when the host answered them, by a card or by stating them in text. A suggestion the host has not accepted does not count.

### 3. Handles

Format: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, 3–30 characters, compared in lowercase. The proposed handle is the Google address's local part reduced to that format, with a numeric suffix when taken.

Reserved names, checked before uniqueness: `about`, `account`, `accounts`, `admin`, `administrator`, `api`, `app`, `apple-icon`, `assets`, `auth`, `billing`, `blog`, `booking`, `bookings`, `cli`, `connect`, `connections`, `contact`, `dashboard`, `docs`, `email`, `eve`, `favicon`, `find-me-a-time`, `findmeatime`, `health`, `help`, `home`, `icon`, `inbox`, `internal`, `jobs`, `legal`, `llms`, `login`, `logout`, `mail`, `mcp`, `me`, `new`, `null`, `oauth`, `operator`, `pricing`, `privacy`, `public`, `robots`, `root`, `security`, `settings`, `sign-in`, `sign-out`, `sign-up`, `signin`, `signout`, `signup`, `sitemap`, `skill`, `static`, `status`, `support`, `system`, `team`, `terms`, `thyme`, `undefined`, `webhooks`, `well-known`, `www`. Names with a dot (`SKILL.md`, `llms.txt`) and `_next` fail the format anyway. Next.js resolves static routes before the dynamic `/[handle]` segment, and the list covers every current and planned top-level route.

Assignment happens at confirmation, inside the confirming transaction, by inserting into `host_handles`. A collision with another host's current or released handle rejects the confirmation without changing either host. Changing a handle releases the old row and inserts the new one. Changes are counted from `host_handles` rows: the first assignment is free, and after that at most 2 new assignments in any rolling 30 days. A host may take back its own released handle, and that counts as a change. Old handles return the neutral unavailable result; they never redirect, so an old link cannot silently reach someone else.

Rejected: redirecting old handles to the new one. It would leak that two handles are the same person, and it adds a state the contract does not need.

### 4. Sign-up bounds

A sign-up is the creation of a host account for a Google identity that has none. The callback reads the source address from the platform-set `x-forwarded-for` (first hop on Vercel) and stores only an HMAC-SHA-256 of it, keyed by a key derived from `TOKEN_ENCRYPTION_KEY`. Inside the account-creating transaction, which also takes the identity lock, the callback locks the source and service counters with advisory locks and counts rows from the last 24 hours. Past 3 per source or 100 service-wide, it creates nothing, signs the Supabase session out and returns to `/app?sign_in=limited`, which shows a temporary-limit message. An existing identity signs in without being counted. A request with no readable source address counts under a shared `unknown` bucket.

Why these numbers: the Google app is in testing with a 100-user cap, and every host has a USD 30 daily model allowance under a USD 300 service cap, so 100 new accounts a day already bounds the worst case. Three per address allows a shared household or office without letting one client farm accounts.

### 5. Starter defaults and suggestions

Order of precedence, as the [backend architecture](../../../documentations/technical_specification/01_backend_architecture.md#host-setup-and-calendar-analysis) states: explicit choices, then authorized evidence, then labeled starter defaults. A suggestion never overwrites a field the host has accepted or stated.

| Field | Evidence source | Starter default |
|---|---|---|
| Timezone | The primary calendar's time zone (inferred) | The browser's IANA zone, sent with the first state read and labeled inferred; UTC only as a last resort, labeled starter default |
| Weekly windows | Start-hour and weekday distribution, as one window per weekday spanning the observed hours | Monday–Friday 10:00–17:00 |
| Weekly meeting limit | The upper end of the weekly counts | None (no limit) |
| Note-like exclusions | Candidate entries listed for confirmation | None excluded |
| Duration | Median length of counted meetings, rounded to 15 minutes | 30 minutes |
| Buffers | None observed | 10 minutes before and 10 after |
| Preferred area and venue | Most frequent in-person location | None; the host answers |
| Extra travel buffer | None observed | 15 minutes |

A suggestion with fewer than 5 counted meetings falls back to the starter default and says the sample was too small, because a pattern from two meetings is not evidence.

### 6. Travel modes

**Driving**, **Public transit** and **Walking**, matching the Google Routes travel modes `DRIVE`, `TRANSIT` and `WALK`, plus **Depends on the trip**. Supported geography and route freshness stay with the Phase 3 proposal, as the plan's decision table says. Cycling and two-wheeler routing are left out because their coverage is uneven and nothing in the product calls for them.

### 7. Google Calendar client and renewed consent

`lib/server/google-calendar.ts` follows OpenInstinct's shape: a user-scoped client built from the stored grant by domain code, never an agent tool. It exchanges the refresh token at Google's token endpoint with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then calls `calendarList.list` and `events.list` with a 10-second timeout per request and a page cap. `invalid_grant` marks the grant invalid (a new `invalidated_at` column) and is reported as `calendar_access_revoked`. The base URLs are injectable, so tests use a fake server.

The writable check is the destination's `accessRole` of `owner` or `writer` in the live calendar list, read before the saving transaction and again before confirmation. A write probe was rejected: creating and deleting a real event would show up on the host's calendar and in attendee notifications.

**Connect Google Calendar** sends the host to `/auth/sign-in?consent=calendar`, which adds `prompt=consent` and `include_granted_scopes=true` to the same Supabase Google sign-in. The existing callback already records the granted scopes and a returned refresh token, and always returns to `/app`. So renewed consent needs no new Google redirect URI and no second token store. The page list's `/connections/google/callback` is not needed for hosts, and the page list is corrected. If the host picks a different Google account on the consent screen, they sign in as that account's host, exactly as a fresh sign-in would. **Manage Google connection** links to Google's third-party connections page for revocation and offers the reconnect action.

### 8. Analysis

Saving roles publishes a `calendar_analysis` job in the same transaction, deduplicated per roles revision. **Analyze again** publishes one with a fresh key. The handler reads the saved conflict calendars over the 28 days before and after the scan time, then writes the evidence. It follows iteration 1's F02 rules:

- An event counts as busy unless it is cancelled, declined by the host or transparent.
- Copies are merged only by provider event identity.
- All-day events never count as meetings.
- An event with both a place and a conference link never decides the meeting mode.

| Dimension | Computed from | Stored |
|---|---|---|
| Preferred times | Counted meetings (busy, timed, at least one other attendee) by weekday and start hour in the host timezone | Counts per cell, total |
| Meeting load | Counted meetings per week (Monday start, host timezone), internal when every other attendee shares the host's email domain | Per-week internal and external counts, range |
| Note-like entries | Timed or all-day entries with no other attendee and no location or link | Event identity, calendar, title, time, and a fingerprint (`updated`) for "needs re-check" |
| Preferred places | Events with a location and no conference link: venue is the location's first comma-separated part, area its second when present | Top area and venue with counts |

The tool projection gives the model counts, ranges, area and venue names, and the number of note-like entries. Titles of note-like entries go only to the card. Attendee addresses are never stored, only the internal and external counts. A failed read stores the failure category and the calendar that failed, and the card offers **Analyze again** or **Set up manually**. Free time is never inferred from a failed read.

The job reads Google inside the job's transaction, bounded by the request timeouts and a 45-second overall budget, well inside the 120-second lease. Rejected: a separate provider step outside the transaction. It needs a second job state, and there is no external write to protect.

### 9. Evidence cleanup

`app.cleanup_calendar_analyses(batch integer)` deletes up to `batch` analysis rows older than 24 hours with `FOR UPDATE SKIP LOCKED` and returns the count. It also deletes `signup_attempts` rows older than 24 hours. `pg_cron` runs it every 15 minutes with a batch of 500, in its own `supabase migration new` migration mirrored under `supabase/schemas/app/cron/`, like the job sweep. Execution is revoked from `PUBLIC`, so only the owner role, which is the database maintenance operator, can call it; no web route calls it. Drafts and settings hold adopted values with provenance, not references to analysis rows, so cleanup changes none of them.

### 10. Setup tools, instructions and audience

`agent/tools/setup.ts` is a `defineDynamic` resolver on `session.started`. It returns `read_setup_state` and `draft_settings` only when the session principal's `audience` attribute is `host_setup`; otherwise it returns `null`, so the tools are absent rather than denied. `agent/instructions/host-setup.ts` resolves the `host-setup.md` text the same way. `appAuth` adds `audience: "host_setup"` to the attributes it returns for host setup sessions.

Each tool's `execute` runs a domain operation with the actor from `ctx.session.auth.current`. It first checks the fence: the principal's account is active, and the session is the discussion's current, active generation. A retired or suspended caller is denied before any read.

`draft_settings` runs through `runCommand` with the retry key `tool:{callId}`, the expected draft revision from its input, and the operation `setup.draft_settings`. A replayed step then rechecks access and returns the saved outcome without another write, which closes "Tool result lost after commit" and "Committed tool result before failure". It can set only draft fields, always with a source label, and it never accepts a value on the host's behalf or sets mode, location or transport as an answer unless the source is `stated`.

### 11. Cards and commands

The cards are React components in `apps/web/app/_components/setup/`, rendered from `GET /api/setup/state`. That route returns the derived step, the draft with labels, roles, the latest analysis projection for the card, the readiness result and, when ready, the links. The workspace reads it on load, after each card action and after each turn. Card actions `POST /api/setup/commands` with an operation name, the expected revision and a retry key that the card keeps across retries. Each runs through `runCommand` and the eligibility guard:

| Operation | Effect |
|---|---|
| `setup.save_calendar_roles` | Validates IDs against the live calendar list and the writable destination, saves the roles, publishes the analysis job |
| `setup.analyze_again`, `setup.set_up_manually` | Publishes a fresh scan, or records the manual choice |
| `setup.update_draft` | **Use this** accepts a suggestion with its label; **Adjust** and **Choose my own** write a `stated` value |
| `setup.confirm_settings` | The readiness recheck in decision 12 |

A stale revision returns `stale_revision`, and the card reloads the current state. The authored onboarding messages (greeting, then the connection prompt or the verified congratulations, then the calendar step) are fixed strings revealed one at a time on a first visit. They show at once on revisits and under reduced motion. The weekly windows editor follows cal.diy's weekday rows with copy-to-days, and shows "(next day)" for an end earlier than its start.

### 12. Confirmation and readiness

Before the transaction, `setup.confirm_settings` reads the live calendar list once. In one transaction it then:

1. share-locks the account and requires it active;
2. locks the draft and compares its revision with the review's;
3. checks that the roles exist and that the booking destination is still listed as `owner` or `writer`;
4. validates the required values, the windows (equal clocks rejected) and the handle;
5. assigns the handle in `host_handles`, counting changes;
6. writes `host_settings`;
7. returns the links built from `APP_ORIGIN`.

Any failure rolls everything back. Links come only from this result or from the state route's derived readiness, never from model text.

### 13. Public entry documents

`/SKILL.md`, `/[handle]/SKILL.md` and `/llms.txt` are route handlers that return `text/markdown; charset=utf-8` or `text/plain`, with `cache-control: no-store`, no cookies and `x-robots-tag: noindex` on host documents. The proxy matcher excludes them, so no Supabase session refresh runs. For `/` and `/{handle}`, the proxy rewrites to the matching document when the request's `Accept` header names `text/markdown` and does not rank `text/html` higher. Both representations send `Vary: Accept`. Each document carries `Instruction version: 1` and links built from `APP_ORIGIN`.

The requester document reads only the public projection: handle and display name, through the shared guard. Unknown, invalid, unready or suspended hosts get the same neutral 404 body; a database failure gets a 503 with `retry-after`. The display name is JSON-encoded, with control characters removed and Markdown-significant characters escaped as `\u` sequences, inside a field marked as data. Intake opens in Phase 3, so the host page and document say requests are not accepted yet and invent no endpoint.

### 14. Administrator CLI

`scripts/admin.ts`, run as `npm run admin -- <show|suspend|restore> --host <handle-or-id> [--reason <text>] --operator <name> (--local | --project <ref>) [--yes]`, prints `fmat-admin` in its usage. It is a separate entry point: it imports no web or agent code and accepts no user credential.

- `--local` runs SQL through `DATABASE_URL` and refuses any host other than `127.0.0.1` or `localhost`.
- `--project <ref>` runs SQL through the Supabase Management API's database query endpoint with the operator's own `SUPABASE_ACCESS_TOKEN`. The operator's authority is therefore their membership in the Supabase organization that owns that project, which no host, requester or agent credential grants.

Mutations print the target environment and host and require `--yes` or a typed confirmation. Each calls `app.operator_set_host_status(host, status, operator, reason, environment)`, a function whose execution is revoked from `PUBLIC`. It updates the status and inserts the audit row in one statement, and leaves setup untouched, so restoration brings the saved setup back. Inputs are validated against the handle format or UUID syntax before any SQL is built, and values are passed as quoted literals.

Rejected: a dedicated operator Postgres role with its own password. It needs a credential distribution channel the team does not have yet, and the Management API already binds authority to named people. Rejected: an admin HTTP route. It would put operator authority on the public surface.

### 15. Tests

| Layer | Covers |
|---|---|
| Unit (beside modules) | Handle format and reserved list; window validation and next-day display; analysis computations over fixture events; suggestion precedence and the small-sample fallback; display-name encoding; Markdown negotiation |
| Integration (`tests/integration/`) | Commands with stale revisions and retries; the confirmation recheck, including a revoked destination, a handle collision, the change limit and a suspended account; sign-up bounds per source and service-wide; the analysis job against a fake Google server, with revoked and failed reads; tool fences and replay; cleanup bounds and preservation; operator functions and denial to Data API roles; SKILL documents and status codes |
| Database (`supabase/tests/`) | Grants: `anon` and `authenticated` reach no new table or function |
| Browser (`tests/e2e/`) | A new host completes setup against fake Google and fake OpenAI and gets a working `/{handle}` and `/{handle}/SKILL.md`; declined scopes show **Connect Google Calendar**; a stale review is rejected; keyboard and phone-width use; a suspended host's public page is unavailable |

## Risks / Trade-offs

- **Heuristic places.** Area and venue come from free-text locations without geocoding, so they can be wrong. Mitigation: they are labeled inferred and only ever suggestions.
- **Provider calls inside a job transaction.** A slow Google response holds one job row lock for up to 45 seconds. Mitigation: per-request timeouts and the lease.
- **Spoofable audit operator name.** `--operator` is typed by the operator. Mitigation: operators already hold full database authority through their Supabase membership, so the name records intent rather than proving identity. The Management API path also requires a personal token.
- **Renewed consent through sign-in.** A host who picks another Google account changes which host they are signed in as. Mitigation: the workspace names the signed-in account on the calendar card.

## Migration Plan

One declarative sync generates the table migration. Hand-written `supabase migration new` migrations hold the cron schedule and any statement pg-delta does not generate. `supabase db reset --local` must rebuild the chain. The shared project receives the migrations by `supabase db push --linked`, after the dry run is shown, as the Phase 1 lead did and the user approved; the deploy workflow remains the intended path once its secrets exist. Rollback: the tables are new and additive. Reverting the deployment leaves them unused, and the guard simply reports hosts not ready again.

## Open Questions

- Google app verification for the sensitive Calendar scopes needs a console submission by a team member; this change records its status.
- Whether hosts want a manual "remove note-like exclusion" control after confirmation; today they edit the draft and confirm again.
