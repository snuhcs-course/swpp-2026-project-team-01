# Tasks

## Schema

- [ ] Add `host_accounts.deletion_due_at`, the account email kinds and the `account_emails` retention rule; generate and review the migration; rebuild the local database.

## Server

- [ ] Add the `host.schedule_deletion` command, the `POST /api/host/account-deletion` route with global sign-out, and the `host_deletion` job handler that reuses `app.operator_delete_host`.
- [ ] Cancel a scheduled deletion in the sign-in transaction.
- [ ] Add the account emails (scheduled, cancelled, completed, guest notice) with their recipient checks.

## Web

- [ ] Add the **Delete account** card to the Settings dialog, open it from `/app?settings=account`, and show the scheduled notice on the sign-in card.
- [ ] Update `/privacy` and `/terms-of-service` in English and Korean.

## Agent

- [ ] Point deletion requests to Settings in the base instructions, the linked-chat instructions and the MCP server instructions.

## Tests

- [ ] Unit tests for confirmation matching, the route input and the email copy.
- [ ] Integration tests for scheduling, cancelling, running, a stale job, a booking in flight, the email checks and retention.
- [ ] A Playwright test of the Settings step with the real local sign-in.

## Documents and review

- [ ] Update the page list, the operator runbook and the decision log, and regenerate their Korean mirrors.
- [ ] Agree the open decisions on #228, review with the team, then archive the change into `openspec/specs/host-account-deletion/spec.md` and close #228.
