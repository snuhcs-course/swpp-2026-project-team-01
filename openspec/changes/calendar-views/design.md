# Design

## 1. One shared week grid

`WeekCalendar` draws one week, Monday first, or one day with a day switcher below 640px. It uses the Dashboard Week view's geometry (hour rows, blocks placed by local start and end) and its source colours, so the host's calendar beside a decision, the guest's grid and the Dashboard read the same way. The Dashboard itself is not rebuilt on it in this change: its Month view, filters and detail pane are not needed beside a card, and #390 and #403 change its data loading and sources at the same time.

Two layers sit on the grid: **events** (the calendar's own blocks) and **marks** (the times this request is about). A mark that covers an event is inset to the right, so the event stays visible beside it. The drawn hours are 08:00–19:00, widened to whole hours that cover every mark on the shown days, so no proposed or offered time falls outside. Times on another week or day are counted under the grid ("2 more times on other weeks").

Layout follows cal.diy's booker week view (`apps/web/modules/bookings/components/LargeCalendar.tsx` at `ae027bb70e694e2d2c44569f398d6cbcee0389b1`): existing events are drawn as blocks, available times are drawn over them, and an overlay calendar contributes busy time only. Its store, data hooks and slot model are not adopted.

**Accessibility.** Screen readers get two lists in time order: the events and the marks, each item with its full date and time. A mark with an action is a button named with the action, the date and the time ("Choose this time: Tuesday 1 Dec, 10:00–10:30"). Picking an empty part of a day is a pointer shortcut only; on the host side the **Request changes** form is the keyboard path, and the guest only chooses offered times, which are buttons. Status is never colour alone: marks carry text tags ("Proposed", "Your suggestion", "Trip?").

## 2. Host: the week beside the decision

Shown while a received request has a proposal, a suggestion, a private search's offered times or the open editor, and never for the tutorial sample or a closed request. It opens at the host's draft, else the suggestion, else the proposal, else the first open time, and moves when that changes.

Events come from `/api/host/dashboard` for the shown week (the calendars the host chose, Find Me a Time meetings, sent requests, and received requests when #403 lands, leaving out this request's own block). Each week is loaded once per open panel. A failed read keeps the marks and says the calendar could not be loaded; a Google warning from the Dashboard projection is shown as is.

Choosing an open time or clicking an empty quarter hour opens **Request changes** with that date and time filled in, and the editor's current time is drawn as "New time". The suggestion still goes through `request.suggest_changes` and **Share revised details**; the calendar never sends a command.

The Requests column widens from 720px to 1152px on wide screens while a request is open, so the card and the week sit side by side.

## 3. Guest: Choose a time as a week grid

Every offered time is drawn at once; the former pages of three (`TIMES_SHOWN`) no longer apply to the card, so **Find other times** runs a new search. The assistant still describes the first three times in words (U11). The details every time shares (time zone, length, place) are said once above the grid; a detail that differs is tagged on each block and named in its button. Trip-dependent times are dashed warning blocks; choosing one opens that time's trip estimate under the grid, one at a time. The nearest-times, no-match and meeting-link messages are unchanged.

## 4. Guest busy overlay

`GET /api/requests/{bookingId}/busy?from&to&tz` reads, live, the same calendars an evaluation of this request reads: the request's own Calendar grant and, for a guest who is a host and chose **Calendars**, their host conflict calendars. It applies `normalizeBusy` (cancelled, free, declined and duplicate events are not busy) and returns only `start`, `end` and `allDay`: no title, place, attendee or calendar name. Nothing is stored or logged, and a failed read never closes a grant or reopens a step (that stays the evaluation's job). The period is at most 15 days. The identifier in the path is the credential, as on every guest route, so a closed or expired request gets the generic answer.

Rejected: putting busy intervals in the evaluation projection. Evaluations keep requester event data in memory only, and the projection is shared with the assistant's tools.
