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
- [ ] Cover the linked-chat notice texts (`status_cancelled`, `booking_cancelled`, `booking_event_left`) in an integration test with an active binding.
- [ ] Try it end to end against a personal Supabase project and a real Google Calendar (Google's cancellation email to the guest is not covered by automated tests).

## Changes (step 2)

- [ ] Write the `rebooking` delta (design 5) and settle its open questions.
- [ ] Reopen a booked request on a new proposal version while the confirmed booking stays live.
- [ ] Book an approved change by patching the existing event in place, and settle the old booking as superseded.
- [ ] Let the guest and host assistants ask for a change after booking; update the guest assistant's instructions.
- [ ] Tests for a change approved, abandoned and cancelled midway.

## Review

- [ ] Review with the team, then archive into `openspec/specs/meeting-requests/spec.md` and `openspec/specs/email-delivery/spec.md` and close #234.
