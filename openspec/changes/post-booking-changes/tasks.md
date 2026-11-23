# Tasks

## Documents

- [x] Remove the PRD non-goal and describe cancellation and changes after booking (FR-43, AC-35); update the guest booking flow G11, the other UX documents, the technical specification and the decision log; regenerate the Korean mirrors that exist.

## Cancellation (step 1)

- [x] Schema: request state `cancelled`; a cancelled booking may keep `confirmed_at`; email kinds `status_cancelled` and `booking_cancelled`; generate and review the migration.
- [x] `deleteEvent` on the host calendar client, with `sendUpdates=all` and classified outcomes.
- [x] `booking.cancel` for the host and the requester, and the `booking_cancel` job that deletes the event and tells the host when it cannot.
- [x] Notices: the guest's `status_cancelled` email and chat message, the host's `booking_cancelled` email and chat message, and `booking_event_left`.
- [x] Tools: the guest assistant's and the guest MCP `cancel_booking`; the host-review assistant's `cancel_booking` for linked chats; the host MCP `cancel_booking` with `hostInstruction`; assistant instructions.
- [x] Host workspace: **Cancel meeting** with a confirmation on the booking card; the guest page shows a cancelled meeting.
- [ ] Run the extended `tests/e2e/host-review.test.ts` (cancels from the booking card); not run in the implementing session.
- [x] Unit tests (calendar client, email copy, MCP tool shape) and integration tests (command authority and refusals, job outcomes, notices, the guest, host-chat and MCP tools).
- [x] Cover the linked-chat notice texts (`status_cancelled`, `booking_cancelled`, `booking_event_left`) in an integration test with an active binding (`tests/integration/booking-cancellation-chats.test.ts`).
- [ ] Run `tests/integration/booking-cancellation-chats.test.ts` against the local stack; not run in the implementing session.
- [ ] Try it end to end against a personal Supabase project and a real Google Calendar (Google's cancellation email to the guest is not covered by automated tests).

## Changes (step 2)

- [x] Write the change delta (design 5, D6): reopen to `negotiating` with the confirmed booking standing.
- [x] Schema: `replaces_booking_id`; one booking in progress and one confirmed per request; event IDs unique among original bookings; email kind `status_change_dropped`.
- [x] `booking.change` for both sides; leave the meeting's own event out of busy time in evaluation, agreement and revalidation.
- [x] Book an approved change by patching the existing event (`patchEvent`), then cancel the replaced booking as `changed`; confirmations say the meeting changed.
- [x] Withdrawal, decline and expiry drop the change and keep the meeting; decline and expiry tell the guest (`status_change_dropped`); cancellation during a change cancels the meeting.
- [x] Tools: `change_booking` for the guest assistant, the guest MCP, the host's linked chat and the host MCP; **Change meeting** on the host's booking card and a note while a change is open; assistant instructions.
- [x] Tests: unit (`patchEvent`, email copy) and integration (reopen, own time offered again, patched approval, withdraw, decline, expiry, cancel midway).
- [x] Remove a Meet link when a booked online meeting changes to in person (`changePatchBody` in `lib/server/bookings.ts`: `conferenceData: null`, and `location: null` when the change has no place), with unit tests; a meeting on the guest's own link shows that link (`bookingJoinUrl`); the fake Google drops the Meet on `conferenceData: null`, and `booking-changes.test.ts` covers a change to the guest's link (written, not run).
- [ ] Try a change end to end against a real Google Calendar.

## Review

- [ ] Review with the team, then archive into `openspec/specs/meeting-requests/spec.md` and `openspec/specs/email-delivery/spec.md` and close #234.
