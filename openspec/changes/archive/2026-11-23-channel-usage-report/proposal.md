# Proposal

Tracking issue: #344

## Why

The team can see how the web app is used (`web-analytics`, #343), but not how hosts and guests use the messaging channels: iMessage, WhatsApp and Telegram. Chats have no browser, so the Google Analytics tag cannot see them, and sending chat events to Google through the Measurement Protocol would put messaging activity with a third party and need new privacy notice wording. The operations-and-release measurement approach (D1, D2) already counts from our own database. But the rows to count from, receipts and ended bindings, are deleted after 30 days, so a trend longer than a month needs counts kept apart from them.

## What Changes

- A new table, `app.channel_usage_days`, keeps one row per UTC day and channel with four counts and nothing else: hosts with an active host binding, inbound messages, requests whose guest linked the channel, and original bookings confirmed on those requests.
- An hourly pg_cron job recounts the last seven days from the receipts, bindings, requests and bookings, so the counts outlive the 30-day deletion of their sources. A one-time migration counts the 30 days the sources still hold.
- A read-only operator command, `npm run admin -- diagnostics usage`, prints the counts per channel by UTC day or ISO week, zero-filled, saying which periods were not recorded. It prints counts and dates only.

## Capabilities

### Modified Capabilities

- `operational-diagnostics`: adds counts-only channel usage records and their read-only report.

## Impact

`supabase/schemas/app/tables/channel_usage_days.sql`, `supabase/schemas/app/functions/channel_usage.sql`, `supabase/schemas/app/cron/channel_usage.sql`, a generated migration and a data-only backfill migration, `supabase/tests/channel_usage.test.sql`, `lib/server/diagnostics-admin.ts` and its unit test, `tests/integration/diagnostics.test.ts`, and the operations runbook in the [provider setup](../../../../documentations/technical_specification/03_provider_setup.md#daily-diagnostics) with its Korean mirror. No application code path writes the counts, no message, sender or identifier is stored with them, and nothing is sent to a third party, so the privacy notice is unchanged.
