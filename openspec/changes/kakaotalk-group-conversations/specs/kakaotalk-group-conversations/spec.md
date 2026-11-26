## ADDED Requirements

### Requirement: Group messages from the Mac relay
The Mac relay SHALL send each text message that another member writes in a group or open chat the account is in, with the room's ID and title and the sender's user ID and name. It SHALL NOT send the account's own messages or non-text messages, and SHALL send a message that carries a link code only as the code's keyed hash. The service SHALL store each such message once, as a receipt of that group, in the order the group received them.

#### Scenario: Member writes in a group
- **WHEN** a member writes a text message in a group the account is in
- **THEN** one receipt is stored for that group, with the member as the sender

#### Scenario: Code in a group
- **WHEN** a member posts a pending link code in a group
- **THEN** no text reaches the service, and the attempt is void

### Requirement: Group conversation owned by no host
Each KakaoTalk group SHALL have its own conversation, owned by no host and no request, whose sessions have no tools. A group's conversation SHALL NOT reach any host's calendar, requests, settings or conversations. Once the account has left the group, the service SHALL record and answer nothing more there.

#### Scenario: Group session
- **WHEN** a group's first call starts its session
- **THEN** the session belongs to the group, gets the group instructions, and has no tools

#### Scenario: Account left the group
- **WHEN** the account has left a group and a member's message from before arrives
- **THEN** nothing is recorded as context and nothing is answered

### Requirement: Calls and context
A group message SHALL call the assistant when it names the account or the assistant: a Latin name as a whole word, a Korean name not preceded by a Hangul syllable and followed by nothing or a particle. An `@` before another member's name SHALL NOT call it. A message that does not call SHALL run no model and SHALL be kept, sealed, as context for at most 24 hours and at most 30 messages per group. A call SHALL become one input that lists the kept context, oldest first, then the calling message, each with its sender's name, and SHALL consume the context it lists only when the input is recorded. A call that is deferred SHALL keep the context for its retry.

#### Scenario: Conversation then a call
- **WHEN** two members discuss a dinner and a third writes "타임래빗, 화요일 저녁 괜찮을까?"
- **THEN** one input lists the two messages and then the call, and no model runs for the first two

#### Scenario: Word that contains a name
- **WHEN** a member writes "TimeRabbits are cute" or "새타임래빗"
- **THEN** it is kept as context and the assistant does not answer

#### Scenario: Call deferred by admission
- **WHEN** a call is deferred by the group's admission limit
- **THEN** no input is recorded and the kept context stays for the retry

### Requirement: Group replies
The reply to a call SHALL be sent to the same group, only by the Mac relay, and only to a titled group whose title no other room's name contains, with the Mac relay's chat-list and landing checks. A group's reply SHALL never be handed to the Android relay.

#### Scenario: Reply in the group
- **WHEN** the assistant's turn for a call ends
- **THEN** the Mac relay sends the reply to that group and reports it `accepted` once it appears there

#### Scenario: Phone active
- **WHEN** the Android relay is the active relay and a group reply is queued
- **THEN** the reply is suppressed and nothing is sent

### Requirement: Group limits
The service SHALL answer at most 30 calls per group and 300 across groups in 24 hours, both configurable, and SHALL keep a call past either limit as context. Group inputs SHALL pass their own admission windows, and their model calls SHALL be charged to the group under the groups' own allowances, apart from the anonymous allowance unconfirmed guests use. When a group's latest session has failed, the next call SHALL start its next session.

#### Scenario: Failed session
- **WHEN** a group's session has failed and a member calls again
- **THEN** the group's next session starts and the call is answered

#### Scenario: Daily limit reached
- **WHEN** a group has had its daily number of answered calls and a member calls again
- **THEN** no model runs, and the call is kept as context

### Requirement: Group privacy notice
The privacy policy SHALL state that in a KakaoTalk group with the product's account, every member's messages reach the service, that messages calling the assistant reach the model with the group's recent messages, and how long they are kept. Uncalled messages SHALL be deleted within 24 hours, and a group's conversation 30 days after its last call.

#### Scenario: Privacy page
- **WHEN** someone reads the privacy policy
- **THEN** it names the group messages the service receives and their retention
