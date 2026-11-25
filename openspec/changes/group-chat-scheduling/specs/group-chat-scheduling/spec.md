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

### Requirement: Candidate times from the organizer's feasibility
After activation, the group request SHALL offer at most five numbered candidate times. They SHALL be found by the organizer's feasibility over the organizer's chosen date range, length and mode, spread across the range. In-person candidates SHALL be paired with the organizer's confirmed places. When a candidate stops being feasible for the organizer, it SHALL be shown as unavailable without a reason, and the other candidates SHALL keep their numbers.

#### Scenario: Times posted to the group
- **WHEN** a group request is activated for a 60-minute online meeting next week
- **THEN** the group sees up to five numbered times that are all feasible for the organizer, and a link to the poll page

#### Scenario: Organizer's calendar changes
- **WHEN** a new busy event in the organizer's conflict calendars overlaps candidate 3
- **THEN** candidate 3 is shown as unavailable with no reason, and candidates 1, 2, 4 and 5 keep their numbers

### Requirement: Members answer without an account
A member SHALL be able to answer without an account, either by a group message of candidate numbers only, or on the poll page with a display name. A group answer SHALL be attributed to the sender's profile name and SHALL replace that name's earlier group answer. A poll page answer SHALL be editable and deletable only from the device that made it. Group answers and poll page answers SHALL never be merged by name. The organizer's view SHALL label group answers as unverified. A member who connects Google Calendar on the poll page SHALL grant read-only access for this group request only. That grant SHALL mark busy times without storing, logging or showing any event detail.

#### Scenario: Numbers in the group
- **WHEN** a member writes "1 3" in an activated room
- **THEN** times 1 and 3 are recorded as working for that profile name, labelled as from the chat

#### Scenario: Other text in the group
- **WHEN** a member writes "다음 주 바빠서 잘 모르겠어" in an activated room
- **THEN** nothing is recorded, the text is not sent to the model and no copy of it is stored

#### Scenario: Member connects a calendar
- **WHEN** a member connects Google Calendar on the poll page and is busy during time 2
- **THEN** time 2 is not counted for that member, and neither the group nor the organizer sees the event

#### Scenario: Member deletes their answer
- **WHEN** a member presses **Delete my answer** on the poll page from the device that answered
- **THEN** their name, times and email are deleted and the counts change

### Requirement: Introduction and stop
The first message to an activated room SHALL state that it comes from Find Me a Time, name the organizer by display name, and say that the bot reads only numbered answers and `stop`. It SHALL also say that other conversation is not stored and that anyone can stop it, and it SHALL link to the privacy policy. A `stop` or `그만` from any member SHALL deactivate the room, close the group request as stopped, end forwarding from the room, and tell the organizer in their own chat.

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
A group request SHALL close when it is booked, when the organizer cancels, after `stop`, or 14 days after activation without a booking. Members' answers, display names and emails SHALL be deleted 30 days after the group request closes. No group message text SHALL be stored beyond parsing.

#### Scenario: Unbooked poll expires
- **WHEN** 14 days pass after activation without a booking
- **THEN** the group request closes, the room stops being forwarded and the organizer is told

#### Scenario: Retention after closure
- **WHEN** 30 days pass after a group request closed
- **THEN** its members' answers, names and emails no longer exist
