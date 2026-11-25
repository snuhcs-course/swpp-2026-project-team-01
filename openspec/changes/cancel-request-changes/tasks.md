## 1. Restore command

- [x] 1.1 Capture bounded requester rollback snapshots when an agreed request or booking reopens; expose safe rollback availability.
- [x] 1.2 Add the authorized, revision-checked Cancel changes command restoring the host decision state or standing booking and preserving immutable history.

## 2. Guest card

- [x] 2.1 Use the approved What would you like to change? title and Find a new time / Edit details / Cancel changes actions while editing a meeting.

## 3. Validation and delivery

- [x] 3.1 Verify rollback planning, authorization, revisions, retries, expired starts, unchanged booking and host-facing status with meaningful tests; execute isolated PostgreSQL regressions and report the full-stack coverage gap separately.
- [ ] 3.2 Run lint, type checks and relevant unit tests, validate OpenSpec, then commit, open a PR and close the requested tracking issues.
