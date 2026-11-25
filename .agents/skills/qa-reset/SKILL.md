---
name: qa-reset
description: Wipe every account and all app data on the shared Supabase project (anelszynxtvxoxqvzgqt, which serves findmeatime.com) so a QA round starts from a clean state — then verify it is empty. Use when asked to "데이터 싹 날려줘", "QA하게 초기화해줘", "공유 DB 리셋", "reset the shared project for QA", or "wipe all accounts".
---

# Reset the shared project for QA

Deletes every host, guest, request, booking, conversation, job and Auth user on the shared project, in one transaction, and leaves the schema, migration history and operator-registered email receivers in place. Afterwards everyone signs up again from an empty database.

## What it touches

- **Wiped:** every table in the `app` schema except `email_receivers` (truncated, identities restarted), including the operator audit in `operator_operations`, and `auth.users` with its identities, sessions, refresh tokens, MFA rows, flow state, one-time tokens and audit log. New `app` tables are included automatically.
- **Kept:** the schema and functions, `supabase_migrations` and `auth.schema_migrations`, `app.email_receivers` (the AgentMail inbox and webhook an operator registered), Storage, and project settings.
- **Not reachable from here:** events already written to hosts' Google Calendars, messages already sent through iMessage, Telegram or email, and the GA/PostHog analytics history. Say so in the report.
- **Only the shared project.** The script has `anelszynxtvxoxqvzgqt` fixed in it; it never touches the release project or a personal one. For a local reset use `supabase db reset --local`.

## Steps

1. **Dry run.** From the repository root run:

   ```sh
   .agents/skills/qa-reset/reset.sh
   ```

   It reads `SUPABASE_ACCESS_TOKEN` from the environment or the repository's `.env` (never print it; a linked worktree has no `.env`, so export the token there) and lists the row counts that would go. Show the user the number of Auth users and the largest tables.

2. **Get a clear yes.** Check that no QA session is in progress: a running job worker or a live sign-up can write rows right after the wipe and fail the check. The wipe cannot be undone and signs out the whole team. Go ahead only when the user's own message in this conversation asks for the wipe now (for example "실행해", "날려줘"). Otherwise ask once, with the dry-run numbers, and wait. A yes for an earlier wipe does not carry over.

3. **Wipe.**

   ```sh
   .agents/skills/qa-reset/reset.sh --yes
   ```

   The whole wipe is one `DO` block, so a failure rolls everything back. If it fails, report the error as is; do not delete tables one by one to get around it. A foreign-key error on `TRUNCATE` means a table that is *not* wiped references one that is: `email_receivers` (or another kept table) gained a foreign key to a wiped `app` table, or a table outside `app` references one. Decide with the user whether that table is wiped too or the reference is cleared first, update the script, run the dry run again, and only then rerun.

4. **Report.** The script exits non-zero unless `auth.users` and every wiped `app` table are empty, and prints the HTTP status of findmeatime.com. Tell the user:
   - how many accounts and rows were deleted,
   - that `email_receivers` was kept,
   - that everyone has to sign up again,
   - what this could not reach (calendar events, sent messages).

## Notes

- Deleting a single account is a different job: use `npm run admin -- delete-host --host <id> --reason ... --operator <name> --project anelszynxtvxoxqvzgqt --yes`, which keeps an audit row (until the next full reset).
- The shared project receives migrations only from CI; this skill changes data, never schema.
