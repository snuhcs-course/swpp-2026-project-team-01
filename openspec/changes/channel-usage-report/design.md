# Design

## Context

See [proposal.md](proposal.md). The receiver stores every verified inbound message of the three channels in `app.imessage_receipts` with its `channel`. A host's linked sender is a row of `app.imessage_bindings` (one active per host), a guest's is a row of `app.requester_imessage_bindings` on one request. `app.cleanup_imessage_records` deletes receipts 30 days after they arrive and bindings 30 days after they end. The operator CLI already has two read-only diagnostics commands (operations-and-release design 4 and 5) that call one database function and print its JSON.

## Decisions

### 1. Daily counts in their own table

The counts are kept in `app.channel_usage_days`, keyed by UTC day and channel, with `active_hosts`, `inbound_messages`, `guest_links` and `guest_bookings`. A row holds counts and a recording time only, so it says nothing about any host, request, sender or message and can be kept without a retention limit: at three rows a day it stays small. The table has row-level security and no policy, like every application table, so only the operator's server credential reads it.

A day, not an hour, is the unit: it is the finest grain a trend over weeks needs, and hourly counts of a handful of hosts would come closer to describing one person's day.

Rejected: GA4 Measurement Protocol events | messaging activity would leave for Google and the privacy notice would need new wording. Rejected: counting at write time in the receiver and binding paths | each path would need a second write that can fail or double-count, and the counts could not be corrected; recounting from the sources is idempotent. Rejected: keeping receipts longer | they are the sensitive rows the 30-day retention exists for.

### 2. Recounted hourly from the sources

`app.record_channel_usage_day(day)` counts one UTC day for all three channels and upserts the three rows, zeros included:

- `active_hosts`: distinct hosts with a host binding on the channel that was active at any time in the day (linked before its end, ended after its start or not at all).
- `inbound_messages`: receipts received on the channel that day, whatever their outcome.
- `guest_links`: distinct requests whose guest binding on the channel was created that day. A binding moved to a revised request is not a new link. A request does not record which channel its conversation started in, so a guest link is the closest measure of a request carried on by a channel the schema holds.
- `guest_bookings`: original bookings (not changes after booking) confirmed that day on requests whose guest linked the channel.

Sample requests are left out. `app.record_channel_usage(days_back)` counts the current UTC day and the days before it, at most 30, so every source row is still there. pg_cron runs `app.record_channel_usage(7)` at 23 minutes past every hour (`app-channel-usage`), so the current day is at most an hour behind and a missed run is caught up within a week. A day older than seven days is no longer recounted and is final; until then, a host or request erased on request leaves its counts, which matches account deletion.

Rejected: recounting only today and yesterday | one day of pg_cron downtime would leave a day permanently uncounted. Rejected: recounting all 30 days | it repeats work for no gain and would let deletions reach back a month.

### 3. The operator report

`app.operator_channel_usage_report(period, count, until)` returns, per channel in a fixed order, the last `count` UTC days (at most 90) or ISO weeks starting on Monday (at most 52) ending with the period that contains `until` (today when null). Each period has its start date, the counts, and `recordedDays`, the number of its days that have a row. A week sums its days, except `active_hosts`, which is its highest day, since hosts cannot be summed across days. The report also gives its window, the first recorded day, the last recording time and notes on what each count means. It reads only and recounts nothing.

`npm run admin -- diagnostics usage --operator <name> (--local | --project <ref>) [--by day|week] [--periods <n>] [--until <YYYY-MM-DD>] [--json]` prints it as lines, one per channel and period, marking a period that was not recorded or only partly recorded, or as the JSON object with `--json`. Defaults are 14 days or 8 weeks. Like the other diagnostics commands it names exactly one environment and refuses bad arguments before reaching the database.

### 4. Backfill

A separate data-only migration, `channel_usage_backfill`, runs `app.record_channel_usage(30)` once, so the trend starts with the month the sources still hold rather than on the deployment day. Its oldest day may be partial, because receipts are deleted every 15 minutes as they pass 30 days; the report's `recordedFrom` shows where the counts begin.

## Risks

- The counts are best effort, as the sources are: a receipt is stored only for a verified webhook, and a message that never reached the receiver is not counted. The report's notes say so in its terms, and an empty report is not proof that a channel works.
- A host or request deleted within seven days of a day lowers that day's counts. This is accepted: an erased person's activity should not stay countable as recent detail.
