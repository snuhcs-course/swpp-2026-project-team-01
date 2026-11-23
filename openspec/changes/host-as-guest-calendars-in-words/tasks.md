# Tasks

## 1. Server

- [x] 1.1 `request.host_profile.calendars` (`requester-host-profiles.ts`): set the Calendars item for one request, keep the decision time, settle or reopen the Calendar step as D2 says, and report the outcome; `readHostCalendarsView` for the projection.
- [x] 1.2 `use_host_calendars` in the requester discussion (`request-tools.ts`, `agent/tools/request.ts`) and on the account connection (`agent-requester-tools.ts`, `agent-account-requester-tools.ts`), not on a per-host connection.
- [x] 1.3 Routing: while a sent request is selected, `impliesOwnSetup` sends a message about the host's own meetings to setup (`imessage-receipts.ts`).

## 2. Agent

- [x] 2.1 Requester instructions: `yourHostCalendars`, all or none, and pointing a general change to setup.
- [x] 2.2 The sent `update_request_details` description names `update_setup_field` for a general change.

## 3. Documentation

- [x] 3.1 Update the testing baseline R01 rows and the agent configuration tool tables, and regenerate their `ko/` mirrors.

## 4. Tests

- [x] 4.1 Unit: the command outcomes and writes, the tool sets, `impliesOwnSetup`.
- [x] 4.2 Evals: `evals/requester/host-calendars.eval.ts` and `own-setup.eval.ts` (live model; not run here).
