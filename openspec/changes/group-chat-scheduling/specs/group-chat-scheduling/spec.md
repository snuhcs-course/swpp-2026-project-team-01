## ADDED Requirements

### Requirement: Group room activation by an organizer's code
A linked, set-up host SHALL be able to get a single-use group code from `/app` or from their own linked 1:1 chat. The code SHALL be valid for 15 minutes, bound to that host, and limited to five per host per hour. When the code arrives in a KakaoTalk group message, the service SHALL bind that message's room to a new group request with that host as organizer, and SHALL answer in the room with the introduction. A group code arriving in a 1:1 chat, a host link code arriving in a group, or an expired or used group code SHALL bind nothing. Each of these SHALL void the attempt it names, if any. A room SHALL hold at most one open group request. Text from a room that is not activated SHALL NOT leave the relay phone, except a message that carries a group code.

#### Scenario: Organizer activates a group
- **WHEN** a linked host posts their unexpired group code in a KakaoTalk group
- **THEN** that room is bound to a new group request with the host as organizer, and the group receives the introduction through the reply action of that message

#### Scenario: Group code in a 1:1 chat
- **WHEN** a group code is sent in a 1:1 chat
- **THEN** no room is activated and the code's attempt is void

#### Scenario: Expired code in a group
- **WHEN** an expired group code is posted in a group
- **THEN** no room is activated, and the group receives one fixed reply that names no one

#### Scenario: Ordinary chat before activation
- **WHEN** members of a room that is not activated write messages without a group code
- **THEN** the relay forwards nothing from that room

### Requirement: Group messages carry no authority
A message in a group room SHALL NOT approve, book, cancel, reschedule or change any setting, whatever profile name sent it. Approval and booking of a group request SHALL come only from the organizer's own linked chat, `/app`, or the organizer's connected agent with `host:decide`.

#### Scenario: Organizer's name in the group
- **WHEN** a group message whose profile name matches the organizer's says "2번으로 확정"
- **THEN** nothing is booked, and the message is treated only as an answer that may be counted

#### Scenario: Organizer books from their own chat
- **WHEN** the organizer sends "2번으로 잡아줘" in their own linked 1:1 chat
- **THEN** the second time is rechecked and booked as described in "Group booking"

### Requirement: Every member is asked to connect Google Calendar
The introduction SHALL link to the group's poll page and ask every member to connect Google Calendar there. Connecting SHALL need no account. The grant SHALL be read-only, SHALL be used only for this group request, and SHALL yield busy times only. No event title, place, attendee or description from a member's calendar SHALL be stored, logged, shown to anyone or placed in model context. A member's Google address SHALL be used for the invitation only if the member asks for the invitation. A member who signs in with Google SHALL be recognized: an existing host's saved conflict calendars, or a past member's remembered grant, SHALL count with no new calendar step, and the page SHALL name the calendars that count and offer to exclude them or forget the member. A remembered member grant SHALL be deleted on **Forget me**, or 180 days after the member's last group request closed. The bot SHALL NOT try to recognize members inside the group room.

#### Scenario: Member connects a calendar
- **WHEN** a member connects Google Calendar on the poll page and has an event during an otherwise feasible time
- **THEN** that time is treated as busy for the meeting, and neither the group nor the organizer sees the event

#### Scenario: Existing host opens the link
- **WHEN** a member signs in with Google on the poll page and that account is a host with saved conflict calendars
- **THEN** those calendars count for this group with no new calendar step, and the page names them and offers **Don't use my calendar**

#### Scenario: Member from a past group
- **WHEN** a member who connected Google in an earlier group signs in on a new group's poll page
- **THEN** their remembered connection counts with no new consent screen

#### Scenario: Forget me
- **WHEN** a remembered member presses **Forget me**
- **THEN** their remembered grant and identity are deleted, and their calendar no longer counts in any open group

#### Scenario: No account needed
- **WHEN** a member with no Find Me a Time account opens the poll link
- **THEN** they can connect Google Calendar and answer without signing up

### Requirement: Candidate times from everyone's calendars
The group request SHALL offer at most five numbered candidate times. They SHALL be found by the organizer's feasibility over the organizer's chosen date range, length and mode, with every connected member's busy times counted as busy, and spread across the range. When no time is free for the organizer and every connected member, the candidates SHALL be the organizer's feasible times that the most connected members can attend. In-person candidates SHALL be paired with the organizer's confirmed places. The numbered times SHALL be posted to the group as soon as the number of members the organizer expected have connected a calendar or ticked times on the poll page, when the organizer asks, or 24 hours after activation, whichever comes first. When a posted candidate stops being feasible, it SHALL be shown as unavailable with no reason and no name, and the other candidates SHALL keep their numbers.

#### Scenario: Times posted to the group
- **WHEN** three members have connected calendars and the organizer asks for the times
- **THEN** the group sees up to five numbered times that are feasible for the organizer and free for all three members

#### Scenario: Expected members have connected
- **WHEN** the organizer expected four members and the fourth member connects a calendar
- **THEN** the numbered times are posted with the next group message, without waiting for 24 hours

#### Scenario: No time free for everyone
- **WHEN** no feasible time is free for every connected member
- **THEN** the times that the most connected members can attend are offered instead

#### Scenario: A late calendar removes a posted time
- **WHEN** a member connects a calendar after the times were posted and is busy during time 3
- **THEN** time 3 is shown as unavailable with no reason and no name, and times 1, 2, 4 and 5 keep their numbers

### Requirement: Fallback answers without a calendar
A member who does not connect a calendar SHALL be able to answer by ticking times on the poll page, or by a group message of candidate numbers only after the times are posted. A group answer SHALL be attributed to the sender's profile name, SHALL replace that name's earlier group answer, and SHALL count the same as a page answer with no label. Group answers and poll page answers SHALL never be merged by name. A poll page answer SHALL be editable and deletable only from the device that made it.

#### Scenario: Numbers in the group
- **WHEN** a member writes "1 3" in an activated room after the times are posted
- **THEN** times 1 and 3 are counted as working for that profile name

#### Scenario: Other text in the group
- **WHEN** a member writes "다음 주 바빠서 잘 모르겠어" in an activated room
- **THEN** nothing is recorded, the text is not sent to the model and no copy of it is stored

#### Scenario: Member deletes their answer
- **WHEN** a member presses **Delete my answer** on the poll page from the device that answered
- **THEN** their name, times, email and calendar connection are deleted and the counts change

### Requirement: Introduction and stop
The first message to an activated room SHALL state that it comes from Find Me a Time, name the organizer by display name, give the poll link with the request to connect Google Calendar, say that only busy times are read, and say that the bot reads only numbered answers and `stop` in the room. It SHALL also say that other conversation is not stored and that anyone can stop it, and it SHALL link to the privacy policy. A `stop` or `그만` from any member SHALL deactivate the room, close the group request as stopped, end forwarding from the room, and tell the organizer in their own chat.

#### Scenario: Any member stops the bot
- **WHEN** a member who is not the organizer sends `그만`
- **THEN** the group request closes as stopped, the relay stops forwarding the room's messages, and the organizer is told in their 1:1 chat

### Requirement: What the group sees
Messages to a group room SHALL contain only the organizer's display name, the meeting length and mode, candidate times and their places, per-time counts and the display names of members who said a time works, the poll link, and the booking confirmation. They SHALL NOT contain:

- Calendar event titles, places, attendees or busy reasons of the organizer or any member.
- The organizer's rules, hours, notes, exceptions, weekly load or other requests.
- Which member's calendar blocks a time, or who said no time works.
- Members' emails, or whether a member connected a calendar.
- A link code, booking link or `/app` link.

#### Scenario: Member asks why a time is missing
- **WHEN** a member writes "왜 목요일은 없어?" in an activated room
- **THEN** the bot says nothing about the organizer's calendar or rules, and no message reveals why Thursday is missing

#### Scenario: Counts posted
- **WHEN** the group is shown the current counts
- **THEN** each time shows a number and the names who said it works, and no member's email, calendar connection or busy reason appears

### Requirement: Group booking
The organizer SHALL book a group request by naming one candidate time from their own chat, `/app` or their agent. Booking SHALL recheck the organizer's conflict calendars for that time before dispatch. A time that no longer fits SHALL book nothing and leave the other times available. The event SHALL be created in the organizer's booking destination, with a fixed provider identity so it is created at most once. Its attendees SHALL be the members who left an email on the poll page. The group SHALL receive one confirmation with the time, the place or join link, and a calendar file link. After booking, the group request SHALL close and the room SHALL stop being forwarded.

#### Scenario: Booking a settled poll
- **WHEN** the organizer books time 2 in their 1:1 chat and the time still fits
- **THEN** one event is created in the organizer's booking destination, members with an email are invited, the group gets one confirmation and the room deactivates

#### Scenario: Chosen time became busy
- **WHEN** the organizer books a time that is now busy on their calendar
- **THEN** nothing is booked, the organizer is told, and they can choose another time

### Requirement: Group request lifetime and retention
A group request SHALL close only when it is booked, when the organizer cancels, or after `stop`; it SHALL NOT close because time has passed. When every candidate has passed, the organizer SHALL be asked once, in their own chat, for a new date range. Members' answers, display names and emails SHALL be deleted 30 days after the group request closes. No group message text SHALL be stored beyond parsing.

#### Scenario: Unbooked poll stays open
- **WHEN** a month passes after activation without a booking, a cancel or `stop`
- **THEN** the group request is still open and the room is still forwarded for parsing

#### Scenario: All candidates have passed
- **WHEN** the last candidate time passes without a booking
- **THEN** the organizer is asked once in their own chat for a new date range, and the group is sent nothing

#### Scenario: Retention after closure
- **WHEN** 30 days pass after a group request closed
- **THEN** its members' answers, names and emails no longer exist
