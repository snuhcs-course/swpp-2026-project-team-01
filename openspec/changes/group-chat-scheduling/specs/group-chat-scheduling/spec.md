## ADDED Requirements

### Requirement: Host recognition by KakaoTalk user ID
The service SHALL store a keyed hash of a linked host's KakaoTalk user ID on their KakaoTalk binding, taken from the user ID of their own bound 1:1 room on the KakaoTalk for Mac relay. A group message's sender SHALL be treated as a linked host only when the hash of its relay-reported user ID matches a binding. A profile name SHALL NOT make a sender a host. The hash SHALL be deleted with the binding.

#### Scenario: Host's user ID learned from their 1:1 chat
- **WHEN** a host who bound KakaoTalk writes in their 1:1 chat while the Mac relay is active
- **THEN** a hash of that room's member user ID is stored on the host's binding

#### Scenario: Copied host name in a group
- **WHEN** a member renames themselves to a linked host's profile name and calls the account to schedule
- **THEN** that member is not treated as the host, and no group request opens for the host

### Requirement: Starting a group request by calling the account
A member's message in a KakaoTalk group that calls the account and asks for a meeting SHALL be able to open a group request for that room. The organizer SHALL be the message's sender as reported by the relay, and the request SHALL open only when that sender is a linked, set-up host. Length, date range and mode SHALL come from the message, and the organizer's defaults SHALL fill what it leaves out. A caller who is not a linked, set-up host SHALL get one fixed reply with the public sign-up link, at most once per sender per day, and nothing SHALL open. A room SHALL hold at most one open group request. Group requests SHALL start only while the KakaoTalk for Mac relay is active. The service, not the model, SHALL decide whether a request opens, and the model's own reply to such a call SHALL be replaced by the fixed message.

#### Scenario: Linked host starts a group request
- **WHEN** a linked, set-up host writes "타임래빗, 이번 주 금요일 저녁 2시간 잡아줘" in a group
- **THEN** a group request opens for that room with the host as organizer, a two-hour meeting this Friday evening, and the group receives the introduction

#### Scenario: Caller who is not a host
- **WHEN** a member who is not a linked host calls the account and asks it to schedule a meeting
- **THEN** no group request opens, and the group gets one fixed reply with the sign-up link

#### Scenario: Request already open
- **WHEN** a linked host calls the account to schedule in a room that already has an open group request
- **THEN** no second request opens, and the bot reposts the existing poll link

#### Scenario: Phone relay active
- **WHEN** a linked host calls the account to schedule while the Android phone is the active relay
- **THEN** no group request opens

### Requirement: Booking authority
A group request SHALL be booked only by its organizer. In the group, booking SHALL come only from the fixed command `<n>번으로 확정` or `<n>번 확정`, handled before the model, from a message whose relay-reported user ID hashes to the organizer's binding and that came through the KakaoTalk for Mac relay. The organizer SHALL also be able to book from their own linked 1:1 chat, `/app`, or their connected agent with `host:decide`. No other group message SHALL book, cancel, reschedule or change a setting, and the group conversation SHALL have no tool that books or cancels.

#### Scenario: Organizer confirms in the group
- **WHEN** the organizer writes "2번으로 확정" in the group while the Mac relay is active
- **THEN** time 2 is rechecked and booked as described in "Group booking"

#### Scenario: Someone else confirms
- **WHEN** a member who is not the organizer, even one showing the organizer's profile name, writes "2번으로 확정"
- **THEN** nothing is booked

#### Scenario: Model asked to book
- **WHEN** a member calls the account and asks it to book time 2
- **THEN** nothing is booked, because the group conversation has no booking tool

### Requirement: One link with Google sign-in
The introduction SHALL link to the group's poll page and ask every member to sign in with Google there. Signing in SHALL need no Find Me a Time account and SHALL ask only for a read-only calendar grant bound to the group request, after which the member's busy times SHALL count with no further step. The grant SHALL yield busy times only. No event title, place, attendee or description from a member's calendar SHALL be stored, logged, shown to anyone or placed in model context. A member's Google address SHALL be used as an attendee email only if the member asks for the invitation. A member SHALL be recognized by their Google account: an existing host's saved conflict calendars, or a past member's remembered grant, SHALL count with no new consent screen, and the page SHALL name the calendars that count and offer **Don't use my calendar** and **Forget me**. A remembered grant SHALL be deleted on **Forget me**, or 180 days after the member's last group request closed. Whether a member signed in or used the product before SHALL NOT be revealed in the group.

#### Scenario: Member signs in
- **WHEN** a member signs in with Google on the poll page and has an event during an otherwise feasible time
- **THEN** that time is treated as busy for the meeting with no further step, and neither the group nor the organizer sees the event

#### Scenario: Returning member
- **WHEN** a member who signed in to an earlier group signs in on a new group's poll page with the same Google account
- **THEN** their remembered grant counts with no new consent screen, and nothing about it is said in the group

#### Scenario: Existing host opens the link
- **WHEN** a member signs in and that Google account is a host with saved conflict calendars
- **THEN** those calendars count, and the page names them and offers **Don't use my calendar**

#### Scenario: Forget me
- **WHEN** a remembered member presses **Forget me**
- **THEN** their remembered grant is deleted, and their calendar no longer counts in any open group

### Requirement: Candidate times from everyone's calendars
The group request SHALL offer at most five numbered candidate times, found by the organizer's feasibility over the request's date range, length and mode, with every signed-in member's busy times counted as busy, and spread across the range. When no time is free for the organizer and every signed-in member, the candidates SHALL be the organizer's feasible times that the most signed-in members can attend. In-person candidates SHALL be paired with the organizer's confirmed places. The expected number of members SHALL default to the room's member count less the account and the organizer. The numbered times SHALL be posted to the group as soon as that many members have signed in or ticked times, when anyone calls the account and asks for them, or 24 hours after the request opened, whichever comes first, without waiting for another group message. When a posted candidate stops being feasible, it SHALL be shown as unavailable with no reason and no name, and the other candidates SHALL keep their numbers.

#### Scenario: Expected members have signed in
- **WHEN** a room has six members besides the account and the organizer, and the sixth signs in on the poll page
- **THEN** the numbered times are posted to the group right away

#### Scenario: No time free for everyone
- **WHEN** no feasible time is free for every signed-in member
- **THEN** the times that the most signed-in members can attend are offered instead

#### Scenario: A late sign-in removes a posted time
- **WHEN** a member signs in after the times were posted and is busy during time 3
- **THEN** time 3 is shown as unavailable with no reason and no name, and the other times keep their numbers

### Requirement: Answers without a calendar
A member SHALL be able to answer by ticking times on the poll page, or, after the times are posted, by sending numbers in the group. A group message that holds only candidate numbers, separators and `번`, or `없음`, SHALL be recorded as its sender's answer before the model, whether or not it calls the account. An answer in words SHALL be recorded only through a call, for the sender of that message. A group answer SHALL be keyed by the sender's relay-reported user ID, SHALL replace only that user's earlier group answer, SHALL be shown under the sender's profile name, and SHALL be repeated by the bot in the group. All answers SHALL count the same, with no label. A poll page answer SHALL be editable and deletable only from the device that made it.

#### Scenario: Numbers in the group
- **WHEN** a member writes "1 3" in a room whose times are posted
- **THEN** times 1 and 3 are counted for that member, and the bot repeats them under their profile name

#### Scenario: Copied profile name
- **WHEN** a second member renames themselves to another member's profile name and writes "2"
- **THEN** a second answer is counted, and the first member's answer is unchanged

#### Scenario: Answer for someone else
- **WHEN** a member calls the account with "민수는 2번 된대"
- **THEN** no answer is recorded for 민수

#### Scenario: Member deletes their answer
- **WHEN** a member presses **Delete my answer** on the poll page from the device that answered
- **THEN** their name, times, email and calendar connection are deleted and the counts change

### Requirement: Introduction and stop
The first message to a room after a group request opens SHALL be a fixed template that says it comes from Find Me a Time, names the organizer by display name, states the meeting's length and range, gives the poll link and asks members to sign in with Google there, says that only busy times are read, says that anyone can write to the account 1:1 for what they would rather not say in the group, says that anyone can stop it, and links to the privacy policy. A whole message `stop` or `그만` from any member SHALL close the open group request as stopped before the model, remove the poll tools from the room's conversation, and tell the organizer in their own chat.

#### Scenario: Any member stops the scheduling
- **WHEN** a member who is not the organizer sends `그만` in a room with an open group request
- **THEN** the request closes as stopped before the group conversation sees the message, and the organizer is told in their 1:1 chat

### Requirement: What the group sees
The group projection, which is all that group scheduling gives to group messages and to the group conversation, SHALL contain only the organizer's display name, the meeting length, mode and date range, candidate times and their places, per-time counts and the display names of members who said a time works, the poll link, and the booking confirmation. No group message, fixed or from the model, SHALL contain:

- Calendar event titles, places, attendees or busy reasons of the organizer or any member.
- The organizer's rules, hours, notes, exceptions, weekly load or other requests.
- Which member's calendar blocks a time, or who said no time works.
- Members' emails, whether a member signed in, or whether they used the product before.
- A link code, booking link or account-specific `/app` link.

#### Scenario: Member asks why a time is missing
- **WHEN** a member calls the account and asks why Thursday is missing
- **THEN** the reply says nothing about the organizer's calendar or rules, or any member's

#### Scenario: Member presses for private details
- **WHEN** a member asks the account in the group to list the organizer's other meetings or who is busy on Thursday
- **THEN** the reply contains none of them, because the group conversation's context holds only the group projection

### Requirement: Scheduling tools in the group conversation
Bare numbers, the organizer's confirmation, `stop`, `그만` and `/kickout` SHALL be handled before a group message reaches eve's group conversation, whatever the model would do. A call SHALL get the tool that starts a group request in any group. While a room has an open group request, a call SHALL also get the group projection, the poll link, and recording an answer in words. Every such tool SHALL take its sender from the relay event and SHALL have no sender argument. The group conversation SHALL have no tool that books, cancels, or reads any calendar, rule, private note or email. The introduction, the sign-up reply, the posted times, the repeated answers, the confirmation and the goodbye SHALL be fixed templates.

#### Scenario: Stop never reaches the model
- **WHEN** a member sends `그만` in a room with an open group request
- **THEN** the request closes before the group conversation sees the message

#### Scenario: Replayed event
- **WHEN** the relay delivers the same answer message twice
- **THEN** the answer is recorded once

### Requirement: Group booking
Booking SHALL recheck the organizer's conflict calendars for the chosen time before dispatch. A time that no longer fits, is struck through or is not on the list SHALL book nothing and leave the other times available. The event SHALL be created in the organizer's booking destination, with a fixed provider identity so it is created at most once, and a second confirmation SHALL book nothing more. Its attendees SHALL be the members who asked for the invitation on the poll page. The group SHALL receive one confirmation with the time, the place or join link, and a calendar file link. After booking, the group request SHALL close, the poll tools SHALL leave the room's conversation, and the account SHALL stay in the room.

#### Scenario: Booking a time
- **WHEN** the organizer confirms time 2 and it still fits their calendars
- **THEN** one event is created in the organizer's booking destination, members who asked are invited, and the group gets one confirmation

#### Scenario: Chosen time became busy
- **WHEN** the organizer confirms a time that is now busy on their calendar
- **THEN** nothing is booked, and the group is told that the time is no longer open, with no reason

#### Scenario: Repeated confirmation
- **WHEN** the organizer sends "2번으로 확정" again after the request was booked
- **THEN** no second event is created

### Requirement: Group request lifetime and retention
A group request SHALL close only when it is booked, when the organizer cancels, or after `stop`; it SHALL NOT close because time has passed. When every candidate has passed, the organizer SHALL be asked once, in their own chat, for a new date range. Members' answers, display names, emails and KakaoTalk user ID hashes for the request SHALL be deleted 30 days after it closes.

#### Scenario: Unbooked poll stays open
- **WHEN** a month passes after a request opened without a booking, a cancel or `stop`
- **THEN** the request is still open

#### Scenario: All candidates have passed
- **WHEN** the last candidate time passes without a booking
- **THEN** the organizer is asked once in their own chat for a new date range, and the group is sent nothing

#### Scenario: Retention after closure
- **WHEN** 30 days pass after a group request closed
- **THEN** its members' answers, names, emails and user ID hashes no longer exist

### Requirement: Member identity
On the poll page a member SHALL be identified by their Google account or by the device that ticked. In a group a member SHALL be identified by the relay-reported KakaoTalk user ID, kept only as a keyed hash. The two SHALL NOT be tied together, and there SHALL be no member code or reuse question. While a room has an open group request, its member user IDs SHALL be kept as hashes. A member SHALL NOT be identified by profile name. The account SHALL NOT start a 1:1 chat with any member.

#### Scenario: No question about a past connection
- **WHEN** a member who signed in to an earlier group writes in a room with a new group request
- **THEN** the bot asks them nothing about it

#### Scenario: No first message
- **WHEN** a member has never written to the account 1:1
- **THEN** the account sends that member no 1:1 message

### Requirement: Private notes from a member's 1:1 chat
A member of a room with an open group request SHALL be able to tell the account, in their 1:1 chat, limits they do not want to say in the group. A 1:1 sender SHALL be matched to groups only by their user ID hash against the open requests' member lists. The bot SHALL read the limits back and SHALL apply them only after the member agrees. When the member is in more than one open group, the bot SHALL ask which one first. Applied limits SHALL count as that member's busy or less-preferred times for that group only. The note's text SHALL NOT be stored after the limits are confirmed. Neither the note, the limits nor the fact that a note exists SHALL appear in any group message or in the organizer's view.

#### Scenario: Private constraint shapes the times
- **WHEN** a member writes "목요일 저녁은 안 된다고 단톡엔 말하기 좀 그래" in their 1:1 chat and confirms the read-back
- **THEN** Thursday evening is treated as busy for that member, and the group sees only the resulting candidate times

#### Scenario: Same profile name, different person
- **WHEN** a 1:1 sender whose profile name matches a member, but whose user ID is in no open group, writes a constraint
- **THEN** nothing is applied to any group

### Requirement: Leaving the room
A whole message `/kickout` from any member of any group SHALL make the account post one fixed goodbye and leave that room. If the room has an open group request, it SHALL close as stopped and the organizer SHALL be told in their own chat. The account SHALL NOT leave a room on its own, booked or not. A leave that does not succeed SHALL keep the group request closed and SHALL be reported to the organizer, if there is one.

#### Scenario: Any member kicks the account out
- **WHEN** a member who is not the organizer types `/kickout` in a room with an open group request
- **THEN** the group gets one goodbye, the account leaves that room, and the organizer is told in their 1:1 chat

#### Scenario: Booked room stays
- **WHEN** a group's meeting was booked and has ended, and nobody sends `/kickout`
- **THEN** the account stays in the room

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
