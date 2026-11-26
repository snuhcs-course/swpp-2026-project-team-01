## ADDED Requirements

### Requirement: Host recognition by KakaoTalk user ID
The service SHALL store a keyed hash of a linked host's KakaoTalk user ID on their KakaoTalk binding, taken from the user ID of their own bound 1:1 room on the KakaoTalk for Mac relay. A group message's sender SHALL be treated as a linked host only when the hash of its relay-reported user ID matches a binding. A profile name SHALL NOT make a sender a host. The hash SHALL be deleted with the binding.

#### Scenario: Host's user ID learned from their 1:1 chat
- **WHEN** a host who bound KakaoTalk writes in their 1:1 chat while the Mac relay is active
- **THEN** a hash of that room's member user ID is stored on the host's binding

#### Scenario: Copied host name in a group
- **WHEN** a member renames themselves to a linked host's profile name and calls the account to schedule
- **THEN** that member is not treated as the host, and no group meeting is created

### Requirement: Group meeting started from a KakaoTalk group
A message in a KakaoTalk group that calls the account and asks for a meeting SHALL create a `group-scheduling` group meeting bound to that room, with the message's relay-reported sender as organizer, whether or not the sender has an account. The meeting SHALL keep a keyed hash of the organizer's user ID. A linked, set-up host's meeting SHALL use that host's settings; any other caller's meeting SHALL start with an untied organizer, as "Organizer with no account". The meeting's purpose SHALL default to the room's title, and its number of people SHALL default to the room's member count less the account and the organizer. A missing length or date range SHALL be asked for once in the room and SHALL be filled only by the organizer. A caller SHALL organize at most three meetings that are not booked or cancelled. A room SHALL be bound to at most one meeting that is not booked or cancelled. Meetings SHALL start from a room only while the KakaoTalk for Mac relay is active. The service, not the model, SHALL decide whether a meeting is created, and the model's own reply to such a call SHALL be replaced by a fixed message. A linked host SHALL also be told in their linked conversation, where the meeting then works as any group meeting does.

#### Scenario: Linked host starts from the group
- **WHEN** a linked, set-up host writes "타임래빗, 다음 주 금요일 저녁 2시간 잡아줘" in a group of seven members besides the account
- **THEN** a group meeting for six people, two hours long, next Friday evening, is created for that host and bound to the room, and the room receives the introduction with the meeting's shared link

#### Scenario: Caller with no account
- **WHEN** a member with no Find Me a Time account calls the account and asks it to schedule a meeting
- **THEN** a meeting is created with that member as untied organizer, and the room gets the introduction with the link and the request that the caller sign in and post the number shown

#### Scenario: Caller at the limit
- **WHEN** a member who already organizes three live meetings calls the account to start another
- **THEN** nothing is created

#### Scenario: Missing date range
- **WHEN** the organizer's call gives a length but no dates
- **THEN** the account asks once in the room for the date range, and nothing is created until the organizer gives it

#### Scenario: Room already bound
- **WHEN** a linked host calls the account to schedule in a room bound to an open meeting
- **THEN** nothing new is created, and the bot reposts that meeting's link

### Requirement: Organizer with no account
For a meeting with an untied organizer, the shared link SHALL let a person sign in with Google, with Calendar read and event-create access, and SHALL then show a six-digit number valid for 15 minutes and bound to that page session. A room message that is that number SHALL tie the session's Google account to the meeting as organizer only when its relay-reported user ID hashes to the meeting's organizer ID and it came through the KakaoTalk for Mac relay. From any other user ID it SHALL tie nothing. Five wrong numbers from the organizer's ID SHALL end that page session. Once tied, the account's confirmed calendars SHALL count as the organizer's, meeting hours SHALL default to 09:00 to 22:00 every day of the range, the organizer SHALL have no places of their own, and the event SHALL be booked in the account's primary calendar. The grant SHALL be used only for this meeting and SHALL end with it, and no host account or workspace SHALL be created. A tied account that is a set-up host's SHALL use that host's settings. Options SHALL NOT be computed while the organizer is untied. When the meeting fills with an untied organizer, the room SHALL be reminded once. A meeting still untied seven days after it started SHALL be cancelled and the room told once. An organizer with no account SHALL get the options and confirm only in the room.

#### Scenario: Caller ties their sign-in
- **WHEN** the caller signs in on the link and posts the number the page shows in the room
- **THEN** their Google account becomes the meeting's organizer, and the room gets one fixed line saying so

#### Scenario: Another member tries to claim the meeting
- **WHEN** another member signs in on the link as organizer and posts the number their page shows
- **THEN** nothing is tied, because the message's user ID is not the organizer's

#### Scenario: Caller's number posted by someone else
- **WHEN** a member copies the caller's number from the room and posts it again
- **THEN** nothing changes, because the number is bound to the caller's page session and user ID

#### Scenario: Organizer never signs in
- **WHEN** a meeting's organizer is still untied seven days after the call
- **THEN** the meeting is cancelled and the room is told once

#### Scenario: Meeting fills before the organizer ties
- **WHEN** the last expected participant is done and the organizer is untied
- **THEN** no options are posted, and the room is reminded once to have the caller sign in and post the number

### Requirement: Participants answer only on the shared link
Members SHALL take part only through the bound meeting's `group-scheduling` shared link and participant flow. No message in the room SHALL record availability or any answer for a participant.

#### Scenario: Numbers in the room
- **WHEN** a member writes "1 3" in a bound room
- **THEN** nothing is recorded for that member

### Requirement: What the room sees
Every post to a bound room, and the group conversation's context, SHALL contain only the organizer's display name, the meeting's purpose, length and date range, the shared link, the number of done participants against the set number, the numbered options with their time, place or online mode and the number of done participants who can make each, and the confirmation. No room post, fixed or from the model, SHALL contain:

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

### Requirement: Options posted to the room
When a bound meeting closes, the room SHALL receive the options that `group-scheduling` sends the organizer, with the same numbers, each with the number of done participants who can make it and no names. When the organizer asks for more options, the new options SHALL go to the room as well, continuing the numbering. The organizer SHALL be able to close the meeting early by calling the account in the room, and that call SHALL close it only when its relay-reported sender is the organizer.

#### Scenario: Meeting fills
- **WHEN** the last expected participant is done
- **THEN** the organizer gets `group-scheduling`'s notice, and the room gets the same numbered options with counts and no names, without waiting for another room message

#### Scenario: Someone else asks to close
- **WHEN** a member who is not the organizer calls the account and asks it to close the meeting now
- **THEN** the meeting stays open

### Requirement: Organizer confirms in the room
The organizer SHALL be able to book an offered option by the fixed command `<n>번으로 확정` or `<n>번 확정` in the bound room, handled before the model, from a message whose relay-reported user ID hashes to the organizer's binding and that came through the KakaoTalk for Mac relay. A linked host SHALL still be able to choose in their linked conversation. Booking SHALL follow `group-scheduling`'s host choice, including the recheck of the organizer's calendars. A recheck that fails SHALL book nothing and tell the room the option is no longer open, with no reason. A second confirmation SHALL book nothing more. The room SHALL receive one fixed confirmation, after which the binding SHALL end. No other room message SHALL book, cancel or change the meeting, and the group conversation SHALL have no tool that books or cancels.

#### Scenario: Organizer confirms
- **WHEN** the organizer writes "2번으로 확정" in the room after the options were posted
- **THEN** option 2 is booked as one event with every done participant as an attendee, and the room gets one confirmation

#### Scenario: Someone else confirms
- **WHEN** a member who is not the organizer, even one showing the organizer's profile name, writes "2번으로 확정"
- **THEN** nothing is booked

#### Scenario: Model asked to book
- **WHEN** a member calls the account and asks it to book option 2
- **THEN** nothing is booked, because the group conversation has no booking tool

#### Scenario: Option became busy
- **WHEN** the organizer confirms an option that is now busy on their calendar
- **THEN** nothing is booked, and the room is told the option is no longer open, with no reason

### Requirement: Commands and tools in the group conversation
The organizer's confirmation, the organizer's six-digit number, `stop`, `그만` and `/kickout` SHALL be handled before a group message reaches eve's group conversation, whatever the model would do. A call SHALL get the tool that starts a group meeting in any group. While a room is bound, a call SHALL also get the room projection, the shared link and the early close. Every such tool SHALL take its sender from the relay event and SHALL have no sender argument. The introduction, the organizer prompt and tie line, the options, the confirmation and the goodbye SHALL be fixed templates.

#### Scenario: Stop never reaches the model
- **WHEN** a member sends `그만` in a bound room
- **THEN** the binding ends before the group conversation sees the message

### Requirement: Introduction and stop
The first post to a newly bound room SHALL be a fixed template that says it comes from Find Me a Time, names the organizer, states the meeting's purpose, length and range, gives the shared link with what it collects, says that anyone can stop it in the room, and links to the privacy policy. A whole message `stop` or `그만` from any member SHALL end the room binding: nothing more about the meeting SHALL be posted in the room. A linked host SHALL be told in their linked conversation, where the meeting goes on. A meeting whose organizer has no account SHALL be cancelled. The account SHALL NOT start a 1:1 chat with any member. A room binding SHALL be deleted 30 days after it ends.

#### Scenario: Any member stops the bot in the room
- **WHEN** a member who is not the organizer sends `그만` in a room bound to a linked host's meeting
- **THEN** the room gets nothing more about the meeting, the meeting stays open, and the host is told in their linked conversation

#### Scenario: Stop with an organizer who has no account
- **WHEN** a member sends `그만` in a room whose meeting's organizer has no account
- **THEN** the meeting is cancelled

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
