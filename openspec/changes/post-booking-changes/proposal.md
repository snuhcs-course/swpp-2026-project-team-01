# Proposal

Tracking issue: #234 (renegotiation after booking, asked for in #169)

## Why

Once a meeting is booked, neither side can cancel or change it through Find Me a Time. The guest assistant tells the guest to contact the host directly, and the host edits the Google Calendar event by hand. The PRD listed "Automated post-booking rescheduling and cancellation" as a non-goal for the initial release. The TA asked the team to show renegotiation after booking (#169): travel between meetings makes a booked time stop working, and the two sides agree on another one. On 2026-11-16 the user decided the product supports changes after confirmation, cancellation first and changes second, within Iteration 4 (ends 2026-11-20).

## What Changes

Step 1, cancellation (implemented in this change):

- The guest or the host can cancel a booked meeting until it starts. The guest asks the assistant in their conversation (booking page, email, iMessage or Telegram) or through their agent (MCP or CLI); the host asks the assistant in their linked iMessage, WhatsApp or Telegram, presses **Cancel meeting** on the booking in the workspace, or tells their agent. The assistant asks once and cancels only after a clear yes.
- A cancelled meeting's request becomes **cancelled**, a new closed state. The booking is cancelled with who cancelled it.
- The Google Calendar event is deleted with updates sent, so Google sends the guest its cancellation. If Google refuses the deletion or the host's calendar access is gone, the host is told to remove the event by hand.
- The other side is told through their usual channel: a guest by email (in their thread when they have one) and in their linked chat; a host by email and in their linked chat.

Step 2, changes (implemented in this change):

- Either side reopens a booked meeting, until it starts, for another time, place or meeting type: the guest through the assistant or their agent, the host with **Change meeting** in the workspace, in their linked chat or through their agent. The request reopens on the existing proposal flow (new version, guest agreement, host approval) while the booked meeting stays as it is. On approval the existing Google event is patched in place, so the invitation thread stays the same. If the change is withdrawn, declined or runs out of time, the original meeting stands and the guest is told.

## Decisions

Taken on 2026-11-16 by the session that wrote this change, for the user's decision on #234, with no teammate review yet:

| # | Choice | Alternatives |
|---|---|---|
| D1 | Either side may cancel, until the meeting's start time; nothing is cancelled after it starts | A cut-off hours before the start; host only |
| D2 | A new closed request state, `cancelled`, and booking failure categories `host_cancelled` and `requester_cancelled` | Keeping the request `booked` with only the booking cancelled; reopening the request |
| D3 | The command commits the cancellation and a `booking_cancel` job deletes the event, retrying an uncertain outcome; a definite refusal tells the host | Deleting inside the command; holding the request in a `cancelling` state until Google answers |
| D4 | Google's own cancellation reaches the guest (`sendUpdates=all`); our notice goes only to the side that did not cancel | Notifying both sides; relying on Google alone |
| D5 | Changes reuse the proposal and host-approval flow and update the event in place | A separate reschedule flow; cancelling and booking again |
| D6 | A change reopens the request to `negotiating` with its confirmed booking standing; a second booking row replaces it on approval and patches the same event | A new `rebooking` request state; changing the confirmed booking row in place |

## Capabilities

### Modified Capabilities

- `meeting-requests`: the lifecycle gains `cancelled`; a booked meeting can be cancelled or changed by either side before it starts.
- `email-delivery`: requester status notifications include a cancellation by the host and a dropped change; the host is emailed when the guest cancels; a changed meeting's confirmation says it changed.

## Impact

Schema: `app.requests` (state `cancelled`), `app.bookings` (a confirmed booking may be cancelled; `replaces_booking_id`; one booking in progress and one confirmed per request; event IDs unique among original bookings), `app.email_deliveries` (kinds `status_cancelled`, `booking_cancelled`, `status_change_dropped`). Server: `lib/server/booking-cancellation.ts` (the `booking.cancel` command and the `booking_cancel` job), `lib/server/google-calendar.ts` (`deleteEvent`), notices and emails, the guest, host-review and MCP tools, the host workspace's booking card. Documents: the [PRD](../../../documentations/02_product_requirements.md), the [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md) G11 and the [decision log](../../../documentations/technical_specification/08_decision_log.md).
