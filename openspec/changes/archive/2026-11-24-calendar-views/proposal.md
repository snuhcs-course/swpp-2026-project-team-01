# Proposal

Tracking issue: #147. The change also covers #379 and #374, which the repository owner decided on 2026-11-23 to build together with #147 in one pull request. The pull request that archives this change closes all three.

## Why

When a time is on screen, neither side can see it against their own day.

- The host reviews a proposal, a suggestion or the open times of a private search as text: "Tue 1 Dec, 10:00 to 10:30". To see what comes before and after, they have to leave the Requests view and open their calendar (#147, #379).
- The guest's **Choose a time** card lists the offered times as rows that repeat the date, `GMT+9` twice, the time zone, the length and the place. Three at a time, with more behind **Find other times** and "Show 5 more trip-dependent times", it is hard to see which days and parts of the day are open (#374).

## What Changes

- **Host (#147, #379).** While a received request shows a proposal, a suggestion, a private search's open times or the **Request changes** editor, the host's own week sits beside the decision card on a wide screen and under it on a narrow one (one day with a day switcher on a phone). It shows the same events as the Dashboard's Week view, with the proposed time, a suggestion and the times the host is writing marked over them. The marks follow the request as it changes. Choosing an open time, or clicking an empty part of a day, opens **Request changes** with that time filled in. Nothing is shared until the host presses **Share revised details**, as before.
- **Guest (#374).** The **Choose a time** card becomes a week grid, with one day and a day switcher on a phone. Each offered time is a block the guest chooses. The time zone, length and place are said once above the grid when every time shares them, and the date once per column. Every offered time is on the grid at once, so **Find other times** searches again. Trip-dependent times are drawn dashed; choosing one opens its trip estimate. Offering several times together ([multiple-candidate-times](../2026-11-23-multiple-candidate-times/proposal.md)) stays: under the grid, **Several times work?** lists every offered time with a tick box and the guest-host's note for it (#60), and **Offer these N times** sends up to three; a ticked time is tagged on the grid. **Find other times** and **Edit details** stay below the grid.
- **Guest with a connected calendar (#374).** When the guest connected a Google Calendar to this request, or is a host who chose **Calendars**, their own busy times are drawn under the offered times as striped blocks without titles. A new read-only route returns those busy times for the shown week, from the same calendars and under the same busy rules as an evaluation.

## Capabilities

### Modified Capabilities

- `chat-workspaces`: the host's calendar beside a request's decision card (new requirement).
- `meeting-requests`: the guest's offered times as a calendar (new requirement).
- `requester-calendar-access`: the request's own Calendar grant may also show the requester their busy times beside the offered times.

## Impact

- New shared grid: `apps/web/app/_components/calendar/` (`week-calendar.tsx`, `calendar-time.ts`, styles), drawn with the Dashboard Week view's geometry and source colours.
- Host: `apps/web/app/_components/host/host-decision-calendar.tsx`, `host-requests.tsx` and `SuggestionEditor` in `host-request-cards.tsx`. The calendar reads the existing `/api/host/dashboard` route.
- Guest: `apps/web/app/_components/requester/candidate-calendar.tsx` and `CandidatesCard` in `request-cards.tsx`; new `GET /api/requests/{bookingId}/busy` (`lib/server/requester-busy.ts`, `requester-routes.ts`).
- No schema change, provider scope or new grant. [DESIGN.md](../../../../DESIGN.md) and the [page list](../../../../documentations/user_experience/04_page_list.md) are updated.
