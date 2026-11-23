# Tasks

## 1. Recheck on agreement

- [x] 1.1 Make `agreeCommand` read the host's calendars for the proposed interval with `checkInterval` before recording agreement; on a conflict publish a new evaluation at the same revision and answer `time_unavailable`; on a provider failure or the deadline agree as before. Verify with integration tests for a newly busy interval and an unreadable calendar.
- [x] 1.2 Pass the evaluation dependencies through the requester route, the guest conversation tool and the requester MCP tool, and say what `time_unavailable` means in each. Verify typecheck and the agreement integration suites.
- [x] 1.3 Show on the proposal card that the time is no longer free and nothing was agreed. Verify typecheck.
- [x] 1.4 Update G7 in `documentations/user_experience/06_guest_booking_flow.md`. Verify `npm run check`.

## 2. Archive

- [ ] 2.1 After merge and verification on the shared deployment, archive this change into `meeting-requests`.
