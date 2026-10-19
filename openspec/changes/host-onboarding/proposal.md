# Proposal

## Why

Phase 1 delivered a signed-in, authorized, empty product: a host lands on `/app` and talks to Thyme, which has no tools, and no host can become ready. The [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-2--host-onboarding) makes Phase 2 the step where a signed-in host completes setup and gets a public booking link and skill document. Open sign-up is also live without the abuse controls the [host account contract](../../specs/host-admission/spec.md) requires, and the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md#known-gaps) lists that as a gap to close before the OAuth app is published.

## What Changes

- **Setup conversation.** Register the host-setup tools `read_setup_state` and `draft_settings` only in host setup sessions, add the `host-setup.md` instruction fragment on top of `base.md`, and reveal the authored onboarding messages one at a time in `/app` ([agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#tools)).
- **Cards.** Calendar roles, analysis, suggestion cards for timezone, weekly windows (including overnight windows), weekly meeting limit, note-like exclusions, duration and buffers, explicit mode, location and transport questions, the final review with **Confirm and save proposed settings**, and the share-links card. They are server-rendered projections whose actions run application commands with the current revision ([host onboarding flow](../../../documentations/user_experience/05_host_onboarding_flow.md#steps), steps H3–H10).
- **Google Calendar.** A server-side Calendar client built from the stored grant; calendar roles from the host's actual calendars, with a check that the booking destination is writable; **Connect Google Calendar** when the scopes were declined; **Manage Google connection**.
- **Analysis.** The first scan of the saved conflict calendars over the past and next four weeks runs as a durable job and produces the four evidence dimensions with sample sizes. **Analyze again** refreshes it. A scheduled maintenance pass removes evidence after 24 hours and keeps adopted values ([analysis retention](../../specs/calendar-analysis-retention/spec.md)).
- **Readiness and publication.** Confirmation rechecks readiness in one transaction, saves the confirmed policy and fixes the handle. The shared guard then reports the host ready, and only a ready host has a public profile.
- **Handles and abuse limits.** Handle format, a reserved list, uniqueness that never reassigns a handle, a bounded change rate, and bounded sign-ups per source and service-wide.
- **Public entry.** `/` and `/{handle}` pages with an agent section and an alternate link, `/SKILL.md`, `/{handle}/SKILL.md`, `llms.txt`, and Markdown content negotiation ([public agent entry](../../specs/public-agent-entry/spec.md)).
- **Administrator CLI.** `npm run admin` with `show`, `suspend` and `restore`, bound to one named environment and audited ([CLI direction](../../../documentations/technical_specification/05_cli.md)).

The H11 iMessage step belongs to Phase 6 and is not in this change.

## Decisions settled here

The plan assigns these decisions to Phase 2. The [design](design.md) records each one with its alternatives, and this change copies them into [PRD section 10](../../../documentations/02_product_requirements.md#10-dependencies-and-open-decisions) and the host-admission delta:

| Decision | Choice |
|---|---|
| Sign-up limits | At most 3 new host accounts per source address in a rolling 24 hours, and 100 service-wide in a rolling 24 hours; existing identities always sign in |
| Handle format | 3–30 characters, lowercase letters, digits and single hyphens, starting with a letter and not ending with a hyphen |
| Handle changes | The first assignment is free; then at most 2 changes in any rolling 30 days. Released handles are never assigned to another host |
| Reserved handles | Route names (`app`, `auth`, `booking`, `connect`, `connections`, `api`, `eve`, `skill`, `llms`, `_next`) plus the operational, product and impersonation names listed in the [design](design.md#3-handles) |
| Starter defaults | Monday to Friday 10:00–17:00 in the host timezone, 30-minute meetings, 10-minute buffers before and after, no weekly limit, 15-minute extra travel buffer |
| Travel modes | **Driving**, **Public transit**, **Walking**, plus **Depends on the trip** |
| Analysis retention | Confirmed at 24 hours, with a cleanup pass every 15 minutes in batches of 500 |
| Administrator CLI | `npm run admin -- <command>` (`scripts/admin.ts`), named `fmat-admin`; the operator authenticates with their own Supabase personal access token and names the project, or uses `--local` against the local stack |

## Capabilities

### New Capabilities

- `host-setup`: suggestion-first onboarding: drafts separate from confirmed policy, labeled suggestions, calendar roles, disclosed analysis, explicit mode, location and transport answers, and confirmation with a readiness recheck. The PRD's FR-02 to FR-04 describe the intent; no capability spec yet holds the observable contract.

### Modified Capabilities

- `host-admission`: the abuse limits gain their numbers, and handle format and reserved names become requirements. Operator suspension and restoration gain the administrator CLI's environment binding and audit record.

This change also closes scenarios that the main specs already state, without changing their text:

| Specification | Closed in this change | Still deferred, and where |
|---|---|---|
| [`host-admission`](../../specs/host-admission/spec.md) | Operator suspension and restoration; abuse limits; readiness guard; stable public identity; "Sign-in without setup" with a real readiness check | "Account-free requester" in Phase 3, when intake exists |
| [`calendar-analysis-retention`](../../specs/calendar-analysis-retention/spec.md) | All requirements and scenarios | None |
| [`public-agent-entry`](../../specs/public-agent-entry/spec.md) | All requirements; host document and requester document for a ready host | Requester continuation beyond the web page (MCP, CLI) in Phase 5 |
| [`meeting-feasibility`](../../specs/meeting-feasibility/spec.md) | "Invalid equal clocks" and "Review next-day hours" for drafts and review | Candidate evaluation over overnight windows, daylight-saving boundaries and the weekly limit in Phase 3 |
| [`chat-workspaces`](../../specs/chat-workspaces/spec.md) | The Connect Google Calendar offer in "Google-only MVP host login"; "Calendar scopes unchecked at sign-in"; "Return from calendar consent"; "Resume host setup" with server-derived progress; "Stale artifact" for setup review | Inbox, discussion switch and request artifacts in Phases 3 and 4 |
| [`conversation-access`](../../specs/conversation-access/spec.md) | "Tool result lost after commit" and "Committed tool result before failure" | Separate discussion audiences in Phases 3 and 4 |

## Impact

- **New code:** `agent/tools/`, `agent/instructions/host-setup.ts`, `lib/server/{setup,calendar,analysis,handles,public-profile,signup-limits,operator}*.ts`, `lib/contracts/setup*.ts`, `apps/web` setup cards, `/[handle]`, `/SKILL.md`, `/[handle]/SKILL.md`, `/llms.txt`, `/api/setup/*`, `scripts/admin.ts`.
- **Schema:** new private tables for drafts, calendar roles, analyses, confirmed settings, handles, sign-up attempts and operator actions, the cleanup function and its schedule, generated through pg-delta.
- **Systems:** a migration on the shared project `anelszynxtvxoxqvzgqt`, shown with `supabase db push --dry-run` first; `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the Vercel project so the server can refresh Calendar access. No new Google OAuth redirect URI: renewed Calendar consent goes through the existing sign-in callback.
- **Documents:** PRD section 10, [host onboarding flow](../../../documentations/user_experience/05_host_onboarding_flow.md#open-decisions), [CLI direction](../../../documentations/technical_specification/05_cli.md), [page list](../../../documentations/user_experience/04_page_list.md), [provider setup](../../../documentations/technical_specification/03_provider_setup.md), `.env.example`, the acceptance record and the plan's Phase 2 boxes, with the Korean mirrors regenerated.
