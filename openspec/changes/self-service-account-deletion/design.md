# Design

## Context

See [proposal.md](proposal.md). Operator deletion is one plpgsql function, `app.operator_delete_host(target, operator, reason, environment)` in `supabase/schemas/app/functions/data_deletion.sql`: it locks the account and the host's requests, refuses while a booking is `dispatching`, deletes every row of every table that references the account except the handle history and audit, deletes the Auth user, marks the account suspended and nameless with `deleted_at`, and writes an `operator_operations` row. Durable jobs already take a `run_after`, and transactional email is the `email_deliveries` outbox, whose rows today all belong to a request.

## Decisions

### D1. The schedule is a column and one delayed job

`app.host_accounts.deletion_due_at timestamptz` holds the due time; null means nothing is scheduled. A check keeps it null on a deleted account. Scheduling publishes one `host_deletion` job with `run_after` at the due time and the dedupe key `host:{id}:{due}:{retryKey}`, whose payload names the account and the due time. The job runs the deletion only when the account's `deletion_due_at` still equals its payload's due time and has passed; otherwise it completes as `cancelled` and does nothing. Cancelling therefore only clears the column, and a later schedule publishes a new job with a new key, so an old job can never run a newer schedule early.

Rejected: a pg_cron sweep over due accounts | it adds a schedule and a publisher function for what one delayed job already does. Rejected: a status value such as `pending_deletion` | `status` is the operator's suspension decision and is read by every eligibility check; the host stays active during the grace period.

### D2. Scheduling is a command

`POST /api/host/account-deletion` takes `{ confirmation, retryKey }`, refuses cross-site requests like every host mutation, authenticates an eligible host, and runs `host.schedule_deletion` through `runCommand`, so a retry replays the same outcome. The command locks the account, compares the confirmation with the current handle (or, without a handle, the Google address), lower-cased and trimmed, and fails `validation` on a mismatch. An account already scheduled keeps its due time and publishes nothing new. Otherwise it sets `deletion_due_at = now() + 7 days`, publishes the job and queues the scheduled email, all in the command's transaction. The route then signs the session out with Supabase's global scope, which revokes the host's refresh tokens in every browser, clears this browser's cookies, and returns the due time; the dialog then goes to `/app?deletion=scheduled`, whose sign-in card says that signing in before then cancels the deletion. Another browser's access token stays valid until it expires (at most an hour); using it does not cancel anything, only a new sign-in does.

### D3. Signing in cancels

`completeGoogleSignIn` already runs one transaction per sign-in. For an active account it now locks the account row, refuses the sign-in if the deletion ran meanwhile, and clears `deletion_due_at` when set and queues the cancellation email before writing the Calendar grant. The sign-in itself is unchanged. An agent token, an MCP client or a linked chat does not cancel: the proposal names signing in, and those are not sign-ins.

### D4. Running reuses the operator function

The `host_deletion` handler runs in the job's transaction. It locks the account row, checks D1's condition, reads the host's Google address and display name and every open request (`gathering`, `negotiating`, `awaiting_host_approval`, `booking`) with a contact address, then calls `app.operator_delete_host(id, 'self-service', 'requested by the host in Settings', environment)`. A `booking in flight` refusal is thrown as a retryable failure, so the job backs off and tries again, with up to 100 attempts (about four days at the hourly cap); the account keeps its schedule meanwhile, and scheduling again replaces a job that spent its attempts. The handler and `operator_delete_host` lock the account `FOR NO KEY UPDATE`, which the foreign-key checks of a concurrent approval do not wait on, so the two cannot deadlock. After the call it queues the guest notices and the host's completion email. All of it commits together with the job's completion, so a failure deletes nothing and sends nothing.

### D5. Account emails

`email_deliveries.kind` gains `account_deletion_scheduled`, `account_deletion_cancelled`, `account_deletion_completed` and `host_account_closed`. Their `request_id` is null, so deleting the host's requests does not cascade to them, and their parameters carry `hostAccountId` (and `dueAt` on the scheduled email). At dispatch the recipient check reads the account: scheduled needs the same `deletion_due_at`; cancelled needs none set and the account not deleted; completed and the guest notice need `deleted_at`. They are plain English and Korean messages without links that grant access: the host's carry a link to `/app`, the guest's none. The host's are English, like the host's booking copies; the guest's use the request's language. A retention rule `account_emails` deletes them 30 days after they reach a final state, as the notice already says of email records.

### D6. Chats point to Settings

`agent/instructions/base.md` gains a standing rule: never delete an account or claim to; when a host asks, send the Settings link `https://findmeatime.com/app?settings=account` and say the step there is confirmed by typing the handle and can be cancelled by signing in within 7 days. `host-imessage.ts` gives linked chats the same link built from `APP_ORIGIN`, and the MCP server instructions say the server cannot delete an account and name the same link. No tool gains a deletion action.

### D7. Notice and terms

`/privacy`'s **Deleting your data** section and retention list, and `/terms-of-service`'s host and ending items, describe the Settings step first and keep `support@` for anyone who cannot sign in, in both languages.

## Risks

- A host who schedules and then signs in by habit cancels without meaning to. The cancellation email says so and that they can schedule again.
- The global sign-out cannot end an access token another browser already holds; it lapses within the hour and does not cancel.
- An open request's guest gets the closure notice only by email, not on a linked chat. Guests on chats still see the request closed when they next open it.

## Testing

- Unit: confirmation matching, the email copy in both languages, the route's input validation.
- Integration (local stack): scheduling (mismatch, idempotent retry, job and email queued, signed-out session), cancellation on sign-in and a later reschedule, the job running a due deletion with the audit row, guest and host emails and a reserved handle, a stale job doing nothing, a booking in flight retried, the recipient checks, the retention rule.
- Browser (Playwright): a host signed in through the real local Auth flow opens `/app?settings=account`, types the handle, schedules, and lands on the sign-in card with the notice.
