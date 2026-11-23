# Tasks

## 1. Tool results

- [x] 1.1 Move the requester status and next-step texts to `lib/server/request-status-texts.ts`, with `meetingPhase`, a started and ended booked text, a `booking` text that says nothing changes until booked, and `nextSteps` by state. Verify with unit tests (#277, #278).
- [x] 1.2 Give `read_request` and `read_booking_status` `now` and the booking's `phase`, and use the state's texts; reword the `change_agreement` refusal and the `change_booking` result. Verify typecheck.

## 2. Instructions

- [x] 2.1 Update the requester fragment for #277 to #283 and the `read_request` and `change_agreement` tool descriptions.

## 3. Evaluation

- [x] 3.1 Append GU-A01 to GU-A07 to the guest story set and record them in documentation 13.
- [ ] 3.2 Run the guest story set three times (GU-05, GU-19, GU-21, GU-26, GU-31, GU-50, GU-R06 and GU-A01 to GU-A07 at least) and record the result in documentation 13. Needs a paid model run.
- [ ] 3.3 Run the request tools integration suite against a local Supabase stack.

## 4. Archive

- [ ] 4.1 After the run and merge, archive this change into `meeting-requests`.
