-- Counts the channel use the sources still hold (channel-usage-report design 4):
-- receipts and ended bindings are kept for 30 days, so the last 30 UTC days can
-- be counted once; the oldest of them may be partial. Data only, kept apart from
-- the generated schema migration.
SELECT app.record_channel_usage(30);
