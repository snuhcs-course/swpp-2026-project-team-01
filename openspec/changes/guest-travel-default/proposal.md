# Proposal

Tracking issue: #199

## Why

The guest's meeting details card asks "How you will travel" (Driving, Public transit, Walking) for every in-person meeting, without saying why. In the Iteration 3 heuristic evaluation (match between system and the real world, severity 2) guests could not tell why they were asked; a host-side concept leaked into the guest flow. The 2026-11-14 UAT meeting confirmed it, and the 2026-11-08 kickoff already leaned toward dropping travel mode from the questions guests answer.

The answer matters in one case only: an in-person meeting where the guest connected Google Calendar and has an event just before or after a candidate on the same day ([Requester travel legs](../../specs/meeting-feasibility/spec.md)). Online meetings and guests without a connected calendar never use it. When it was missing in that one case, every candidate with an adjacent guest event was held back until the guest allowed minutes by hand.

## What Changes

- The meeting details card no longer asks how the guest will travel, and the assistant never asks for it.
- A guest's own trips are estimated by public transit unless the guest named a mode on their own (in words to the assistant, or through **Use your host settings for this request**, which drafts their host travel mode). A named mode still wins.
- A missing guest travel mode no longer leaves a guest leg unresolved; unknown locations, failed routes and missing estimates still do, as before.
- Host legs are unchanged: they still use the host's confirmed travel mode, and **Depends on the trip** or no mode still leaves them unresolved.

## Decision

The team chose between keeping the question only where it is used (in person with a connected guest calendar, with a one-line reason) and removing it with a default. The issue owner chose removal with public transit on 2026-11-16. Accepted consequence: a guest who drives or walks and does not say so gets their trips estimated by transit, so a slot can be offered that is tight for them or left out when it would fit. The requester allowance and the host's approval remain the safety nets, and [#186](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/186) evaluates how much route time changes the offered slots.

## Capabilities

### Modified Capabilities

- `meeting-feasibility`: requester travel legs fall back to public transit when the guest named no travel mode.

## Impact

`lib/contracts/request.ts` (the default requester travel mode), `lib/server/feasibility.ts` (requester legs use it), `apps/web/app/_components/requester/request-cards.tsx` (the question is removed from the meeting details card), the [product requirements](../../../documentations/02_product_requirements.md#travel-time-checks) and the [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md). No schema change: `travelMode` stays optional in the stored request details.
