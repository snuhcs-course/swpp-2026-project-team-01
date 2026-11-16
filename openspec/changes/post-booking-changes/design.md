# Design

## Context

A request closes as `booked` when the booking job confirms its Google event (`lib/server/bookings.ts`). Closure revokes the guest's grants and supersedes pending reviews (`closeRequest` in `lib/server/request-lifecycle.ts`), but keeps the guest's conversation, which answers questions about the meeting while the booking link lasts (G11, U18). Withdrawal and decline cancel only a booking that is still `reserved`; once dispatch may have begun nothing is undone (host-review-and-booking design 11). The event is written to the host's booking calendar under an ID fixed before dispatch, with `sendUpdates=all`, so the guest is a Google attendee and receives Google's invitation.

## 1. Who may cancel, and until when (D1)

The guest of the request and its host may each cancel a confirmed booking until the meeting's start time, read from the database clock. After the start, `booking.cancel` refuses with `invalid_input` (`start_passed`). A request still `booking` (the event write is in progress) refuses with `booking_pending`; a request that was never booked refuses with `invalid_input` (`not_booked`); one already cancelled refuses with `request_closed`, which the tools report as already cancelled.

The guest acts through `booking.cancel` from the booking page's command route, from the guest assistant's `cancel_booking` tool (web, email, iMessage and Telegram conversations), or from their agent's `cancel_booking` MCP tool under `request:decide`. The host acts through **Cancel meeting** on the booking card in the workspace, through the host-review assistant's `cancel_booking` tool only for a message from their linked iMessage, WhatsApp or Telegram (as `decline_request`), or through their agent's `cancel_booking` MCP tool under `host:decide` with the host's own words as `hostInstruction`. Every path asks once and acts only on a clear yes; a guest's message never cancels for the host, nor a host's for the guest.

The guest assistant's fence admits a booked or cancelled request for reading and for `cancel_booking` only; nothing else changes a closed request.

## 2. State (D2)

`booking.cancel`, under the request lock, the per-host advisory lock and the booking row lock:

- moves the confirmed booking to `cancelled` with `failure_category` `host_cancelled` or `requester_cancelled` and `settled_at` now; it keeps `confirmed_at` and the evidence, so a cancelled booking still shows what was booked;
- moves the request from `booked` to `cancelled`, advancing the revision and `closed_at`;
- publishes the `booking_cancel` job and records the other side's notices (section 4).

`cancelled` is a closed state: it never reopens, the expiry sweep ignores it, and replays return the saved outcome. A cancelled booking is no longer live, so the host's revalidation stops counting it as busy, and the slot is free for other guests once Google deletes the event.

The schema allows a cancelled booking with `confirmed_at` (`bookings_confirmed` now says only that a confirmed booking has it, and that an unconfirmed one that was never cancelled does not).

## 3. The Google event (D3)

The `booking_cancel` job reads the booking by ID, opens the host's calendar and calls `events.delete` on the booking calendar and event ID with `sendUpdates=all`, so Google sends the guest its own cancellation. A 2xx, 404 or 410 means the event is gone. A network failure, a timeout, a rate limit or a 5xx is retried (8 attempts); deleting again is harmless. A 400 or 403 refusal, or a revoked or missing Calendar grant, ends the job and records the host notice `booking_event_left`, which asks the host to remove the event from Google Calendar themselves; the request stays cancelled.

## 4. Telling the other side (D4)

The side that cancelled sees the outcome in its own conversation or card. The other side is told:

- **Host cancelled.** The guest gets the `status_cancelled` notice: an email from the product inbox in their thread (or the no-reply email with the booking link when there is no inbox), and a message in their linked iMessage or Telegram conversation. Google's cancellation arrives separately.
- **Guest cancelled.** The host gets the `booking_cancelled` notice in their linked iMessage, WhatsApp or Telegram conversation, and a `booking_cancelled` email with a link to the request in `/app`. Google sends the host nothing for their own event's deletion.

Each email is still current only while the request is cancelled. Neither carries a reason; a reason a person gives stays in their own conversation.

## 5. Changes after booking (step 2, D5; not implemented in this change)

To be implemented as its own task list below, adding its own delta before this change is archived:

- Either side asks for another time or place. The guest's assistant drafts the change as a review; the host drafts it with **Request changes** as today. Either creates a new proposal version on the booked request, which moves from `booked` to a new open state, `rebooking`, that keeps the confirmed booking live.
- The guest agrees and the host approves through the existing commands. Approval reserves a second booking row for the new version against the same event ID; the booking job patches the event (`events.patch`, `sendUpdates=all`) instead of inserting, so the invitation thread stays the same, then settles the old booking as superseded and the request as `booked` again.
- A new version that is never agreed or approved expires back to the original booking, which stood the whole time. Cancelling during a change cancels the original meeting.

The open questions for that step: whether `rebooking` counts against the host's weekly limit twice, and whether the guest may propose a change without the host's first approving a reopening.

## Alternatives

- **Keep the request `booked` and cancel only the booking.** Every projection, list and email would show a cancelled meeting as booked unless each also read the booking. Rejected.
- **Delete the event inside the command.** A Google call inside the command's transaction holds the request lock across the network, and an uncertain outcome has nowhere to go. Rejected for the job, which the booking path already uses.
- **Cancel and book again for a change.** Google would send a cancellation and a new invitation, and the guest would see the meeting disappear. Rejected for an in-place update.
