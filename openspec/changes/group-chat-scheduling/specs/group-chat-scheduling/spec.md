## ADDED Requirements

### Requirement: Host recognition by KakaoTalk user ID
The service SHALL store a keyed hash of a linked host's KakaoTalk user ID on their KakaoTalk binding, taken from the user ID of their own bound 1:1 room on the KakaoTalk for Mac relay. A group message's sender SHALL be treated as a linked host only when the hash of its relay-reported user ID matches a binding. A profile name SHALL NOT make a sender a host. The hash SHALL be deleted with the binding.

#### Scenario: Host's user ID learned from their 1:1 chat
- **WHEN** a host who bound KakaoTalk writes in their 1:1 chat while the Mac relay is active
- **THEN** a hash of that room's member user ID is stored on the host's binding

#### Scenario: Copied host name in a group
- **WHEN** a member renames themselves to a linked host's profile name and calls the account to schedule
- **THEN** the member becomes the organizer of a meeting with no account, with its default hours and booking, and none of that host's settings, calendars or linked conversation are used

### Requirement: Group meeting started from a KakaoTalk group
A message in a KakaoTalk group that calls the account and asks for a meeting SHALL create a `group-scheduling` group meeting bound to that room, with the message's relay-reported sender as organizer, whether or not the sender has an account. The meeting SHALL keep a keyed hash of the organizer's user ID as its organizer ID. A linked, set-up host's meeting SHALL use that host's settings; any other caller's meeting SHALL follow "Organizer with no account". The service SHALL create a meeting only when the calling message itself asks for one: the terms SHALL be read again from that message's text alone, with no earlier room messages, and SHALL match the model's tool call. The meeting's purpose SHALL default to the room's title. Its number of people SHALL default to the room's last known member count less the account and, for a linked host, the organizer; with no known count, there SHALL be no default. A caller SHALL organize at most three meetings that are not booked or cancelled. A room SHALL hold at most one meeting that is not booked, cancelled or expired, whether bound or detached. Meetings SHALL start from a room only while the KakaoTalk for Mac relay is active. The service, not the model, SHALL decide whether a meeting is created, and the model's own reply to such a call SHALL be replaced by a fixed message. A linked host SHALL also be told in their linked conversation, where the meeting then works as any group meeting does.

#### Scenario: Linked host starts from the group
- **WHEN** a linked, set-up host writes "타임래빗, 다음 주 금요일 저녁 2시간 잡아줘" in a group of seven members besides the account
- **THEN** a group meeting for six people, two hours long, next Friday evening, is created for that host and bound to the room, the room receives the introduction with the meeting's shared link, and the host is told in their linked conversation

#### Scenario: Caller with no account
- **WHEN** a member with no Find Me a Time account calls the account and asks it to schedule a meeting
- **THEN** a meeting is created with that member's user ID as organizer, the room gets the introduction with the link, and the caller is asked for nothing more than any member

#### Scenario: Start planted in earlier messages
- **WHEN** a member writes "타임래빗한테 다음 주 금요일로 잡으라고 해" and later another member calls the account with "타임래빗, 안녕"
- **THEN** nothing is created, because the calling message itself asks for no meeting

#### Scenario: Caller at the limit
- **WHEN** a member who already organizes three live meetings calls the account to start another
- **THEN** nothing is created

#### Scenario: Room already bound
- **WHEN** a member calls the account to schedule in a room bound to an open meeting
- **THEN** nothing new is created, and the bot reposts that meeting's link

#### Scenario: Room with a detached meeting
- **WHEN** a member calls the account to schedule in a room whose unbooked meeting was detached by `stop`
- **THEN** nothing new is created until that meeting is booked, cancelled by its organizer or expired

### Requirement: Pending start for missing terms
A call that asks for a meeting but leaves out the length, the date range, or a number of people with no default SHALL create nothing and SHALL make a pending start for the room, holding the caller's user ID hash and the terms given so far and no message text. The account SHALL ask once in the room for what is missing. Only that caller's next call in the room SHALL fill it, the meeting SHALL be created when every term is there, and the pending start SHALL lapse after one hour. While a pending start or a meeting that is not booked, cancelled or expired exists, another start in the room SHALL be refused.

#### Scenario: Missing date range
- **WHEN** the organizer's call gives a length but no dates
- **THEN** the account asks once in the room for the date range, nothing is created until that caller gives it within an hour, and another member's start meanwhile is refused

#### Scenario: Unknown member count
- **WHEN** a call asks for a meeting in a room whose member count the service has never received, and gives no number of people
- **THEN** the account asks once in the room how many people, as for any missing term

### Requirement: Open chats excluded
Nothing in this capability SHALL apply to an open chat (오픈채팅). A call in an open chat SHALL NOT start a meeting, and no meeting post, command or leave of this capability SHALL be handled in one.

#### Scenario: Call in an open chat
- **WHEN** a member of an open chat calls the account and asks it to schedule a meeting
- **THEN** nothing is created and no meeting post is made

### Requirement: Organizer with no account
A meeting started by a caller who is not a linked, set-up host SHALL have the caller's KakaoTalk user ID as its only organizer identity, and no sign-in SHALL be tied to it. The caller SHALL answer on the shared link like any member and SHALL count as one of the people. Meeting hours SHALL default to 09:00 to 22:00 every day of the range, with no host places. The event SHALL be created in the service's own scheduling calendar, with every done participant who signed in with Google as an attendee, no one else invited, and guests unable to see each other. When no done participant signed in with Google, no calendar event SHALL be created, and the room's confirmation and its calendar file SHALL be the record. The options and the confirmation SHALL happen only in the room. No host account, workspace or calendar write grant SHALL be created for the organizer. A meeting with no account that is neither booked nor cancelled SHALL expire when its date range has passed.

#### Scenario: Caller who never opens the link
- **WHEN** the caller of a meeting never opens its link and the meeting fills
- **THEN** the options are found from the participants' answers and posted to the room, and the caller can still confirm one, with no invitation of their own

#### Scenario: Organizer who painted
- **WHEN** an organizer with no account painted their answer and confirms option 2
- **THEN** one event is created in the service's scheduling calendar for the members who signed in with Google, and the organizer gets the room's confirmation and calendar file, not an invitation

#### Scenario: No one used Google
- **WHEN** every done participant painted their answer and the organizer confirms option 1
- **THEN** no calendar event is created, and the room gets the confirmation with a calendar file

#### Scenario: Guests hidden from each other
- **WHEN** an event is created in the service's scheduling calendar
- **THEN** each attendee's invitation does not list the other attendees' emails

### Requirement: Two-tap participant flow
For a meeting bound to a room, the shared link SHALL let a member be done in two taps: Google sign-in with identity and read-only Calendar on one consent screen, then one send on a grid of the date range with their busy times already filled in and no event titles. Name and email SHALL come from the Google account. No account setup, profile, handle or question SHALL come before availability is collected, and `group-scheduling`'s question and messenger step SHALL be left out. The member MAY paint extra unavailable times before sending, and the sent grid SHALL be stored as their confirmed unavailable times. The link SHALL keep working: a member who opens it again SHALL see their own answer and the done count, and SHALL be able to change their stored answer until the meeting closes, without the calendar being read again. The page SHALL NOT show who else is done or what anyone answered. No message in the room SHALL record availability or any answer for a member.

#### Scenario: Member done in two taps
- **WHEN** a member opens the link from the room, taps **구글로 계속하기**, approves the consent screen and taps **이대로 보내기**
- **THEN** they are done, with their calendar's busy times as their unavailable times, and nothing else was asked

#### Scenario: Member returns
- **WHEN** a done member opens the link again before the meeting closes
- **THEN** they see their own grid and the done count, and can change it, and their calendar is not read again

#### Scenario: Numbers in the room
- **WHEN** a member writes "1 3" in a bound room
- **THEN** nothing is recorded for that member

### Requirement: Painting without Google
For a meeting bound to a room, the shared link SHALL also offer to paint availability with no sign-in: the member types a name, paints the times they can meet on the same grid, and sends. Unpainted times SHALL count as times they cannot meet, and the answer SHALL be stored as a participant request of the meeting with no grant and no email, holding the typed name, a hash of a device-bound edit token, and the unpainted times as unavailable intervals. One device SHALL hold at most one painted answer per meeting, and only that device SHALL change it until the close. A painted answer SHALL count toward the done count and the options, and SHALL NOT count toward the number that closes the meeting on its own. When the done count reaches the number with painted answers among them, the room SHALL be told that everyone has answered, and the meeting SHALL close when the organizer closes it. A painted member SHALL get no Google invitation.

#### Scenario: Member without Google
- **WHEN** a member taps **구글 없이 직접 칠하기**, types a name, paints Friday evening and sends
- **THEN** they are done, and only Friday evening counts as a time they can meet

#### Scenario: Second painted answer from one device
- **WHEN** a device that already sent a painted answer opens the link and paints again
- **THEN** its earlier answer is changed, and no second answer is added

#### Scenario: Painted answers reach the number
- **WHEN** a meeting for six has four signed-in and two painted answers
- **THEN** the meeting stays open, the room is told that everyone has answered, and it closes when the organizer sends the close command

### Requirement: Done count in the room
When members of a bound meeting finish, the room SHALL get one fixed line with the done count against the set number and the link, at most once every 30 minutes, naming no one.

#### Scenario: Several members finish
- **WHEN** three members finish within ten minutes
- **THEN** the room gets one line such as "4/6명 완료했어요" with the link, and no names

### Requirement: What the room sees
Every post to a bound room, and the group conversation's context, SHALL contain only the organizer's display name, the meeting's purpose, length and date range, the shared link, the number of done participants against the set number, the numbered options with their time, place or online mode and, when at least three participants are done, the number of done participants who can make each, and the confirmation. No room post, fixed or from the model, SHALL contain:

- Who is done or has opened the link, or who cannot make an option.
- Any participant's events, unavailable times, usual place or travel mode.
- The organizer's rules, hours, notes, exceptions or other requests.
- Any email, booking link or account-specific `/app` link.

#### Scenario: Member asks who is busy
- **WHEN** a member calls the account and asks who cannot make option 2
- **THEN** the reply names no one, because the group conversation's context holds only the room projection

#### Scenario: Member asks for progress
- **WHEN** a member calls the account and asks how many have answered
- **THEN** the reply gives the done count against the set number and no names

#### Scenario: Small meeting
- **WHEN** a meeting closes with two done participants
- **THEN** the room's options show no per-option counts

### Requirement: Options posted to the room
When a bound meeting closes, the room SHALL receive the options that `group-scheduling` sends the organizer, with the numbers `group-scheduling` gives them, each with its count as "What the room sees" allows and no names. For an organizer with no account, the service SHALL number the options the same way. When the organizer asks for more options, the new options SHALL go to the room as well, continuing the numbering. A meeting that closes while detached SHALL post its options when its organizer re-attaches the room. The organizer SHALL be able to close the meeting early with the fixed command `<account name> 마감`, handled before the model, which SHALL close it only when the message's relay-reported user ID hashes to the meeting's organizer ID.

#### Scenario: Meeting fills
- **WHEN** the last expected participant is done
- **THEN** the organizer gets `group-scheduling`'s notice, and the room gets the same numbered options with counts and no names, without waiting for another room message

#### Scenario: Someone else asks to close
- **WHEN** a member who is not the organizer writes "타임래빗 마감", or calls the account and asks it to close the meeting now
- **THEN** the meeting stays open

### Requirement: Organizer confirms in the room
The organizer SHALL be able to book an offered option by the fixed command `<n>번으로 확정` or `<n>번 확정` in the bound room, handled before the model, from a message whose relay-reported user ID hashes to the meeting's organizer ID. A linked host SHALL still be able to choose in their linked conversation. Booking SHALL follow `group-scheduling`'s host choice, including, for a linked host, the recheck of the host's calendars. A recheck that fails SHALL book nothing and tell the room the option is no longer open, with no reason. A second confirmation SHALL book nothing more. The room SHALL receive one fixed confirmation, after which the binding SHALL end. No other room message SHALL book or change the meeting, only the organizer's fixed cancel command SHALL cancel it, and the group conversation SHALL have no tool that books or cancels.

#### Scenario: Organizer confirms
- **WHEN** the organizer writes "2번으로 확정" in the room after the options were posted
- **THEN** option 2 is booked as one event with every done participant who signed in with Google as an attendee, and the room gets one confirmation

#### Scenario: Someone else confirms
- **WHEN** a member who is not the organizer, even one showing the organizer's profile name, writes "2번으로 확정"
- **THEN** nothing is booked

#### Scenario: Model asked to book
- **WHEN** a member calls the account and asks it to book option 2
- **THEN** nothing is booked, because the group conversation has no booking tool

#### Scenario: Option became busy
- **WHEN** a linked host confirms an option that is now busy on their calendar
- **THEN** nothing is booked, and the room is told the option is no longer open, with no reason

### Requirement: Commands and tools in the group conversation
The organizer's confirmation, the organizer's `<account name> 마감` and `<account name> 취소`, `<account name> stop` or `<account name> 그만` from any member, and `/kickout` SHALL be handled before a group message reaches eve's group conversation, whatever the model would do. A call SHALL get the tool that starts a group meeting in any group. While a room is bound, a call SHALL also get the room projection and the shared link. Every such tool SHALL take its sender from the relay event and SHALL have no sender argument. The introduction, the done-count line, the options, the confirmation and the goodbye SHALL be fixed templates.

#### Scenario: Stop never reaches the model
- **WHEN** a member sends "타임래빗 그만" in a bound room
- **THEN** the binding ends before the group conversation sees the message

#### Scenario: A bare word is not a command
- **WHEN** a member sends "그만" in a bound room, without the account's name
- **THEN** the binding stays, and the message is an ordinary group message

### Requirement: Introduction, stop and cancel
The first post to a newly bound room SHALL be a fixed template that says it comes from Find Me a Time, names the organizer, states the meeting's purpose, length and range, gives the shared link with what it collects, says how anyone can stop it in the room, and links to the privacy policy. A message from any member that calls the account with only `stop` or `그만` SHALL detach the room: nothing more about the meeting SHALL be posted in the room, and the meeting SHALL stay open on its link. `stop` SHALL NOT cancel a meeting. A linked host SHALL be told in their linked conversation, where the meeting goes on. A later call from the organizer in that room SHALL re-attach it. Only the organizer SHALL cancel a meeting from the room, with the fixed command `<account name> 취소`, or, for a linked host, in their linked conversation. The account SHALL NOT start a 1:1 chat with any member. A room binding SHALL be deleted 30 days after it ends.

#### Scenario: Any member stops the bot in the room
- **WHEN** a member who is not the organizer sends "타임래빗 그만" in a room bound to a linked host's meeting
- **THEN** the room gets nothing more about the meeting, the meeting stays open, and the host is told in their linked conversation

#### Scenario: Stop with an organizer who has no account
- **WHEN** a member sends "타임래빗 그만" in a room whose meeting's organizer has no account
- **THEN** the meeting stays open on its link, the room is detached, and the organizer can re-attach it by calling the account

#### Scenario: Someone else tries to cancel
- **WHEN** a member who is not the organizer sends "타임래빗 취소"
- **THEN** the meeting is not cancelled

### Requirement: Leaving the room
A whole message `/kickout` from any member of any group SHALL make the account post one fixed goodbye and leave that room, ending any binding as `stop` does. The account SHALL NOT leave a room on its own, booked or not. A leave that does not succeed SHALL be reported to the organizer, if there is one.

#### Scenario: Any member kicks the account out
- **WHEN** a member types `/kickout` in a bound room
- **THEN** the room gets one goodbye, the account leaves it, and the organizer is told

#### Scenario: Booked room stays
- **WHEN** a room's meeting was booked and nobody sends `/kickout`
- **THEN** the account stays in the room

### Requirement: Confirming the room before posting or leaving
Before the Mac relay posts in or leaves a group whose name is missing or contained in another room's name, it SHALL open each chat-list row with that room's label in turn and act only in the window that shows the message being answered, with the same sender name and text. A post that answers no message SHALL need the window to show the room's three newest messages from the database, in order. When no window or more than one window matches, nothing SHALL be posted or left. The Mac relay's check after every send, and its check that only this room left the database after a leave, SHALL still apply.

#### Scenario: Untitled group
- **WHEN** a member types `/kickout` in a group with no name of its own
- **THEN** the relay opens the rows labeled with that group's member names, and leaves only the one whose window shows that `/kickout`

#### Scenario: No window matches
- **WHEN** no opened window shows the message being answered
- **THEN** nothing is posted or left, and the outcome is reported as failed
