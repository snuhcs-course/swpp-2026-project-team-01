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
| `calendar_roles` | One row per host: conflict calendars and the booking destination (provider ID, name, access role), `revision`, the time the destination was last verified writable | The roles saved at H4, which scope analysis. They are part of setup, not policy: confirmation copies them into `host_settings`, so a ready host who saves new roles stays public on the confirmed ones |
| `calendar_analyses` | One row per scan: state (`pending`, `completed`, `failed`), scanned range and calendars, evidence JSON, failure category, `created_at` | Temporary evidence; deleted after 24 hours |
| `host_settings` | One row per host: `revision`, the confirmed policy JSON (including the confirmed conflict calendars and booking destination), the draft revision it confirmed, `confirmed_at` | The only source for feasibility and for readiness |
| `host_handles` | Every handle ever assigned: handle, host, `assigned_at`, `released_at` | Public identity. The handle is the primary key, so a released handle is never reassigned to another host |
| `handle_assignments` | One row per assignment, including taking back one's own released handle | The change limit |
| `signup_attempts` | Keyed hash of the source address and the time of each new-account creation | Sign-up bounds; deleted after 24 hours |
| `operator_actions` | Operator name, action, host, reason, environment, time | The suspension and restoration audit |

`host_accounts` gains `display_name`, taken from the Google profile at sign-in. Adopted values are copied into the draft and the confirmed policy with a provenance note, so evidence cleanup never changes them.

Rejected: putting the draft in eve memory. Memory is non-authoritative by [decision](../../../documentations/technical_specification/04_agent_configuration.md#memory), and a card must read the same record the tool wrote.

### 2. Setup state is derived

`lib/server/setup.ts` derives the step from durable records on every read, never from the browser. A state read writes only twice: the best-effort destination recheck below, and a one-time bootstrap. The first read that carries the browser's IANA zone (`?tz=`), for an active host whose draft has no timezone entry and who has no confirmed settings, stores it in the draft as `{ source: "starter_default", accepted: false, reason: "From this browser." }` under the account share lock and the draft lock. Later reads ignore the request's zone, so proposals, card commands and confirmation never depend on what a request says, and no command takes a browser zone.

| Next action | When |
|---|---|
| `connect_calendar` | No grant with the three Calendar scopes and a stored refresh token, or the grant was marked invalid. Readiness uses the same predicate (`calendarUsable` in `readiness.ts`) |
| `choose_calendars` | No saved roles, or the booking destination is lost: the saved destination is not writable (a confirmation found it read-only or gone and recorded that), or the recheck marked the confirmed destination unwritable and no roles were saved since |
| `analyzing` | The latest scan is pending and the host has not chosen manual setup. A scan still pending after 15 minutes, or whose job exhausted its attempts, is reported failed (`analysis_failed`) |
| `review_suggestions` | Required values are missing or not yet accepted |
| `confirm_settings` | Every required value is present and accepted |
| `ready` | Confirmed settings, a current handle, a confirmed booking destination last verified writable, and a valid grant |

The guard's `ready` uses the same derivation, so `readHostStanding` and `/{handle}` agree. A ready host who edits the draft stays public on the confirmed policy until confirming again (the flow's Ready → Drafting edge). A grant marked invalid by a refresh failure makes the host not ready, because the destination can no longer be shown writable ([interruption table](../../../documentations/user_experience/05_host_onboarding_flow.md#interruption-resume-and-failure)). When a ready host opens `/app` and the destination was last verified more than an hour earlier, the state read rechecks it against the live calendar list. A read-only or missing destination sets `unwritableAt` on the confirmed booking calendar; an invalid grant marks the grant invalid. Either makes the host not ready until setup is confirmed again or Calendar is reconnected. Phase 3's feasibility reads will make the check continuous; until then a revocation is noticed at the host's next visit or scan.

Required values: timezone, at least one weekly window, duration, buffer before, buffer after, mode, display name and handle (H8, edited on the review card and checked for format, reservation, availability and the change limit when drafted and again at confirmation); for in-person or either, a location answer (areas or venue, or **Decide per meeting**), a transport answer (a mode or **Depends on the trip**) and an extra travel buffer. The weekly meeting limit and note-like exclusions are optional. Mode, location and transport count only when the host accepted them on a card. A value the assistant drafted as `stated` from the conversation appears on its card as "You said: …" with **Use this** and counts once the host presses it; a suggestion never counts. Conversation text can be steered by content the host pasted or the model read; a card press cannot.

### 3. Handles

Format: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, 3–30 characters, compared in lowercase. The proposed handle is the Google address's local part reduced to that format, with a numeric suffix when taken.

Reserved names, checked before uniqueness: `about`, `account`, `accounts`, `admin`, `administrator`, `api`, `app`, `apple-icon`, `assets`, `auth`, `billing`, `blog`, `booking`, `bookings`, `cli`, `connect`, `connections`, `contact`, `dashboard`, `docs`, `email`, `eve`, `favicon`, `find-me-a-time`, `findmeatime`, `health`, `help`, `home`, `icon`, `inbox`, `internal`, `jobs`, `legal`, `llms`, `login`, `logout`, `mail`, `mcp`, `me`, `new`, `null`, `oauth`, `operator`, `pricing`, `privacy`, `public`, `robots`, `root`, `security`, `settings`, `sign-in`, `sign-out`, `sign-up`, `signin`, `signout`, `signup`, `sitemap`, `skill`, `static`, `status`, `support`, `system`, `team`, `terms`, `thyme`, `undefined`, `webhooks`, `well-known`, `www`. Names with a dot (`SKILL.md`, `llms.txt`) and `_next` fail the format anyway. Next.js resolves static routes before the dynamic `/[handle]` segment, and the list covers every current and planned top-level route.

Assignment happens at confirmation, inside the confirming transaction, under an advisory lock on the handle. It inserts into `host_handles`, or clears `released_at` when the host takes back its own released handle, and always adds a `handle_assignments` row. A collision with another host's current or released handle rejects the confirmation without changing either host. Changing a handle releases the old row. Changes are counted from `handle_assignments`: the first assignment is free, and after that at most 2 assignments in any rolling 30 days. Taking back one's own handle counts as a change. Lookups lower-case the path, so `/Alice` resolves as `alice`; a proposed handle is lower-cased before validation. Old handles return the neutral unavailable result; they never redirect, so an old link cannot silently reach someone else.

Rejected: redirecting old handles to the new one. It would leak that two handles are the same person, and it adds a state the contract does not need.

### 4. Sign-up bounds

A sign-up is the creation of a host account for a Google identity that has none. The callback reads the source address from the platform-set `x-forwarded-for` (first hop on Vercel) and stores only an HMAC-SHA-256 of it, keyed by a key derived from `TOKEN_ENCRYPTION_KEY`. Inside the account-creating transaction, which also takes the identity lock, the callback locks the source and service counters with advisory locks and counts rows from the last 24 hours. Past 3 per source or 100 service-wide, it creates nothing, signs the Supabase session out and returns to `/app?sign_in=limited`, which shows a temporary-limit message. An existing identity signs in without being counted. A request with no readable source address counts under a shared `unknown` bucket. Each sign-in also refreshes `host_accounts.display_name` from the Google profile, which fills it for hosts created in Phase 1.

Why these numbers: the Google app is in testing with a 100-user cap, and every host has a USD 30 daily model allowance under a USD 300 service cap, so 100 new accounts a day already bounds the worst case. Three per address allows a shared household or office without letting one client farm accounts.

### 5. Starter defaults and suggestions

Order of precedence, as the [backend architecture](../../../documentations/technical_specification/01_backend_architecture.md#host-setup-and-calendar-analysis) states: explicit choices, then authorized evidence, then labeled starter defaults. A suggestion never overwrites a field the host has accepted or stated.

| Field | Evidence source | Starter default |
|---|---|---|
| Timezone | The primary calendar's time zone (inferred), recorded by the scan as `primaryTimeZone` apart from the zone it counted in, and labeled as the primary calendar's only when it is that | The browser's IANA zone, stored in the draft by the first state read that carries it, labeled starter default with the reason "From this browser."; UTC only as a last resort. The primary calendar's zone replaces this entry while the host has not accepted it |
| Display name | The Google profile name (inferred) | The address's local part |
| Handle | — | The address's local part reduced to the handle format, with a numeric suffix when taken (starter default) |
| Weekly windows | Start-hour and weekday distribution, as one window per weekday spanning the observed hours | Monday–Friday 10:00–17:00 |
| Weekly meeting limit | The upper end of the weekly counts | None (no limit) |
| Note-like exclusions | Candidate entries listed for confirmation | None excluded |
| Duration | Median length of counted meetings, rounded to 15 minutes | 30 minutes |
| Buffers | None observed | 10 minutes before and 10 after |
| Preferred area and venue | Most frequent in-person location | None; the host answers |
| Extra travel buffer | None observed | 15 minutes |

A suggestion with fewer than 5 counted meetings falls back to the starter default and says the sample was too small, because a pattern from two meetings is not evidence. The scan counts in the zone setup will propose (a zone the host chose, then the confirmed one, then the primary calendar's, then the stored browser zone). If the proposed timezone later differs from the zone the scan counted in, the inferred weekly windows fall back to the starter default with that reason, because their hours would be shifted. An overnight span keeps its real next-day end (a meeting until 01:00 ends the window at 01:00). The weekly minimum load counts a full week inside the scanned range without meetings as 0.

### 6. Travel modes

**Driving**, **Public transit** and **Walking**, matching the Google Routes travel modes `DRIVE`, `TRANSIT` and `WALK`, plus **Depends on the trip**. Supported geography and route freshness stay with the Phase 3 proposal, as the plan's decision table says. Cycling and two-wheeler routing are left out because their coverage is uneven and nothing in the product calls for them.

### 7. Google Calendar client and renewed consent

`lib/server/google-calendar.ts` follows OpenInstinct's shape: a user-scoped client built from the stored grant by domain code, never an agent tool. It exchanges the refresh token at Google's token endpoint with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then calls `calendarList.list` and `events.list` with a 10-second timeout per request and a page cap (8 pages of events, 10 of calendars). A list still unfinished at its cap is reported as `calendar_unavailable`, never returned truncated, because a partial event list would read as free time. `invalid_grant` marks the grant invalid (a new `invalidated_at` column) and is reported as `calendar_access_revoked`. `recordGoogleGrant` clears `invalidated_at` whenever it stores a fresh refresh token, so reconnecting restores the grant. The base URLs are injectable, so tests use a fake server.

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

The tool projection gives the model counts, ranges, the place sample size and the number of note-like entries. Area and venue names and titles of note-like entries go only to the card: they come from event text other people can write. Calendar names reach the model only as quoted data (JSON string literals with Markdown and line breaks escaped, as the requester document encodes display names) beside a note that they are data, not instructions. Attendee addresses are never stored, only the internal and external counts. A failed read stores the failure category and the calendar that failed, and the card offers **Analyze again** or **Set up manually**. Free time is never inferred from a failed read.

The job reads Google inside the job's transaction, bounded by the request timeouts and a 30-second overall budget that also bounds the token exchange and the calendar list read. A job that exhausts its attempts on unexpected errors marks its scan failed (`analysis_failed`) in the same transaction, through the handler's `onExhausted`. The worker claims each registered kind separately with a per-kind batch limit; `calendar_analysis` claims at most 2 per batch, so a batch finishes within the 120-second lease. The handler catches provider errors itself, records the failed analysis (and any grant invalidation) and returns normally, so the failure commits and is shown instead of being rolled back with the job attempt. Rejected: a separate provider step outside the transaction. It needs a second job state, and there is no external write to protect.

### 9. Evidence cleanup

`app.cleanup_calendar_analyses(batch integer)` deletes up to `batch` analysis rows older than 24 hours with `FOR UPDATE SKIP LOCKED` and returns the count. It also deletes `signup_attempts` rows older than 24 hours. `pg_cron` runs it every 15 minutes with a batch of 500, in its own `supabase migration new` migration mirrored under `supabase/schemas/app/cron/`, like the job sweep. Execution is revoked from `PUBLIC`, so only the owner role, which is the database maintenance operator, can call it; no web route calls it. Drafts and settings hold adopted values with provenance, not references to analysis rows, so cleanup changes none of them.

### 10. Setup tools, instructions and audience

`agent/tools/setup.ts` is a `defineDynamic` resolver on `session.started`. It returns `read_setup_state` and `draft_settings` only when the session principal's `audience` attribute is `host_setup`; otherwise it returns `null`, so the tools are absent rather than denied. `agent/instructions/host-setup.ts` resolves the `host-setup.md` text the same way. `appAuth` adds `audience: "host_setup"` to the attributes it returns for host setup sessions.

Each tool's `execute` runs a domain operation with the actor from `ctx.session.auth.current`. It first checks the fence: the principal's account is active, and the session is the discussion's current, active generation. A retired or suspended caller is denied before any read.

`draft_settings` runs through `runCommand` with the retry key `tool:{callId}`, the operation `setup.draft_settings`, and the expected draft revision the model copies from its latest `read_setup_state` result; the [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#tools) is corrected to say so. A replayed step then rechecks access and returns the saved outcome without another write, which closes "Tool result lost after commit". A continued input after recovery calls the tool again with a new call ID, so the operation is also idempotent by value: when the draft already holds exactly the requested values and sources, it returns the current state without advancing the revision. That closes "Committed tool result before failure" without a second effect. Every check, including the per-field problems returned to the model, runs inside the command, so a replay returns the saved outcome even after the host accepted the value on a card. It can set only draft fields, labeled `stated` or `inferred` (starter defaults are the service's own), and it never accepts a value on the host's behalf. Mode, location and transport can be drafted only as `stated`, and even then count only once the host accepts them on a card (decision 2).

### 11. Cards and commands

The cards are React components in `apps/web/app/_components/setup/`, rendered from `GET /api/setup/state`. That route returns the derived step, the draft with labels, roles, the latest analysis projection for the card, the readiness result and, when ready, the links. The workspace reads it on load, after each card action and after each turn. Card actions `POST /api/setup/commands` with an operation name, the expected revision and a retry key that the card keeps across retries. Each runs through `runCommand` and the eligibility guard:

| Operation | Effect |
|---|---|
| `setup.save_calendar_roles` | Validates IDs against the live calendar list and the writable destination, saves the roles, publishes the analysis job |
| `setup.analyze_again`, `setup.set_up_manually` | Publishes a fresh scan, or records the manual choice |
| `setup.update_draft` | **Use this** accepts the card's current proposed value (a suggestion, or a value the assistant drafted, shown as "You said") with its label. The card sends the value it showed as `shown`; the server saves its own current value and refuses with `stale_revision` when that differs. **Adjust** and **Choose my own** write a `stated` value; the review card's handle and display-name fields use it too |
| `setup.confirm_settings` | The readiness recheck in decision 12. A destination that is no longer writable is refused as `invalid_input` with the audience-safe reason `destination_not_writable`; the route then records the access the live list showed on the saved roles, so setup asks for a writable destination |

A stale revision returns `stale_revision`, and the card reloads the current state. The authored onboarding messages (greeting, then the connection prompt or the verified congratulations, then the calendar step) are fixed strings revealed one at a time on a first visit. They show at once on revisits and under reduced motion. The weekly windows editor follows cal.diy's weekday rows with copy-to-days, and shows "(next day)" for an end earlier than its start.

### 12. Confirmation and readiness

Before the transaction, `setup.confirm_settings` reads the live calendar list once. In one transaction it then:

1. share-locks the account and requires it active;
2. locks the calendar roles, then the draft, and compares the draft revision with the review's;
3. recomputes the proposal and its hash, and checks that the roles it read under that lock exist and that their booking destination is still listed as `owner` or `writer`, then copies those roles into the policy;
4. validates the required values, the windows (equal clocks rejected) and the handle;
5. assigns the handle in `host_handles`, counting changes;
6. writes `host_settings`;
7. returns the links built from `APP_ORIGIN`.

Any failure rolls everything back. Links come only from this result or from the state route's derived readiness, never from model text.

Every setup transaction that takes more than one of these locks takes them in one order: the account share lock, the host's calendar roles (an advisory lock, since the first save has no row), the draft (an advisory lock and the row lock), then handle locks. Saving roles and confirming both touch roles and the draft, so any other order can deadlock. Saving roles creates no draft row: a missing draft is revision 0, so an open card does not go stale.

### 13. Public entry documents

`/SKILL.md`, `/[handle]/SKILL.md` and `/llms.txt` are route handlers that return `text/markdown; charset=utf-8` or `text/plain`, with `cache-control: no-store`, no cookies and `x-robots-tag: noindex` on host documents. The proxy matcher excludes them, so no Supabase session refresh runs. For `/` and single-segment, non-reserved `/{handle}` paths, the proxy rewrites to the matching document when the request's `Accept` header names `text/markdown` and does not rank `text/html` higher. The rewrite branch returns before the Supabase session refresh, so the Markdown response sets no cookie. Both representations send `Vary: Accept`. Each document carries `Instruction version: 1` and links built from `APP_ORIGIN`.

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
- **Unthrottled handle check.** `GET /api/setup/handle` has no per-host rate limit, so a signed-in, active host could probe which handles are taken or reserved quickly. An in-memory limit is not durable on serverless instances, and a durable one needs a new table, which this change avoids. Mitigation: the route requires an eligible host session, answers only availability categories (never another host's identity), and the same information is visible by visiting `/{handle}`; sign-ups are bounded per source and service-wide. Revisit with a small counter table (for example 30 checks per host per minute) if probing shows up in logs.
- **Lost scan jobs.** A scan whose job is lost without reaching the handler (an expired lease on its last attempt) cannot run `onExhausted`. Mitigation: a scan pending for more than 15 minutes is reported failed, so the card offers **Analyze again**.

## Migration Plan

One declarative sync generates the table migration. Hand-written `supabase migration new` migrations hold the cron schedule and any statement pg-delta does not generate. `supabase db reset --local` must rebuild the chain. The shared project receives the migrations by `supabase db push --linked`, after the dry run is shown. This is an explicit exception to the CI-only rule in [provider setup](../../../documentations/technical_specification/03_provider_setup.md#environments-and-collaboration): the user approved manual CLI pushes during Phase 1 because the deploy workflow's secrets are not set, and this change repeats that exception and records it in the acceptance record. The deploy workflow remains the intended path once its secrets exist. Rollback: the tables are new and additive. Reverting the deployment leaves them unused, and the guard simply reports hosts not ready again.

## Open Questions

- Google app verification for the sensitive Calendar scopes needs a console submission by a team member; this change records its status.
- Whether hosts want a manual "remove note-like exclusion" control after confirmation; today they edit the draft and confirm again.
