# Current request copy and conditions

This inventory describes the host Requests UI on `origin/main` at `7a610070`, before the accordion replaces the separate request screen. The standalone prototype uses filled example data shaped from those responses; its action buttons do not send commands.

## Data sources and selection

- The collapsed list reads `GET /api/host/workspace-requests`. Received rows come from `listHostRequests`; sent rows come from verified requester-account matches. The list exposes `state`, `needsDecision`, `proposalStart`, and the other party's name and purpose.
- Expanding a received request reads `GET /api/host/requests/{requestId}`. Its `HostRequestView` contains the latest proposal's `version`, times, details, and `agreedAt` (from `app.proposals` and `app.agreements`), plus `app.requests.state`.
- The current separate request screen chooses one card using `nextHostStep`: editor, suggestion, booking, rule/travel review, proposal, then no-proposal fallback. The ordering matters: a newer step can hide a proposal card even when a proposal exists.

## Proposal card: label, heading and description

The small label is always `Proposal, version N`, where `N` is the latest proposal version in the detailed response. The current `ProposalReviewCard` has exactly two heading/description branches:

| Condition | Heading | Description |
| --- | --- | --- |
| Request state is `awaiting_host_approval` **and** the latest proposal has a non-null `agreedAt` | `Approve this meeting?` | `<requester name> agreed to these exact details. Approving books the meeting in your calendar.` |
| Every other state/consent combination when this card is chosen | `Waiting for the requester` | `The requester has not agreed to this version yet.` |

The second branch includes a withdrawn request with a retained proposal. That explains why the supplied screenshot can show **Withdrawn** on the list and **Waiting for the requester** on the separate detail screen. The latter is misleading for a closed request; the accordion prototype instead labels the expanded closed request with its closed state.

## Collapsed card: right-side label

The list determines this label before the detailed request is fetched.

| Priority / request state | Received request | Sent request |
| --- | --- | --- |
| `needsDecision = true` | `Needs your decision` | Not used; sent rows always have `needsDecision = false` |
| `awaiting_host_approval` without the first override | `Waiting for your approval` | `Awaiting approval` |
| `booked` | `Booked` | `Booked` |
| `booking` | `Booking in progress` | `Booking in progress` |
| `cancelled` | `Cancelled` | `Cancelled` |
| `declined` | `Declined` | `Declined` |
| `expired` | `Expired` | `Expired` |
| `gathering` | `Gathering details` | `Gathering details` |
| `negotiating` | `Choosing a time` | `Choosing a time` |
| `withdrawn` | `Withdrawn` | `Withdrawn` |
| `draft` | `Draft` in the label map, but drafts are filtered out of both lists | Same |

The received-list query sets `needsDecision` when `app.requests.state = 'awaiting_host_approval'` **or** a pending `app.shared_change_drafts` row exists. Therefore a normally loaded received request awaiting approval shows **Needs your decision**, rather than **Waiting for your approval**. The detailed `HostRequestView.needsDecision` calculates additional rule/travel cases, but the collapsed list does not use that calculation. **Waiting for the requester** is not a collapsed-card label on main.

## Other headings and descriptions on the separate request screen

These appear when a higher-priority card replaces proposal review.

| Card / condition | Heading | Description |
| --- | --- | --- |
| Request-changes editor is open | `What should change?` | `Times are in your time zone, <zone>. Nothing is shared until you review the suggestion and press Share revised details.` |
| Suggestion is `checking` | `Checking the time` | `Checking the suggested time against your calendar and rules.` |
| Suggestion is `rejected` | `That time does not work` | The server's `rejectionReason`, or `That time did not pass the check.` |
| Suggestion is `shared`, with no higher-priority card | `Shared with the requester` | `Version <proposal version> was sent to <requester name>, who needs to agree to it before you approve.` |
| Suggestion is pending and was drafted by the assistant | `Share these changes?` | `Thyme drafted these from your conversation. Sharing replaces the current proposal, so <requester name> agrees again and you approve again.` |
| Suggestion is pending and was entered by the host | `Share these changes?` | `Your suggestion. Sharing replaces the current proposal, so <requester name> agrees again and you approve again.` |
| Rule/travel card; weekly-limit hold | `Every time falls in a full week` | `Only you see this. Busy time, your hours and trips that do not fit cannot be waived.` |
| Rule/travel card; allowable unresolved trip | `Some trips need your estimate` | Same rule/travel description |
| Rule/travel card; neither condition | `Your rules for this request` | Same rule/travel description |
| No proposal or higher-priority card, request active | `No proposal yet` | `<requester name> has not chosen a time yet. You can look at times privately or suggest one.` |
| No proposal or higher-priority card, request closed | Current state label, such as `Withdrawn` | `This request is closed.` |

The booking card uses one of four headings: **Booked** when booking state is `confirmed`; otherwise **Cancelled** when request state is `cancelled`; otherwise **Not booked** when booking state is `failed` or `cancelled`; otherwise **Booking in progress**. Its description is the failure-specific text below when a failed/cancelled booking has a failure reason. Without one, it uses the booking-state text.

| Booking state without a failure reason | Description |
| --- | --- |
| `reserved` | `Booking in progress.` |
| `dispatching` | `Booking in progress. We are confirming the event with Google Calendar.` |
| `confirmed` | `Booked. The event is in the calendar.` |
| `failed` | `Booking did not go through.` |
| `cancelled` | `This booking was cancelled.` |

| Booking failure reason | Description |
| --- | --- |
| `calendar_access_revoked` | `Google Calendar access was revoked. Reconnect your calendar from setup, then retry.` |
| `calendar_rejected` | `Google Calendar refused the event. Check your booking calendar, then retry.` |
| `conflict` | `The time no longer fits your calendar, so nothing was booked. The requester can choose another time.` |
| `declined` | `You declined before booking started.` |
| `event_removed` | `The event was removed from your calendar.` |
| `expired` | `The request expired before booking started.` |
| `changed` | `This meeting was moved; the new time is booked.` |
| `host_cancelled` | `You cancelled this meeting. The requester was told, and the event is removed from your calendar.` |
| `requester_cancelled` | `The requester cancelled this meeting. The event is removed from your calendar.` |
| `revalidation_unavailable` | `Your calendar could not be checked just before booking, so nothing was booked. Retry when ready.` |
| `stale_decision` | `The proposal changed before booking started, so nothing was booked.` |
| `withdrawn` | `The requester withdrew before booking started.` |

Source: `apps/web/app/_components/host/host-requests.tsx`, `apps/web/app/_components/host/host-request-cards.tsx`, `lib/server/host-requests.ts`, `lib/server/workspace-requests.ts`, and `lib/contracts/booking.ts`.
