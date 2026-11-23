# Proposal

Tracking issues: #242 (spread the offered times) and #241 (find times after **Apply these details**).

## Why

For "any weekday next week" (Monday 23 to Friday 27 November) Thyme offered three times, all on Monday and 15 minutes apart: 12:45, 13:00 and 13:15 (#242). A guest who cannot make Monday has no real choice. The engine already spread the default two-week search across days, but a search over the guest's own windows kept the soonest-first order, and the model ranking it then ran over (which prefers sooner dates) could put one day's cluster first again.

In the same session, pressing **Apply these details** updated the meeting details and then nothing followed until the guest wrote again (#241). The card decided on its own whether to find times, from the view it rendered with and a rule (purpose, length and form) that differs from the server's, which the assistant's `apply_request_review` uses (an identified request with a length and a form).

## What Changes

- Every search orders its times across the range, not only the default two-week one: within each rank (the host's weekly limit and trip preference, then the guest's preferences, all unchanged), each day's first time comes before any day's second, and a day's later time comes at least two hours from that day's earlier ones. Times that no round can place keep their order at the end of their rank. A time paired with several of the host's places keeps its pairs together. Nothing is removed; only the order changes.
- A model ranking still decides which of the first 20 valid times come first, but its ranked times are spread the same way, its order breaking ties, so it cannot put one day's cluster first.
- **Apply these details** answers whether times can be found now (`findTimes`), decided on the server from the request as written with the same rule as `apply_request_review`; the card finds times on that answer. Bug fix only: the intended behaviour (U13, "Apply these details finds times at once") does not change.

## Capabilities

### Modified Capabilities

- `meeting-feasibility`: offered times are spread across the requested range and parts of the day.

## Impact

`lib/server/feasibility.ts` (`spreadOrder`, the spread in `plan()` and in `applyRanking`), `lib/server/evaluation.ts` (the ranked order is spread in the requester's zone; the `spreadDays` input is removed), `lib/server/request-lifecycle.ts` (`readyForTimes`), `lib/server/request-reviews.ts` (`findTimes` on the apply result), `lib/server/request-tools.ts`, `apps/web/app/_components/requester/request-cards.tsx` and the [guest booking flow](../../../../documentations/user_experience/06_guest_booking_flow.md). No schema change.
