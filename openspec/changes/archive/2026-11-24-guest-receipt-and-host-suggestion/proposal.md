# Proposal

Tracking issues: #424 (guest Calendar receipt) and #386 (host's page after a suggestion)

## Why

Two web cards say the wrong thing about where a request stands.

- A guest who chooses **Continue without Google** (or Google without its Calendar part) sees the Calendar step's receipt as **Calendar · Skipped**. Not connecting a calendar is a valid choice, but "Skipped" reads as a missed step or a failure, and it does not say what happens next: the guest gives Thyme their times in the conversation (#424, owner's testing on 2026-11-23).
- After a host shares a suggested time, their request page could not show it. `nextHostStep` routed to the proposal whenever one existed, before it looked at the suggestion, so the **That time does not work** card for a suggested time that failed its check was unreachable and the host saw the earlier, now stale proposal as if it were still waiting for the requester. The **Shared with the requester** card was unreachable too, and when the shared time did become the next proposal the card still read "Waiting for the requester" with no sign that it was the host's own suggestion (#386, team QA on 2026-11-23).

## What Changes

- **Guest Calendar receipt.** The answered Calendar step without a connected calendar reads **Not connected · You’ll tell Thyme your times** in the thread and **Not connected** in **Request details**, and keeps **Change** (**Change your calendar**) while times are being chosen. A connected calendar's receipt is unchanged.
- **Shared suggestion on the host's page.** While the current proposal is the one the host's shared suggestion wrote and the requester has not agreed to it, the proposal card is titled **Waiting for {requester}** and says "You suggested {day}, {start}–{end}. We’re waiting for {requester} to agree before you can approve." ("You shared revised details." when the suggestion kept the time), with **Request changes** and **Decline** as before. Once the requester agrees, or a newer proposal follows, the card is the usual proposal review. The unreachable **Shared with the requester** card is removed.
- **Rejected suggestion on the host's page.** While a rejected suggestion was made against the latest proposal (no newer proposal has followed) and the request is gathering or negotiating, the host's card is **That time does not work** with the check's reason, the suggested time, and that the earlier time no longer stands. The host view carries the suggestion's base proposal version so the page can tell.
- The request list's time is the latest proposal's start, so after a shared suggestion it already shows the suggested time; it is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: the guest's unconnected Calendar receipt and the host's request page after a shared or rejected suggestion.

## Impact

- `apps/web/app/_components/guest/guest-workspace.tsx`, `apps/web/app/_components/host/host-request-cards.tsx`, `lib/contracts/host-request.ts` and `lib/server/host-requests.ts` (the suggestion's `baseProposalVersion`, read from the existing `shared_change_drafts.base_proposal_version` column). No schema change.
- Unit tests beside both components; the browser test that asserted "Skipped".
- [`04_page_list.md`](../../../../documentations/user_experience/04_page_list.md) and [`06_guest_booking_flow.md`](../../../../documentations/user_experience/06_guest_booking_flow.md).
