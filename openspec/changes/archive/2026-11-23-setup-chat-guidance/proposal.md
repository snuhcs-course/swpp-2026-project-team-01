# Proposal

Tracking issues: #361, #368, #377

## Why

Hosts who set up in iMessage, WhatsApp or Telegram cannot tell how far along setup is or what is left (#368). Only the primary calendar is checked after Google Calendar is connected, and nothing tells the host that their other calendars exist, so times can be offered over events Thyme never read (#361). The tutorial offer at the end asks "Would you like to try a sample request?" without saying what that is, and the Korean calls it a tutorial while the English calls it a sample request (#377). Each message stays short, following #362, and asks one thing at a time, following [one thing to think about at once](../../../../documentations/03_design_principles.md#4-one-thing-to-think-about-at-once).

## What Changes

- Setup in the chat has four named steps: Calendar, Meeting hours, Where you meet, Open times (캘린더, 미팅 시간, 미팅 장소, 열어둘 시간). The first setup message says in one line what setup covers and how long it takes. Each step's question starts with its progress line, such as "2/4 · Meeting hours": the service marks the calendar, hours and open-times messages, and the agent marks its place question. The first save says plainly that setup is done, with the booking link. The web setup cards use the same names for the same steps, in their progress line.
- When the service saves the primary calendar as the default roles, the same message names the other calendars `recommendCalendarRoles` would also check (owner, writer and reader calendars, without holiday, birthday and free/busy-only ones), at most three by name, and asks once whether they should count for busy times too. No answer keeps the primary only; a yes or a named calendar is saved in words with `set_calendar_roles`.
- The tutorial offer says in one line what the tutorial is before asking, in the same words in English and Korean: "A pretend guest sends you a sample request, and you try approving or changing it. Nobody real gets a message. Want to try?" The Korean feedback after a practice decision says 샘플 요청, as the English says sample request.

## Capabilities

### Modified Capabilities

- `chat-workspaces`: guided host setup in the linked chat, with progress and one question about other calendars.
- `meeting-requests`: the optional sample request is explained when it is offered.

## Impact

`lib/contracts/setup-progress.ts` (new: the step names, overview and progress line), `lib/contracts/host-tutorial.ts` (the offer text, now shared with the web card), `lib/server/channel-texts.ts`, `lib/server/calendar-roles.ts`, `lib/server/imessage-links.ts`, `lib/server/imessage-commands.ts`, `lib/server/setup-channel-tools.ts`, `agent/instructions/host-setup.ts`, the web setup step labels and progress (`apps/web/app/_components/setup/`), and the share-links card. The [host onboarding flow](../../../../documentations/user_experience/05_host_onboarding_flow.md) and the [agent configuration](../../../../documentations/technical_specification/04_agent_configuration.md) are updated. No schema change.
