# Tasks

## Database

- [x] Add `app.channel_usage_days`, `app.record_channel_usage_day`, `app.record_channel_usage` and `app.operator_channel_usage_report` to the declarative schema, with the hourly `app-channel-usage` schedule.
- [x] Generate the migration with pg-delta, add the data-only backfill migration, and rebuild the local database with `supabase db reset --local`.
- [x] Cover the day's counts, the boundaries, moved bindings, sample requests, changes after booking, idempotent recounts, counts outliving their sources and the day and week report in `supabase/tests/channel_usage.test.sql`.

## Operator command

- [x] Add `diagnostics usage` to the administrator CLI with `--by`, `--periods`, `--until` and `--json`; cover its arguments in the unit tests and its output in `tests/integration/diagnostics.test.ts`.

## Documents and review

- [x] Describe the command in the operations runbook of the provider setup and regenerate its Korean mirror.
- [x] Review with the team, deploy the migrations through CI, then archive the change into `openspec/specs/operational-diagnostics/spec.md` and close #344.
