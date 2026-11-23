# Design

## Context

See [proposal.md](proposal.md). Every signed-in person has one `app.host_accounts` row; a guest account is the same row seen from the requests it sent. `app.requester_host_profiles` holds the match of a sent request to the account (`request_id` primary key, cascading from both sides) and survives closure with its settings choice cleared ([request-dashboard](../../request-dashboard/proposal.md)). `app.operator_delete_host` deletes every row that references the account, the matches included, and is run by the operator CLI through `psql` and by the `host_deletion` job.

## Decisions

### D1. A match to a live account holds a closed request

The `closed_requests` rule of `app.cleanup_retained_records` gains one condition: no match to an account whose `deleted_at` is null. The request row is shared with its host, so the host side is kept as long as the guest's history is; the owner's decision on #48 keeps the host's own rule only for what remains after the guest's deletion. A suspended account still exists and keeps its history. Deleting the account deletes the match in the same transaction, so the next pass treats the request like any other: a request closed more than 90 days ago is deleted at once, a newer one waits for its 90 days.

Rejected: a `retain_until` column on requests | it duplicates the match and needs clearing on every deletion path. Rejected: copying the conversation to an account-owned table | the host's and guest's views would diverge, and the guest's events already live with the request.

### D2. The conversation is read, never continued

`GET /api/host/workspace-requests/{requestId}/conversation` authenticates the account like the other workspace routes, checks the match (`requester_host_profiles.host_account_id` is the account, the request is not a draft and not the account's own), and returns the guest discussion's NDJSON from cursor 0 without following, through the same `guestEventsResponse` the request page uses. A received request, another account's request or a malformed ID answer the same 404. The agent's channel auth (`guestMayUse`) allows a `read` grant for a requester discussion whose request is closed or whose link expired only while an active, undeleted account owns it; every write still needs an open request and a live link. The Requests list keeps an open sent request as a link to its request page (`active` and a live `bookingPath`) and makes every other sent card expand to the read-only transcript, with **Open the request page** while the link lasts (a booked receipt).

### D3. Deletion closes what the account sent

`operator_delete_host` reads, before the catalog loop deletes the matches, the account's sent requests that are open (`gathering`, `negotiating`, `awaiting_host_approval`, `booking`) or have a confirmed booking that has not started, and publishes one `account_requests_close` job (dedupe `account:{id}`, 20 attempts) naming them. The producer environment follows `app.publish_request_expiry`: production when the worker URL is in Vault, otherwise local. Publishing from the function keeps the operator CLI, which runs only SQL, and the Settings job on one rule.

The job's handler locks each request in ID order and decides from its state (`sentRequestClosing`): an open request is withdrawn (`closeRequest`); one still booking has its reserved booking cancelled first; a change after booking is dropped when its meeting has started, and otherwise cancels the meeting; a booked meeting still to come is cancelled through `cancelLockedMeeting`, the body of `booking.cancel` as the requester, which publishes `booking_cancel` and tells the host; an expired open request is left to the expiry job. A booking whose write may exist throws `booking_pending`, so the whole job backs off and retries. Withdrawal sends the host nothing, as a requester's withdrawal never does; the host sees it in Requests.

Rejected: closing the requests inside the SQL function | the cancellation's notices and calendar job are application code. Rejected: closing them in the `host_deletion` handler only | the operator path would skip it.

### D4. Calendar grant

The account's Google Calendar grant is the account's; a request uses it only when the guest chose **Use these settings** ([guest-flow-completion D7](../../guest-flow-completion/design.md)), and closing the request clears that choice, not the grant. Nothing changes in the code: this change records it as the rule, and the notice says it.

### D5. The operator names a guest account by its address

A guest account has no handle. `delete-host --host` accepts a Google address, lower-cased and checked for shape, and the statement resolves it from `app.google_identities`; an address that matches no account reaches the function unchanged and is refused as unknown.

## Risks

- Between the deletion and the job, a sent request stays open for the few seconds the worker takes. Anyone holding its booking link could still act on it, as before the deletion.
- Kept history lengthens how long a host holds a request it received from an account. The notice says the account owner's history is kept; the host can no more delete it than before.

## Testing

- Unit: `sentRequestClosing` for each state; the job's malformed payload; `delete-host` with an address.
- Integration (local stack, `tests/integration/guest-account-history.test.ts`): retention with and without a live owner and after deletion; the job's payload and its withdrawals and cancellation with the host notice; the conversation route's 200 and 404s.
