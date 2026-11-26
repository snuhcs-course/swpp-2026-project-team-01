## ADDED Requirements

### Requirement: Group room activation by an organizer's code
A linked, set-up host SHALL be able to get a single-use group code from `/app` or from their own linked 1:1 chat. The code SHALL be valid for 15 minutes, bound to that host, and limited to five per host per hour. When the code arrives in a KakaoTalk group message, the service SHALL bind that message's room to a new group request with that host as organizer, and SHALL answer in the room with the introduction. A group code arriving in a 1:1 chat, a host link code arriving in a group, or an expired or used group code SHALL bind nothing. Each of these SHALL void the attempt it names, if any. A room SHALL hold at most one open group request. Group scheduling SHALL run only while the KakaoTalk for Mac relay is the active relay; a group code that arrives through the phone relay SHALL bind nothing and get one fixed reply. A code SHALL be handled before the message reaches eve's group conversation, and SHALL be removed from the text the model sees.

#### Scenario: Organizer activates a group
- **WHEN** a linked host posts their unexpired group code in a KakaoTalk group
- **THEN** that room is bound to a new group request with the host as organizer, and the group receives the introduction

#### Scenario: Group code in a 1:1 chat
- **WHEN** a group code is sent in a 1:1 chat
- **THEN** no room is activated and the code's attempt is void

#### Scenario: Expired code in a group
- **WHEN** an expired group code is posted in a group
- **THEN** no room is activated, and the group receives one fixed reply that names no one

#### Scenario: Ordinary chat before activation
- **WHEN** members of a room with no open group request write messages
- **THEN** the group conversation has no scheduling tools, and nothing is recorded for group scheduling

#### Scenario: Code while the phone relay is active
- **WHEN** a group code arrives while the Android phone is the active relay
- **THEN** no room is activated, and the group gets one fixed reply that names no one

### Requirement: Group messages carry no authority
A message in a group room SHALL NOT approve, book, cancel, reschedule or change any setting, whatever profile name sent it. Approval and booking of a group request SHALL come only from the organizer's own linked chat, `/app`, or the organizer's connected agent with `host:decide`.

#### Scenario: Organizer's name in the group
- **WHEN** a group message whose profile name matches the organizer's says "2번으로 확정"
- **THEN** nothing is booked, and the message is treated only as an answer that may be counted

#### Scenario: Organizer books from their own chat
- **WHEN** the organizer sends "2번으로 잡아줘" in their own linked 1:1 chat
- **THEN** the second time is rechecked and booked as described in "Group booking"

### Requirement: Every member is asked to connect Google Calendar
The introduction SHALL link to the group's poll page and ask every member to connect Google Calendar there. Connecting SHALL need no account. The grant SHALL be read-only, SHALL be used only for this group request, and SHALL yield busy times only. No event title, place, attendee or description from a member's calendar SHALL be stored, logged, shown to anyone or placed in model context. A member's Google address SHALL be used for the invitation only if the member asks for the invitation. A member who signs in with Google SHALL be recognized: an existing host's saved conflict calendars, or a past member's remembered grant, SHALL count with no new calendar step, and the page SHALL name the calendars that count and offer to exclude them or forget the member. A remembered member grant SHALL be deleted on **Forget me**, or 180 days after the member's last group request closed. Whether a member has connected before SHALL NOT be revealed in the group room.

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
A member who does not connect a calendar SHALL be able to answer by ticking times on the poll page, or, after the times are posted, by telling the bot in the group which times work. A group answer SHALL be recorded only for the sender of that message, taken from the relay event, and the bot SHALL repeat the recorded times in the group. It SHALL be shown under the sender's profile name and keyed by the sender's KakaoTalk user ID, SHALL replace only that user's earlier group answer, and SHALL count the same as a page answer with no label. Group answers and poll page answers SHALL never be merged by name. A poll page answer SHALL be editable and deletable only from the device that made it.

#### Scenario: Numbers in the group
- **WHEN** a member writes "1 3" in an activated room after the times are posted
- **THEN** times 1 and 3 are counted as working for that member, shown under their profile name, and the bot repeats them

#### Scenario: Copied profile name
- **WHEN** a second member renames themselves to another member's profile name and writes "2"
- **THEN** a second answer is counted, and the first member's answer is unchanged

#### Scenario: Other text in the group
- **WHEN** a member writes "다음 주 바빠서 잘 모르겠어" in an activated room
- **THEN** no answer is recorded for anyone

#### Scenario: Answer for someone else
- **WHEN** a member writes "민수는 2번 된대" in an activated room
- **THEN** no answer is recorded for 민수, and at most the sender's own answer is recorded

#### Scenario: Member deletes their answer
- **WHEN** a member presses **Delete my answer** on the poll page from the device that answered
- **THEN** their name, times, email and calendar connection are deleted and the counts change

### Requirement: Introduction and stop
The first message to an activated room SHALL state that it comes from Find Me a Time, name the organizer by display name, give the poll link with the request to connect Google Calendar, say that only busy times are read, say that anyone can write to the account 1:1 for what they would rather not say in the group, and say that anyone can stop the scheduling. It SHALL link to the privacy policy, and SHALL NOT contradict the group conversation's own statement of what the account reads in groups. A `stop` or `그만` from any member SHALL close the group request as stopped, remove the scheduling tools from the room's conversation, and tell the organizer in their own chat.

#### Scenario: Any member stops the bot
- **WHEN** a member who is not the organizer sends `그만`
- **THEN** the group request closes as stopped, the room's conversation loses the scheduling tools, and the organizer is told in their 1:1 chat

### Requirement: What the group sees
The group projection, which is all that group scheduling gives to fixed group messages and to the group conversation, SHALL contain only the organizer's display name, the meeting length and mode, candidate times and their places, per-time counts and the display names of members who said a time works, the poll link, and the booking confirmation. No group message, fixed or from the model, SHALL contain:

- Calendar event titles, places, attendees or busy reasons of the organizer or any member.
- The organizer's rules, hours, notes, exceptions, weekly load or other requests.
- Which member's calendar blocks a time, or who said no time works.
- Members' emails, or whether a member connected a calendar, except the reuse question in "Member identity and the reuse question".
- A link code, booking link or `/app` link.

#### Scenario: Member asks why a time is missing
- **WHEN** a member writes "왜 목요일은 없어?" in an activated room
- **THEN** the bot says nothing about the organizer's calendar or rules, and no message reveals why Thursday is missing

#### Scenario: Member presses for private details
- **WHEN** a member asks the bot in the group to list the organizer's other meetings or who is busy on Thursday
- **THEN** the reply contains none of them, because the group conversation's context holds only the group projection

#### Scenario: Counts posted
- **WHEN** the group is shown the current counts
- **THEN** each time shows a number and the names who said it works, and no member's email, calendar connection or busy reason appears

### Requirement: Scheduling tools in the group conversation
Codes, `stop`, `그만` and `/kickout` SHALL be handled before a group message reaches eve's group conversation, whatever the model would do. While a room has an open group request, the group conversation SHALL get only these scheduling tools: the group projection, the poll link, and recording an answer for the sender of the current message, whose user ID SHALL come from the relay event and SHALL NOT be a tool argument. The group conversation SHALL have no tool that books, cancels, changes the request or reads any calendar, rule, private note or email. The introduction, the posted times, the confirmation, the reuse question and the goodbye SHALL be fixed templates.

#### Scenario: Stop never reaches the model
- **WHEN** a member sends `그만` in an activated room
- **THEN** the group request closes before the group conversation sees the message

#### Scenario: Model is asked to book
- **WHEN** a member asks the bot in the group to book time 2
- **THEN** nothing is booked, because the group conversation has no booking tool

#### Scenario: Replayed event
- **WHEN** the relay delivers the same answer message twice
- **THEN** the answer is recorded once

### Requirement: Group booking
The organizer SHALL book a group request by naming one candidate time from their own chat, `/app` or their agent. Booking SHALL recheck the organizer's conflict calendars for that time before dispatch. A time that no longer fits SHALL book nothing and leave the other times available. The event SHALL be created in the organizer's booking destination, with a fixed provider identity so it is created at most once. Its attendees SHALL be the members who left an email on the poll page. The group SHALL receive one confirmation with the time, the place or join link, and a calendar file link. After booking, the group request SHALL close, the scheduling tools SHALL leave the room's conversation, and the account SHALL stay in the room.

#### Scenario: Booking a settled poll
- **WHEN** the organizer books time 2 in their 1:1 chat and the time still fits
- **THEN** one event is created in the organizer's booking destination, members with an email are invited, the group gets one confirmation and the scheduling tools leave the room's conversation

#### Scenario: Chosen time became busy
- **WHEN** the organizer books a time that is now busy on their calendar
- **THEN** nothing is booked, the organizer is told, and they can choose another time

### Requirement: Group request lifetime and retention
A group request SHALL close only when it is booked, when the organizer cancels, or after `stop`; it SHALL NOT close because time has passed. When every candidate has passed, the organizer SHALL be asked once, in their own chat, for a new date range. Members' answers, display names and emails SHALL be deleted 30 days after the group request closes. No group message text SHALL be stored beyond parsing.

#### Scenario: Unbooked poll stays open
- **WHEN** a month passes after activation without a booking, a cancel or `stop`
- **THEN** the group request is still open and the room's conversation still has the scheduling tools

#### Scenario: All candidates have passed
- **WHEN** the last candidate time passes without a booking
- **THEN** the organizer is asked once in their own chat for a new date range, and the group is sent nothing

#### Scenario: Retention after closure
- **WHEN** 30 days pass after a group request closed
- **THEN** its members' answers, names and emails no longer exist

### Requirement: Member identity and the reuse question
A member's KakaoTalk identity SHALL be the sender's user ID from the Mac relay, remembered as a hash only. A member SHALL tie it to their poll page identity by sending, after Google sign-in, the one-time member code shown on the page, in the group or in a 1:1 chat with the account. The code SHALL be single-use and valid for 15 minutes, and the bot SHALL say nothing about it in the group. An activated room's member user IDs SHALL be kept as hashes while its group request is open. When a recognized member who connected Google in an earlier group writes in a newly activated group, the member SHALL be asked once, in that group, whether to reuse that connection, with yes, no and forget-me answers. Only an answer from the same KakaoTalk user ID SHALL count, and only a "yes" SHALL reuse the connection. The account SHALL NOT start a 1:1 chat with any member; it SHALL answer only 1:1 chats a member started. A member SHALL NOT be identified by profile name. The identity and its tie SHALL be deleted on **Forget me**, or 180 days after the member's last group request closed.

#### Scenario: Member code ties an identity
- **WHEN** a member signed in on the poll page sends the `FMAT-M` code shown there in the group
- **THEN** the sender's user ID is tied to that poll page identity, the page shows the tie, and the group gets no message about it

#### Scenario: Reuse question in the group
- **WHEN** a recognized member who connected Google before writes in a newly activated group
- **THEN** the bot asks them once in the group whether to reuse the connection, and names no calendar

#### Scenario: Someone else answers
- **WHEN** another member answers "네" to that question
- **THEN** the connection is not reused

#### Scenario: No first message
- **WHEN** a member has never written to the account 1:1
- **THEN** the account sends that member no 1:1 message

#### Scenario: Member says no
- **WHEN** the member answers "아니요" to the reuse question
- **THEN** the earlier connection is not used for that group, and the member can still connect or tick on the poll page

#### Scenario: Same profile name, different person
- **WHEN** a 1:1 sender whose profile name matches a member, but whose user ID is not in any activated group, writes to the account
- **THEN** the sender gets one fixed reply that names no group

### Requirement: Private notes from a member's 1:1 chat
A member of an activated group SHALL be able to tell the account, in that chat, limits they do not want to say in the group. The bot SHALL read the limits back in the 1:1 chat and SHALL apply them only after the member agrees. When the member is in more than one open group, the bot SHALL ask which group first. Applied limits SHALL count as that member's busy or less-preferred times for that group only. The note's text SHALL NOT be stored after the limits are confirmed. Neither the note, the limits nor the fact that a note exists SHALL appear in any group message or in the organizer's view. A 1:1 sender SHALL be matched to groups only by their user ID against the activated rooms' member lists. A sender in no activated group SHALL get one fixed reply that names no group.

#### Scenario: Private constraint shapes the times
- **WHEN** a member of an activated group writes "목요일 저녁은 안 된다고 단톡엔 말하기 좀 그래" and confirms the read-back
- **THEN** Thursday evening is treated as busy for that member, and the group sees only the resulting candidate times

#### Scenario: Group asks about a removed time
- **WHEN** a member asks in the group why a Thursday evening time disappeared
- **THEN** no group message mentions the note, the member or any reason

#### Scenario: Sender in no group sends a constraint
- **WHEN** a 1:1 sender whose user ID is in no activated group writes a constraint
- **THEN** nothing is applied, and the reply names no group

### Requirement: Leaving the room
A `/kickout` from any member of any group SHALL make the account post one fixed goodbye and leave that room. If the room has an open group request, it SHALL close as stopped and the organizer SHALL be told in their own chat. The account SHALL NOT leave a room on its own, booked or not. A leave that does not succeed SHALL keep the group request closed and SHALL be reported to the organizer, if there is one. While the phone is the active relay, `/kickout` SHALL only close the group request.

#### Scenario: Any member kicks the bot out
- **WHEN** a member who is not the organizer types `/kickout` in an activated room
- **THEN** the group gets one goodbye, the account leaves that room, and the organizer is told in their 1:1 chat

#### Scenario: Booked room stays
- **WHEN** a group's meeting was booked and has ended, and nobody sends `/kickout`
- **THEN** the account stays in the room, and its conversation has no scheduling tools

#### Scenario: Kickout from a room never activated
- **WHEN** a member types `/kickout` in a group where no code was ever posted
- **THEN** the account posts the goodbye and leaves, and no organizer is told

### Requirement: Confirming the room before posting or leaving
Before the Mac relay posts in or leaves a group whose name is missing or contained in another room's name, it SHALL open each chat-list row with that room's label in turn and act only in the window that shows the message being answered, with the same sender name and text. A post that answers no message SHALL need the window to show the room's three newest messages from the database, in order. When no window or more than one window matches, nothing SHALL be posted or left. The Mac relay's check after every send, and its check that only this room left the database after a leave, SHALL still apply.

#### Scenario: Untitled group
- **WHEN** a member types `/kickout` in a group with no name of its own
- **THEN** the relay opens the rows labeled with that group's member names, and leaves only the one whose window shows that `/kickout`

#### Scenario: Two rooms with the same name
- **WHEN** the account must post in a room whose name another room also has
- **THEN** only the room whose window shows the message being answered gets the post

#### Scenario: No window matches
- **WHEN** no opened window shows the message being answered
- **THEN** nothing is posted or left, and the outcome is reported as failed
