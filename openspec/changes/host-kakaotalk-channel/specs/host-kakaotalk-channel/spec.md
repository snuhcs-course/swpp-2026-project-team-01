## ADDED Requirements

### Requirement: KakaoTalk relay authentication
Every request from the relay to the webhook, outbox, result and heartbeat routes SHALL carry a timestamp, a single-use nonce and an HMAC-SHA256 signature over the method, path, timestamp, nonce and body. The service SHALL accept the request only when the signature verifies in constant time under the secret for that route class, the timestamp is within five minutes, and the nonce has not been seen in that window. Inbound events SHALL use one secret and outbox, result and heartbeat requests SHALL use another, and each class SHALL accept a current and a previous secret so either can be rotated without downtime. When a secret for a route class is not configured, every request of that class SHALL be refused. Any refused request SHALL be answered `401` and SHALL read and change no delivery state.

#### Scenario: Signature for another route
- **WHEN** a request signed for `POST /kakaotalk/webhook` is replayed to `POST /kakaotalk/outbox/claim`
- **THEN** it is answered `401` and no lease is created

#### Scenario: Replayed nonce
- **WHEN** a correctly signed request is sent a second time with the same nonce within five minutes
- **THEN** the second request is answered `401` and changes nothing

#### Scenario: Secret rotation
- **WHEN** the outbox secret is rotated and the relay still signs with the previous secret
- **THEN** its requests are accepted until the previous secret is removed, and refused afterwards

#### Scenario: Secret missing
- **WHEN** the outbox secret is not configured
- **THEN** every outbox, result and heartbeat request is answered `401` and no queued message changes state

### Requirement: KakaoTalk relay webhook
The service SHALL accept one relay event per KakaoTalk message at `POST /kakaotalk/webhook`. The event ID SHALL identify the room, the message's post time and its position among messages posted at that time, so each message has one ID however many times its notification is updated. An accepted 1:1 event SHALL be stored as a receipt with channel `kakaotalk`, keyed by its event ID, with one processing job, before the service answers `200`. A repeated event ID with the same payload SHALL be answered `200` with no new receipt or job. A repeated event ID with a different payload SHALL be refused and SHALL leave the stored receipt unchanged. A failure to store SHALL be answered with an error so the relay retries. The relay SHALL forward each message that appears in a KakaoTalk notification, and was posted after the relay was first configured, until the service acknowledges it, and SHALL NOT forward it again after that.

#### Scenario: Event stored before acknowledgment
- **WHEN** the relay posts a correctly signed 1:1 message event
- **THEN** one receipt with channel `kakaotalk` and one job exist before the `200` answer

#### Scenario: Two messages in one notification
- **WHEN** a notification is updated to show two new messages from the same chat
- **THEN** the relay posts two events with different IDs, and two receipts are stored in their order

#### Scenario: Notification already posted at first start
- **WHEN** the relay is configured while a notification from before that moment is still posted
- **THEN** the relay forwards none of that notification's earlier messages

#### Scenario: Redelivered event
- **WHEN** the relay posts the same event ID twice with the same payload
- **THEN** the second post is answered `200` and creates no second receipt or job

#### Scenario: Changed payload under a stored ID
- **WHEN** the relay posts a stored event ID with different text
- **THEN** the post is refused and the stored receipt is unchanged

### Requirement: Group and open chats
The relay SHALL forward no message text from a group conversation or an open chat (오픈채팅). When a group or open-chat message contains a pending link code, the relay SHALL forward a signed event that carries only a keyed hash of that code, and the service SHALL void the matching pending attempt, as a code from a group conversation does on the iMessage channel. Such an event SHALL create no receipt for the model, no link and no reply.

#### Scenario: Group message
- **WHEN** a message arrives in a group chat that includes the product's account
- **THEN** no text reaches the service, and no receipt, link or reply is created

#### Scenario: Code sent in a group
- **WHEN** a pending link code is sent in a group chat
- **THEN** the matching attempt is void, nothing is bound, and the host must create a new code

#### Scenario: Code sent from an open chat
- **WHEN** a pending link code is sent from an open-chat profile in a 1:1 open chat
- **THEN** the matching attempt is void and nothing is bound

### Requirement: KakaoTalk sender identity
The KakaoTalk sender SHALL be the room ID of the 1:1 chat that the event came from. It SHALL be stored only as a keyed hash in a namespace separate from the iMessage, WhatsApp and Telegram senders, and sealed for replies together with the sender's display name. The service SHALL NOT request or store a KakaoTalk user's phone number or account ID. The display name SHALL come from the notification's sender, never from message text.

#### Scenario: Same person on two channels
- **WHEN** one person writes from Telegram and from KakaoTalk
- **THEN** the two senders have different hashes and neither one's binding applies to the other

#### Scenario: Display name changes
- **WHEN** a bound host changes their KakaoTalk profile name and writes again
- **THEN** the binding still applies and the sealed display name is updated

### Requirement: Linking KakaoTalk by a code
An authenticated active host SHALL be able to create a KakaoTalk link attempt whose one-time code, expiry and limits are those of the iMessage channel. The card SHALL show the product's KakaoTalk ID and the code, each with a copy action. Before the code is shown, the card SHALL state in one sentence that KakaoTalk chats pass through Kakao and a relay phone. When the host has another active messaging binding, the card SHALL also say that linking KakaoTalk ends it. Only a 1:1 message whose text is the pending unexpired code SHALL bind its chat to the host, as soon as it arrives and with no confirmation in the browser. In the same transaction the host's other binding SHALL end and its undispatched messages SHALL be suppressed. The page SHALL then show **Linked** with the KakaoTalk name. A code arriving on another channel SHALL void the attempt. A linking message SHALL never reach the model or a transcript.

#### Scenario: Link by sending the code
- **WHEN** the host adds the product's account as a friend and sends the code in a 1:1 chat
- **THEN** that chat is bound to the host, the first reply is the welcome message, and the page shows **Linked**

#### Scenario: Linking replaces another channel
- **WHEN** a host bound on Telegram sends a KakaoTalk code
- **THEN** in the same transaction the Telegram binding ends and its undispatched messages are suppressed, and later notices go to KakaoTalk

### Requirement: KakaoTalk offered beside the device default
The channel card SHALL keep each device's default channel and SHALL offer **Use KakaoTalk instead** beside it on every device when KakaoTalk is configured. KakaoTalk SHALL NOT be offered when it is not configured.

#### Scenario: Android host
- **WHEN** a host on Android opens the channel card while Telegram and KakaoTalk are configured
- **THEN** the card offers Telegram with **Use KakaoTalk instead**

### Requirement: Private content only to the verified chat
A KakaoTalk message with any private content (a summary, a proposal, a booking, a calendar detail or a reply to the host) SHALL be sent only through the reply action of a notification that was posted for the bound chat's room ID, either while it is posted or, after KakaoTalk removed it, from the reply action the relay kept for that room. When the relay holds no reply action for that room, the relay MAY send only the fixed nudge text, which carries no request, person, time or place, by opening the chat by the sealed display name. The private message SHALL stay queued until the host writes and a notification for that room is posted again.

#### Scenario: Notice with a waiting notification
- **WHEN** a summary is queued for a host whose chat has a posted notification
- **THEN** the relay sends the summary through that notification's reply action

#### Scenario: Several notices after one host message
- **WHEN** three messages are queued for a host who wrote once, and the relay still holds that room's reply action
- **THEN** the three are sent as three separate replies in queue order

#### Scenario: Notice with no waiting notification
- **WHEN** a summary is queued for a host whose room has no posted notification and no kept reply action
- **THEN** the relay sends only the fixed nudge, and the summary is sent through the reply action after the host writes back

#### Scenario: Renamed host, name now held by another friend
- **WHEN** the host has renamed their profile and another friend now has the host's old name
- **THEN** at most the fixed nudge reaches that friend, and no private content is sent to them

### Requirement: KakaoTalk relay outbox
The service SHALL hand outgoing KakaoTalk messages to the relay only through an authenticated claim, at most one message per chat at a time and in queue order. At claim time the service SHALL check each message against the current binding and the latest proposal version, and SHALL suppress the messages that "One binding per host and sender" and "Summaries and outcomes" of the iMessage channel say must not be sent. Each claim SHALL return an opaque lease token and hold the message for 120 seconds. A report SHALL be accepted only with the current lease token, once, while the lease is held. The report SHALL record `accepted` when the message was sent, `failed` when nothing was sent and the cause is final, `uncertain` when sending started and its result was not seen, or `not_started` when nothing was sent and the cause can pass. A `not_started` message SHALL return to the queue and MAY be claimed again at most three times. A lease that ends with no accepted report SHALL set the message to `uncertain`, and any later report SHALL change nothing. A message that is `uncertain` SHALL never be sent again. The relay SHALL report `failed`, and send nothing, when it cannot find exactly one chat for a nudge.

#### Scenario: Message sent
- **WHEN** the relay claims a message, sends it and reports `accepted` with its lease token
- **THEN** the message is recorded as accepted and the next message for that chat becomes claimable

#### Scenario: Lease ends with no report
- **WHEN** the relay claims a message and sends no report within 120 seconds
- **THEN** the message is `uncertain`, no later claim returns it, and a late report changes nothing

#### Scenario: Report with a wrong token
- **WHEN** a result report carries a lease token that is not the current one for that message
- **THEN** it is refused and the message's state is unchanged

#### Scenario: Superseded proposal
- **WHEN** a summary for proposal version 2 is still queued after version 3 is created
- **THEN** the version 2 summary is suppressed at claim time and is never handed to the relay

#### Scenario: Ambiguous nudge recipient
- **WHEN** the relay finds two chats that match the recipient's display name
- **THEN** it sends nothing and reports `failed`

### Requirement: KakaoTalk relay health
The relay SHALL send a heartbeat every minute that reports whether the notification listener and the accessibility service are enabled, whether the phone is locked, the KakaoTalk version, and the room IDs that have a posted notification. The service SHALL treat the relay as down when there has been no heartbeat for five minutes or the last heartbeat reports a disabled service. While the relay is down, the service SHALL hand out no claims and SHALL keep messages queued. While the last heartbeat reports the phone locked, the service SHALL hand out no nudge, and SHALL still hand out reply-mode claims for chats with a posted notification or a kept reply action, because a reply action needs no screen. The service SHALL record an operational alert naming the cause when the relay goes down, and again if it stays down for an hour.

#### Scenario: Relay goes silent
- **WHEN** no heartbeat arrives for five minutes
- **THEN** no further claims are handed out, queued messages stay queued, and an operational alert is recorded

#### Scenario: Phone locked
- **WHEN** the last heartbeat reports the phone locked
- **THEN** no nudge is claimed, and messages for chats with a posted notification or a kept reply action are still claimed

#### Scenario: Relay returns
- **WHEN** a heartbeat with both services enabled arrives after the relay was down
- **THEN** claims resume in queue order, after the claim-time checks

### Requirement: KakaoTalk messaging only in production
The webhook, claim, result and heartbeat routes SHALL refuse every request outside a release origin before they read or change any delivery state, as "Preserve delivery state on environment denial" requires, and SHALL leave queued messages and leases unchanged. Local and test runs SHALL reach only the loopback relay stand-in.

#### Scenario: Preview deployment
- **WHEN** a correctly signed claim reaches a preview deployment
- **THEN** it is refused, no lease is created and no queued message changes state

### Requirement: KakaoTalk privacy notice
The privacy policy SHALL name Kakao and the product's relay phone as processors for hosts who link KakaoTalk, and SHALL state that the relay phone's KakaoTalk app keeps the chat history of every linked host for as long as the account exists. The relay app SHALL keep no message text after the service acknowledges it. `stop` SHALL end the binding and suppress its undispatched messages.

#### Scenario: Host sends stop
- **WHEN** a bound host sends `stop`
- **THEN** the binding ends, undispatched messages are suppressed, and the host gets one confirmation

### Requirement: KakaoTalk reuses the host channel behavior
A bound KakaoTalk chat SHALL behave as a bound Telegram chat, apart from buttons, Telegram extras and images. This covers exact commands and references, approval in the host's own words, the host summaries, admission and ordering of receipts, and retention. Transcript entries from KakaoTalk SHALL carry a `[KakaoTalk]` prefix. A non-text message from the host SHALL get a reply saying that only text is read. Because the relay cannot send images, a setup or schedule review that needs an image SHALL send a link to the same review on `/app`, and the host SHALL confirm it there.

#### Scenario: Photo from the host
- **WHEN** a bound host sends a photo
- **THEN** the reply says only text is read and nothing reaches the model

#### Scenario: Setup review on KakaoTalk
- **WHEN** a KakaoTalk host reaches the setup review
- **THEN** the chat sends a link to the review on `/app`, and the settings are confirmed only there
