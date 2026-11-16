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

## 5. Changes after booking (step 2, D5 and D6)

**Reopening.** `booking.change`, by either side until the meeting starts, moves a booked request back to `negotiating` (no new state, D6): `closed_at` is cleared, the revision advances, and `expires_at` becomes the earlier of seven days from now and the meeting's start. The confirmed booking stays confirmed; a request that is open while it has a confirmed booking is "changing". Neither side needs the other's leave to reopen: nothing changes for the other side until they agree or approve. The guest reopens through `change_booking` (assistant or MCP), the host with **Change meeting** on the booking card (which then opens the suggestion editor), `change_booking` in their linked chat, or their MCP agent.

**The usual flow.** The guest drafts new availability or details and chooses a time; the host suggests changes and shares them. Agreement and approval run unchanged. Evaluation, the agreement recheck and booking revalidation leave the meeting's own event out of both calendars' busy time (by its event ID or iCalUID), and revalidation leaves out the request's own bookings, so the change may overlap its own old time. The weekly limit already left out the request's own bookings.

**Booking the change.** Approval of a newer version while a confirmed booking stands reserves a second booking with `replaces_booking_id` naming it, on the same calendar and event ID. Its job revalidates as any booking, freezes the payload and patches the event (`events.patch`, `sendUpdates=all`, `conferenceDataVersion=1`) with the time, place, title and description, leaving the ID and attendees; a conference is sent only when the event has none, so an existing Meet stays. Patching again is harmless, so an uncertain outcome retries the patch; a missing event fails the change as `event_removed`, a refusal as `calendar_rejected`, and the request waits for approval again with the original still booked. On confirmation, in one transaction, the replaced booking is cancelled as `changed`, the change confirmed and the request booked again. Both parties get the confirmation email, saying the meeting changed, without the calendar part, since Google's update carries the invitation. The schema allows one booking in progress and one confirmed booking per request, and an event ID shared by a booking and the changes that replace it.

**Leaving a change.** Withdrawal by the guest, decline by the host and expiry each drop the change: a change still reserved is cancelled (one already dispatching answers `booking_pending`), and the request is booked again with the meeting as it was. A decline or an expiry tells the guest by the `status_change_dropped` email and chat message. A cancellation during a change cancels the meeting itself and any reserved change.

**Not covered.** Switching a booked online meeting to in person keeps its Meet link on the event; the event's location changes.

## Alternatives

- **Keep the request `booked` and cancel only the booking.** Every projection, list and email would show a cancelled meeting as booked unless each also read the booking. Rejected.
- **Delete the event inside the command.** A Google call inside the command's transaction holds the request lock across the network, and an uncertain outcome has nowhere to go. Rejected for the job, which the booking path already uses.
- **Cancel and book again for a change.** Google would send a cancellation and a new invitation, and the guest would see the meeting disappear. Rejected for an in-place update.
- **A separate `rebooking` request state.** Every proposal, agreement and approval guard would need to admit it. Rejected for reopening to `negotiating` and recognising a change by its standing confirmed booking (D6).
