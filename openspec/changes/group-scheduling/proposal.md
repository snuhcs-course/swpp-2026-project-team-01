# Proposal

Tracking issue: #486 (the Google Geocoding and Places setup is #487)

## Why

Find Me a Time books one guest with one host: a request has one requester ([`meeting-requests`](../../specs/meeting-requests/spec.md), "Complete account-free intake") and the booked event has the requester as its only attendee ([`calendar-booking`](../../specs/calendar-booking/spec.md), "Host-owned event with stable identity"). A host who wants to meet several people at once has to collect everyone's free times by hand.

This is a new idea, first stated by the user on 2026-11-26. No product document or user story covers it yet; this change adds them.

## What Changes

- **A group link from the chat.** In their linked messenger conversation, a set-up host asks for a group meeting and gives the purpose, length, date range and the number of people. Whether to meet online or in person, and where, is left open. Thyme sends one shared link.
- **A shorter guest flow on the group link.** Each person who opens it connects Google Calendar (required, no **Skip for now**), answers a short question about preferred hours, where they usually are, how they travel, and commitments the calendar does not show, confirms the times they cannot meet, can link a messenger or skip, and is done. Nobody picks a date.
- **Progress.** Participants do not show as separate requests to the host, and the host hears nothing until the close, but can ask in the chat how many people are done and who.
- **Closing.** The link closes when the set number of people are done. The host can close it earlier in words and go ahead with the people who are done.
- **The host chooses.** When the link closes, the service reads the host's conflict calendars, takes every participant's confirmed unavailable times as they confirmed them, finds times when everyone is free with a place everyone can reach, or online when no place works, and tells the host in the chat. Place candidates are the host's usual places first, then the participants' usual places and points between them. It sends up to three options first, and the host can ask for more in words. If no time works for everyone, it sends the times that work for the most people and names who cannot make each one.
- **One invitation.** The host names a time, which may be one that not everyone can make. The service checks the host's calendars again, then books one event in the host's booking destination with every participant as an attendee. Google sends the email invitations.

## Decisions

The user made D1–D18 on 2026-11-26 in the session that wrote this change.

| # | Decision | Choice |
|---|---|---|
| D1 | Who is invited | One shared link and a number of people. Invitations to a Slack or KakaoTalk room, closer to a named list, come later and are out of scope |
| D2 | Meeting terms | The host sets the purpose, length and date range when creating the link; guests do not change them. Mode and place are left open (D15) |
| D3 | Host calendars | The host's conflict calendars count. They are read when the link closes, together with the participants' calendars |
| D4 | What a guest confirms | Only that the times they cannot meet, from their calendar and what they said, are right. They do not pick times |
| D5 | No time for everyone | Show the times that work for the most people and who cannot make each |
| D6 | Messenger and invitation | Linking a messenger can be skipped; the invitation goes by email, as Google's event invitation |
| D7 | Where the host creates it | Only in the host's linked messenger conversation |
| D8 | The booked event | One event with every participant as an attendee |
| D9 | Full and early close | A full link shows that it is closed; the host can close it early in words and go ahead with the people who are done |
| D10 | Times shown to the host | Up to three first; the host can ask for more in words |
| D11 | Participant unavailable times | What the participant confirmed is what the host gets: the confirmed intervals are stored with the places of their events and used as they are at the close and at booking. Participant calendars are not read again ([design 4](design.md#4-confirmed-unavailable-times)) |
| D12 | A time not everyone can make | The host may book it when it is the best there is. Contacting the people who cannot make it is the host's own choice |
| D13 | Changes after done | A participant cannot change their answers after they are done |
| D14 | How long the link stays open | Until it is full or the host closes it; it has no expiry of its own |
| D15 | Mode and place | Not set when the link is created. They are decided after everyone's times are in, as part of the host's choice |
| D16 | Place candidates | The host's usual places first; the participants' usual places and points between them after |
| D17 | Participant places | The places of a participant's confirmed events, their usual place and travel mode are stored for the travel check; neighborhood level is enough |
| D18 | What the host sees before the close | No participant shows as a request of its own, and nothing is sent until the group closes. The host can ask in the chat how many are done and who |

## Capabilities

### New Capabilities

- `group-scheduling`: group links, the participant flow, closing, the common-time search, the host's choice and the group invitation.

### Modified Capabilities

- `calendar-booking`: the booked event of a group meeting has every participant as an attendee.
- `requester-calendar-access`: a group participant's confirmed unavailable times are stored with the places of their events.

## Impact

- Schema: a `group_meetings` table and a nullable `requests.group_meeting_id`, so each participant is a request (booking link, requester grants and guest bindings unchanged) ([design 1](design.md#1-a-participant-is-a-request)).
- `lib/server/host-intake-tools.ts`-style host chat tools for creating and closing a group link, and their instructions in `agent/instructions/host-imessage.ts`.
- The guest thread and `agent/instructions/requester.ts` for the group step order; `lib/server/requester-busy.ts` for the unavailable-times review.
- `lib/server/feasibility.ts` for the intersection over several people and time-and-place options with everyone's travel legs; a place lookup for points between participants' places (Google Geocoding and Places; today `GOOGLE_MAPS_API_KEY` is restricted to the Routes API, so these APIs must be enabled and added to its restriction or given their own key, with stand-ins beside `tests/integration/support/fake-routes.ts`), `lib/server/imessage-notices.ts` for the host's close notice, `lib/server/bookings.ts` for several attendees.
- Documents: `documentations/user_experience/02_user_stories.md`, `documentations/user_experience/07_group_meeting_flow.md`, and `documentations/02_product_requirements.md`.
