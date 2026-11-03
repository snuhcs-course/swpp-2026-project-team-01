# Proposal

## Why

The host's Google Calendar is read when candidate times are evaluated and again when booking revalidates the approved interval, but not in between. Choosing a candidate and agreeing to it reuse the stored evaluation, which only goes stale when the request or the host's settings change, never when the host's calendar does. The host is then asked to approve a time that may already be busy, and the conflict surfaces only after approval, when booking revalidation fails. [Issue #95](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/95) tracks this change and lists the read points.

## What Changes

- `request.agree` reads the host's conflict calendars again for the proposed interval, the way booking revalidation does (`checkInterval`, without the requester's calendar or ranking), before it records agreement.
- If the interval no longer fits, no agreement is recorded, the host is sent nothing, and a new evaluation at the same revision replaces the stale one as the current times. The command answers `time_unavailable`; the proposal card, the guest conversation and the requester's agent say so and offer the new times.
- If Google cannot be read or the deadline passes, agreement goes ahead as before; booking revalidation still checks the interval before any event is written.

Out of scope, left on issue #95: telling the guest when booking revalidation finds a conflict, the host's `booking_failed` wording, an age limit on stored evaluations, and anything after booking.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: agreement rechecks the host's calendars for the proposed interval.

## Impact

`lib/server/request-proposals.ts` (`agreeCommand` becomes a factory taking the evaluation dependencies, like `declineCommand`), its callers in `requester-routes.ts`, `request-tools.ts` and `agent-requester-tools.ts`, the proposal card in `apps/web/app/_components/requester/request-cards.tsx`, and the integration tests that agree. Agreement can now wait on Google for up to the evaluation deadline (18 seconds) while it holds the request lock, as booking revalidation already does. No schema change.
