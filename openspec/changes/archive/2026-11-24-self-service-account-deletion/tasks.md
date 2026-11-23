# Tasks

## Schema

- [x] Add `host_accounts.deletion_due_at`, the account email kinds and the `account_emails` retention rule, and clear the schedule in `app.operator_delete_host`; generate and review the migration; rebuild the local database.

## Server

- [x] Add the `host.schedule_deletion` command, the `POST /api/host/account-deletion` route with global sign-out, and the `host_deletion` job handler that reuses `app.operator_delete_host`.
- [x] Cancel a scheduled deletion in the sign-in transaction.
- [x] Add the account emails (scheduled, cancelled, completed, guest notice) with their recipient checks.

## Web

- [x] Add the **Delete account** card to the Settings dialog, open it from `/app?settings=account`, and show the scheduled notice on the sign-in card.
- [x] Update `/privacy` and `/terms-of-service` in English and Korean.

## Agent

- [x] Point deletion requests to Settings in the base instructions, the linked-chat instructions and the MCP server instructions.

## Tests

- [x] Unit tests for confirmation matching and the email copy; the route's input and refusals in the integration tests.
- [x] Integration tests for scheduling, cancelling, running, a stale job, a booking in flight, the email checks and retention.
- [x] A Playwright test of the Settings step with the real local sign-in.

## Documents and review

- [x] Update the page list, the operator runbook and the decision log, and regenerate their Korean mirrors.
- [ ] Agree the open decisions on #228, review with the team, then archive the change into `openspec/specs/host-account-deletion/spec.md` and close #228.

## Archive note

Archived on 2026-11-24 with the code on `main` (pull request #440). The unticked tasks above stay open: each needs a person (a teammate review, a real device or messenger, a console, deployment or production check, or a paid model run) or a run of the local integration and browser suites, which this archive did not do. Their issues stay open with `Part of`.
