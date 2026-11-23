# Proposal

Tracking issue: #58

## Why

When a host declines a request, the guest's revised request leaves out only the declined time ([guest-flow-completion U17](../guest-flow-completion/proposal.md#decisions)). A host cannot say "that day and these days no longer work": the decline confirmation on `/app` takes no dates, `decline <ref>` takes no other input, and the decline tools take none. The guest side is ready for such dates: `requests.details.excludedTimes` carries over to the revised request, every evaluation treats it as all-day blocked time, and a time the guest names inside it is refused without a reason. Only the host input is missing. U17 split it out to #58 on 2026-11-02.

## What Changes

- Beside **Decline request** on the proposal review card, the host may add up to 14 other dates that no longer work, from today in their own time zone, and remove any before declining. No reason is asked for.
- A typed `decline <ref> YYYY-MM-DD …` in the host's linked iMessage, WhatsApp or Telegram conversation takes the same dates. Anything else after the reference is free text for the assistant, as before, so a reason never becomes a command.
- `decline_request` (the host review assistant's tool in linked chat, and the agent-access MCP tool) takes an optional `excludedDates` list. The assistant passes only the dates the host named and keeps any reason out of the call. The help reply gives an example of declining with other dates in words.
- `request.decline` accepts an optional `excludedDates` list (at most 14 real `YYYY-MM-DD` dates) and refuses any other field. When the request closes as declined, each date is added once, as a whole local day in the host's time zone, to the closed request's `details.excludedTimes`; a day that has already ended is not kept. A decline that keeps a booked meeting (a change after booking) stores nothing, since no revised request follows.
- No reason is stored, shown or passed on anywhere.

## Capabilities

### Modified Capabilities

- `meeting-requests`: a host decline may name other dates that no longer work, which the revised request leaves out.

## Impact

- **Changed code:** `lib/contracts/declined-dates.ts` (new: date checks and whole days in a zone); `lib/contracts/timezone.ts` (exports `localDate` and `addDays`); `lib/server/bookings.ts` (`request.decline` input and storing the days); `lib/server/imessage-commands.ts` and `channel-texts.ts` (the typed command, its reply and the help example); `lib/server/host-review-tools.ts`, `agent/tools/request.ts`, `lib/server/agent-host-tools.ts` and `agent/instructions/host-imessage.ts` (the decline tools); `apps/web/app/_components/host/host-request-cards.tsx` (the date field beside **Decline request**).
- **Schema:** none. The days join the existing `requests.details.excludedTimes` (U17).
- **Documents:** the [page list](../../../documentations/user_experience/04_page_list.md) already describes naming other days when declining; the [story path evaluation](../../../documentations/technical_specification/13_story_path_evaluation.md) records the appended host review case RV-D01.
