# Proposal

Tracking issues: #295 and #298, implemented together in one pull request. Implementation pull requests refer to both with `Part of #295` and `Part of #298`; the pull request that archives this change closes both with `Closes #295` and `Closes #298`.

## Why

In UAT on findmeatime.com on 2026-11-19 two gaps in the host web showed up (testing baseline [H03 W-1 and H04 W-3](../../../documentations/technical_specification/12_testing_baseline.md#h04-host-schedule-and-meeting-status)):

- A request waiting for the host's approval gave no sign on the workspace screen. **Needs your decision** appears only after the host opens Requests from the workspace menu (#295).
- A meeting Thyme booked showed almost nothing on the calendar Dashboard: the week block showed only its time, and the details pane showed the title and time but not who it is with, its length, mode, Meet link or a way back to its request (#298).

The [chat-workspaces](../../specs/chat-workspaces/spec.md) contract asks for compact navigation and a Dashboard that reveals a selected event's details. Neither says what a host sees about pending decisions or a booked meeting.

## What Changes

- Where the workspace menu offers **Requests**, a round red count on the menu button and on that item says how many received requests need the host's decision. It reloads when the page regains focus, when the menu opens and after a decision in the Requests view, and disappears when none are left. Screen readers hear the count in words. Sample requests never count.
- A Find Me a Time meeting on the Dashboard shows, in its details, When · Length · Mode · Place or Meeting link · With {guest} (and Purpose when it differs from the title), the same facts the host saw when approving, plus **Open request**, which opens that request in Requests. The Meeting link is the Meet link Google returned, or the requester's own link.
- A week block for a short meeting keeps its time and who it is with on one line; a longer block names the guest under the title.

## Capabilities

### Modified Capabilities

- `chat-workspaces`: a pending-decision count on the workspace menu, and booked meeting details on the calendar Dashboard. Both are added as new requirements so the still-open [`request-dashboard`](../request-dashboard/proposal.md) change, which modifies **Host calendar Dashboard**, is not contradicted.

## Impact

`apps/web/app/_components/workspace-menu.tsx`, `apps/web/lib/chat/pending-decisions.ts`, `apps/web/app/_components/host/host-requests.tsx`, `lib/server/host-dashboard.ts`, `apps/web/app/_components/host-dashboard.tsx`, its labels and styles, and `lib/contracts/booking.ts` (the join link rule shared with the booking receipt). The count reads the existing `/api/host/requests` route; the Dashboard joins the booking's proposal and request it already belongs to. No schema change, new route or provider grant. [DESIGN.md](../../../DESIGN.md), the [page list](../../../documentations/user_experience/04_page_list.md) and the [testing baseline](../../../documentations/technical_specification/12_testing_baseline.md) are updated.
