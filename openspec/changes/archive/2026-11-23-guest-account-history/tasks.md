# Tasks

## Schema

- [x] Keep closed requests matched to a live account in `app.cleanup_retained_records`, and publish `account_requests_close` from `app.operator_delete_host`; write the migration by hand with `supabase migration new guest_account_history` (not applied).

## Server

- [x] Add the `account_requests_close` job and share the requester cancellation (`cancelLockedMeeting`) with `booking.cancel`.
- [x] Add the read-only conversation route for a sent request, and let the agent serve that read while an active account owns the request.
- [x] Mark open sent requests in the workspace list.
- [x] Accept a Google address in `delete-host`.

## Web

- [x] Expand closed sent requests to their read-only conversation in Requests.
- [x] Update the Delete account card, the scheduled-deletion email and `/privacy` in English and Korean.

## Tests

- [x] Unit tests for the closing decision, the job's payload check and the operator address.
- [x] Integration tests for retention, the deletion job and the conversation route (written; run on main by the owner with the local stack).

## Documents

- [x] Update the operator runbook, the CLI direction, the page list and the decision log, and regenerate their Korean mirrors.
