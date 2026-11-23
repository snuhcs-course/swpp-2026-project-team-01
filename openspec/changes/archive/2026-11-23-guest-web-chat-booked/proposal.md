# Proposal

Tracking issues: #329 (a booked guest page has no conversation) and #373 (the guest composer locks again mid-conversation). Follows [`post-booking-changes`](../../post-booking-changes/proposal.md).

## Why

`post-booking-changes` lets a guest cancel or change a booked meeting by asking the assistant "in their conversation (booking page, email, iMessage or Telegram)", and the testing baseline's M01 Acceptance 4 expects it on the booking page. The booking page did not keep the conversation: once booked, `/booking/[bookingId]` showed only the receipt, so a guest who linked no messenger and does not reply by email had no way to cancel or change on the web. The conversation layer and the agent already admitted a booked request (guest-flow-completion U18); only the booking page and its routes refused it. On 2026-11-23 the repository owner decided the booked page keeps the guest chat (#329).

On the same page the composer locked with "Finish the step above, then you can write to Thyme here" whenever the Calendar step was open, including after the guest had already been writing to Thyme: a second Google sign-in that grants Calendar, **Change your calendar** (manual availability off) or a host profile's calendars removed clears `calendar_settled_at`, and the reopened Calendar card sat at the top of the thread, out of view. A request that left choosing with the Calendar step unsettled kept the lock with no step to finish, and a request that ended while its page was open said nothing about why (#373).

## What Changes

- A booked meeting's booking page keeps the guest's conversation while its link lasts: the earlier conversation, the confirmed receipt with Thyme's line on moving or cancelling it, and an open composer. The messages, events, intake transcript and recovery routes admit a booked request as the conversation layer does; the request's other data routes stay closed. The closed booked view carries the conversation status. When a turn settles the page reads the request again, so a cancellation shows the closed status and a change opens the usual guest workspace.
- The request view says whether the fixed steps have handed the guest over to Thyme: the Calendar step was settled, the request has a purpose, or the guest has written in the conversation. The composer locks only before that first handover and only while a fixed step is open.
- After the handover, a Calendar step that reopens leaves the composer usable; its card moves to where the thread is now, under Thyme's line saying it is open again and what to do.
- A request that has ended while its page is open closes the composer with the reason.

## Decision

#373 asked whether reopening the Calendar step should lock the composer once the guest has been handed over. It does not: the guest already talks to Thyme, a lock there points at a step they did not choose to repeat, and the open Calendar card is enough to say what is asked. Nothing on the server needs the Calendar step settled before a message.

## Capabilities

### Modified Capabilities

- `meeting-requests`: protected request continuation keeps a booked request's conversation on its link; the booking page composer's lock is defined.

## Impact

`lib/server/requester-routes.ts` (`conversingRequester`, the closed booked view's conversation, `handedOver`), `lib/contracts/requester-view.ts`, `apps/web/app/booking/[bookingId]/page.tsx`, `apps/web/app/_components/guest/` (`booked-workspace.tsx`, `composer-state.ts`, `guest-workspace.tsx`), the [guest booking flow](../../../../documentations/user_experience/06_guest_booking_flow.md) G11 and G5. No schema change.
