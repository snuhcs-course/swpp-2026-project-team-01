# Proposal

Tracking issue: #201

## Why

In the Iteration 3 heuristic evaluation (error prevention, and help users recover from errors, severity 2 each) a guest asked for "tomorrow morning" outside the host's availability. They learned that it did not work only after writing the request, and the reply offered no alternative: the no-match message only asks for a wider window, other days or a shorter meeting ([Testing Documentation](https://github.com/snuhcs-course/swpp-2026-project-team-01/wiki/Testing-Documentation); 2026-11-14 UAT meeting notes).

## What Changes

- When no time fits the guest's own windows, the evaluation also finds the nearest open time before and the nearest after them, up to a week away, with the same deterministic checks.
- The guest's assistant gets them with the no-match result and offers them in the same reply; the candidate times card lists them too. The message offers them instead of only asking for a wider window.
- Nothing about them says why the windows did not work: no calendar, commitment, travel or rule reason, as for every requester message.
- A guest who picks one says so in words; the assistant drafts that time as their availability, which finds it as an ordinary time to choose.

## Capabilities

### Modified Capabilities

- `meeting-feasibility`: a requester evaluation with no time in the requested windows looks for the nearest open times around them.

## Impact

`lib/server/evaluation.ts` (the nearest search and the stored requester projection), `lib/contracts/feasibility.ts` (the projection field and the message), `lib/server/request-tools.ts` (`nearestTimes` in the guest's tool results), `agent/instructions/requester.ts`, `apps/web/app/_components/requester/request-cards.tsx`, the [product requirements](../../../documentations/02_product_requirements.md) (FR-10) and the [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md) (G6). A case is appended to the [guest defense evaluation](../../../documentations/technical_specification/10_guest_defense_evaluation.md). No schema change: the projection is stored JSON.
