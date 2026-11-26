## ADDED Requirements

### Requirement: One active KakaoTalk relay
The service SHALL act on requests from one KakaoTalk relay at a time, chosen by the deployment's configuration as either the Mac relay or the Android relay, with the Android relay as the default. Each relay request SHALL say inside its signed body which relay sent it, and a body that names no relay SHALL count as the Android relay. A webhook event, claim or heartbeat from the relay that is not active SHALL be answered `409` and SHALL store no receipt, create no lease and change no relay health. A result report SHALL be decided by its lease token alone, whichever relay sends it. The service SHALL hand out no claim until the last heartbeat came from the active relay.

#### Scenario: Standby phone still running
- **WHEN** the Mac relay is active and the Android relay posts a message event and a claim
- **THEN** both are answered `409`, no receipt is stored and no message is leased

#### Scenario: Switch to the Mac relay
- **WHEN** the active relay is changed from the Android relay to the Mac relay
- **THEN** no message is handed out until the Mac relay's first heartbeat, and a lease the phone held can still be reported with its token

### Requirement: Mac relay events from the KakaoTalk database
The Mac relay SHALL read new messages from KakaoTalk for Mac's database in log order and SHALL post one event per message written by another person in a 1:1 chat, with the room's ID, the message's log ID, the sender's user ID and name from the database, and the text. It SHALL NOT forward messages the account wrote, messages from before its first start, or Kakao account notices. It SHALL keep forwarding an event until the service acknowledges it, across restarts, and the service SHALL store each log ID once.

#### Scenario: Host writes on the Mac relay
- **WHEN** a bound host sends a 1:1 message that appears in the Mac database
- **THEN** one receipt with channel `kakaotalk` is stored for that room, and the binding made earlier applies to it

#### Scenario: Relay restarts before acknowledgment
- **WHEN** the relay stops after posting an event and before the acknowledgment, and starts again
- **THEN** it posts the event again and the service stores no second receipt

#### Scenario: Own message
- **WHEN** the relay sends a reply that then appears in the database
- **THEN** no event is posted for it

### Requirement: Group chats on the Mac relay
The Mac relay SHALL forward no text from a group chat or an open chat. A pending link code seen there SHALL be forwarded only as its keyed hash, as on the Android relay. When membership events are turned on, the relay SHALL post a group's member user IDs and member count, with no names and no text, when the member list changes, and the service SHALL store nothing for them in this change.

#### Scenario: Code in a group on the Mac relay
- **WHEN** a pending link code is sent in a group chat that the account is in
- **THEN** the attempt is void, and no text reaches the service

#### Scenario: Member joins a group
- **WHEN** membership events are on and a member is invited to a group the account is in
- **THEN** the relay posts the new member list of user IDs, and no receipt is stored

### Requirement: Mac relay sends only to an exactly matched room
The Mac relay SHALL send a message to a room only when the room's chat-list name is not empty and no other room's name contains it, ignoring case, and only when, just before sending, exactly one chat-list row contains that name and that row's name equals it. When either check fails, it SHALL send nothing and report `failed`. After each send it SHALL look in the database for the sent text from the account, newer than the send, and SHALL report `accepted` only when it is in the expected room. A message found in another room SHALL be reported `uncertain` with the reason `wrong_room`, and the service SHALL record an operational alert. A message not found SHALL be reported `uncertain`.

#### Scenario: Unique name
- **WHEN** a reply is claimed for a room whose name no other room contains and the chat list shows it once
- **THEN** the relay sends it and reports `accepted` after the message appears in that room

#### Scenario: Name contained in another room's name
- **WHEN** a reply is claimed for a room named "Kim" while another room is named "Kim Jisoo"
- **THEN** the room is not listed as sendable, and the reply stays queued

#### Scenario: Message lands in another room
- **WHEN** the relay sends a reply and the text appears in a different room
- **THEN** the relay reports `uncertain` with reason `wrong_room`, the message is never sent again, and an alert is recorded

### Requirement: No first message in a KakaoTalk 1:1 chat
The Mac relay SHALL send into a 1:1 room only after the other person has written in it. It SHALL never send the nudge, and the service SHALL hand the Mac relay no nudge.

#### Scenario: Friend who never wrote
- **WHEN** a message is queued for a 1:1 room whose other member has no message in it
- **THEN** the relay does not list the room as sendable, nothing is sent, and no nudge is created

### Requirement: Mac relay claims
While the Mac relay is active, the service SHALL hand it private content in reply mode only for rooms its claim lists as sendable, after the same claim-time checks as for the Android relay. The service SHALL hand out nothing while the Mac relay reports its screen locked, and the relay SHALL not claim while locked. A setup or schedule review SHALL be sent as a link to `/app`, as on the Android relay.

#### Scenario: Screen locked
- **WHEN** the Mac relay's last heartbeat reports the screen locked
- **THEN** no message is handed out, and queued messages stay queued

#### Scenario: Notice for a bound host
- **WHEN** a summary is queued for a bound host whose room the Mac relay lists as sendable
- **THEN** the summary is handed out in reply mode with no nudge first

### Requirement: Leaving a KakaoTalk group room
The service SHALL be able to queue a request to leave a group room, which carries no text. It SHALL hand it only to the Mac relay, in leave mode, while the room is among the group rooms the relay's claim lists, and SHALL suppress it when the Mac relay no longer lists the room or while the Android relay is active. The relay SHALL leave through the room's own window and report `accepted` only when the database shows the account left.

#### Scenario: Leave a group
- **WHEN** a leave request is queued for a group the account is in
- **THEN** the Mac relay leaves the room and reports `accepted` once the room is gone from the database

#### Scenario: Already left
- **WHEN** a leave request is queued for a room the Mac relay no longer lists
- **THEN** the request is suppressed and nothing is handed out

### Requirement: Mac relay health
The Mac relay SHALL send the heartbeat every minute, reporting whether its last database read succeeded within two minutes, whether it is trusted for accessibility, whether the screen is locked, the KakaoTalk version and its sendable rooms. The service SHALL treat a failed read or a missing accessibility grant as a disabled service, as for the Android relay.

#### Scenario: Database unreadable
- **WHEN** the relay cannot read the database for two minutes
- **THEN** its heartbeat reports the reader disabled, and the service treats the relay as down

### Requirement: Mac relay process
The Mac relay SHALL run as a LaunchAgent in the logged-in user's GUI session, started by a helper that holds the Accessibility grant, and SHALL restart after a crash. It SHALL keep its secrets and the database key in files only its user can read, and SHALL write no message text to disk.

#### Scenario: Daemon crashes
- **WHEN** the daemon exits unexpectedly
- **THEN** the helper starts it again, and it resumes from the last acknowledged log ID
