## Purpose

Let a host keep their scheduling conversation in plain text messages (SMS) on any phone: receive signed inbound texts durably, link a number by a texted code after explicit SMS consent, honor carrier opt-out keywords, report delivery truthfully, and behave like the other host channels within SMS's limits.

## ADDED Requirements

### Requirement: SMS webhook
The agent service SHALL accept inbound SMS events at `POST /photon/sms/webhook`. It SHALL accept a request only when its Standard Webhooks signature verifies under the configured SMS webhook secret and its timestamp is within 300 seconds, and SHALL answer `401` otherwise. It SHALL store a receipt keyed by the event's webhook ID before answering `200`, SHALL treat a repeated webhook ID with the same body as already stored, and SHALL answer `409` to a repeated ID with a different body. An event that is not an inbound one-to-one message SHALL be acknowledged with `200` and do nothing. Media in an inbound message SHALL be ignored and only its text used; a message with no text SHALL do nothing. When the SMS channel is not configured the route SHALL answer `404`.

#### Scenario: Signed inbound text
- **WHEN** Photon posts a correctly signed inbound SMS event
- **THEN** one receipt is stored before the `200` answer and its processing is queued

#### Scenario: Bad signature
- **WHEN** a request's `webhook-signature` does not verify or its timestamp is older than 300 seconds
- **THEN** the answer is `401` and nothing is stored

#### Scenario: Redelivered event
- **WHEN** Photon posts the same event twice with the same webhook ID and body
- **THEN** one receipt exists and the second delivery is answered `200` without a new job

#### Scenario: Same ID, different body
- **WHEN** a second request reuses a stored webhook ID with a different body
- **THEN** the answer is `409` and the stored receipt is unchanged

#### Scenario: SMS not configured
- **WHEN** the SMS webhook secret is not set and a request arrives
- **THEN** the answer is `404` and nothing is stored

#### Scenario: Spectrum webhook unchanged
- **WHEN** an iMessage event arrives at `/photon/webhook`
- **THEN** it is verified with the Spectrum signature as before and the SMS route is not involved

### Requirement: SMS sender identity
The sender of an inbound SMS SHALL be identified by its E.164 number, compared exactly. The number SHALL be stored only hashed in the `sms` namespace and sealed for replies. The browser SHALL show it only masked. An inbound group message SHALL never bind, route or start a turn.

#### Scenario: Same digits on another channel
- **WHEN** the same phone number is linked on iMessage and later texts the SMS number
- **THEN** the SMS sender hash differs from the iMessage one and the SMS text is treated as an unlinked sender

#### Scenario: Group MMS
- **WHEN** an inbound event has more than one other participant
- **THEN** it is acknowledged and nothing is bound or routed

### Requirement: Linking SMS by a host-sent code after consent
Where SMS is configured, **Connect SMS** SHALL show the SMS consent checkbox unticked, with the consent text, the privacy and terms links, one sentence that SMS is not end-to-end encrypted and that message and data rates may apply, and **Get my code**, which SHALL be disabled until the box is ticked. **Get my code** SHALL create the attempt and show the code with **Open Messages**, or on a computer the SMS number, the code, **Copy** and a QR code. The service SHALL refuse an SMS attempt that does not carry the current consent text version, and SHALL record that version and the time it received the request. The code SHALL be the same one-time `FMAT-` code with the same validity, limits and replacement as an iMessage code. **Open Messages** SHALL open Messages addressed to the SMS number with the code in the body. No number SHALL be asked for and nothing SHALL be registered as a Photon shared user. Only the code arriving by SMS SHALL complete the attempt, and it SHALL bind the sender as soon as it arrives. A code for an SMS attempt that arrives on another channel SHALL void the attempt. The service SHALL never send the first message.

#### Scenario: Consent gates the code
- **WHEN** a host opens **Connect SMS** and has not ticked the checkbox
- **THEN** **Get my code** is disabled, no code is shown and no attempt exists

#### Scenario: Crafted request without consent
- **WHEN** a request creates an SMS attempt without the current consent version
- **THEN** it is refused and no code is issued

#### Scenario: Link by texting the code
- **WHEN** the host ticks the checkbox, presses **Get my code**, taps **Open Messages** and sends the prefilled code
- **THEN** the sender is bound to the host, the card shows the masked number with **Not my number — unlink**, and the welcome is queued on SMS

#### Scenario: Code from another channel
- **WHEN** an SMS attempt's code arrives on Telegram
- **THEN** the attempt is voided and nothing is bound

#### Scenario: SMS not configured
- **WHEN** the SMS number, API key or webhook secret is missing
- **THEN** no SMS action is offered and an SMS code request is refused

### Requirement: SMS start before sign-in
The landing's SMS start (`/?flow=sms`) SHALL show the same consent checkbox and **Get my code** before any code, and SHALL otherwise work as the iMessage start before sign-in: the attempt is owned by the starting browser, records an arriving sender, binds nothing before sign-in, is given to the host who signs in with Google in that browser or from the sign-in link in the reply to the code, and binds on arrival once a host owns it. The consent version and time SHALL be kept with the attempt and carried to the binding.

#### Scenario: Start by SMS, then sign in
- **WHEN** a visitor ticks the box on `/?flow=sms`, texts the code and signs in with Google in the same browser
- **THEN** the sender is bound to that host with the recorded consent

#### Scenario: No consent on the landing
- **WHEN** a visitor opens `/?flow=sms` and does not tick the box
- **THEN** no code is issued and nothing is recorded

### Requirement: SMS consent record
When an SMS sender is bound, the service SHALL keep a consent record holding the sender hash, whether it is a host or guest binding, the consent text version and the consent time, but not the number. When the binding ends or the sender opts out, the record SHALL note when and how. The record SHALL be kept for four years after that, and then deleted, independently of the 30-day deletion of message records.

#### Scenario: Proof of opt-in after messages are deleted
- **WHEN** an SMS binding has been active for 60 days
- **THEN** its link attempt and early messages are deleted, but its consent record still shows the version and time of consent

### Requirement: SMS keywords and opt-out
The opt-out keywords SHALL be `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END` and `QUIT`, matched as the whole trimmed message in any case. The service SHALL NOT reply to an opt-out keyword, `HELP`, `INFO` or `START` received by SMS, because Photon answers them, and none of them SHALL reach the assistant. An opt-out keyword from a number SHALL end every active SMS binding of that sender, host and guest alike, and suppress their undispatched messages. A send that Photon refuses because the recipient opted out SHALL be recorded as rejected with category `blocked` and SHALL end the bindings the same way. On SMS the words `stop` and `unlink` SHALL end the bindings without a reply, and `help` SHALL get no reply.

#### Scenario: Host texts STOP
- **WHEN** a linked host texts `STOP`
- **THEN** the SMS binding ends, queued SMS are suppressed, and the service sends no reply of its own

#### Scenario: Number that is host and guest
- **WHEN** a number bound as a host and as a guest on one request texts `Unsubscribe`
- **THEN** both bindings end and nothing more is sent to that number

#### Scenario: Opted-out recipient
- **WHEN** Photon refuses a send because the recipient opted out
- **THEN** the message is `failed` with category `blocked` and the binding ends

#### Scenario: HELP gets no service reply
- **WHEN** a linked host texts `HELP`
- **THEN** no outbox message is queued and no assistant turn runs

### Requirement: Truthful SMS delivery
Each SMS send SHALL end in exactly one of accepted, rejected with a category, unavailable or uncertain. Accepted SHALL mean only that Photon took the message. An authentication failure SHALL be `provider_authentication`; an invalid or unsupported number SHALL be `invalid_recipient`; another refusal SHALL be `provider_rejected`; a rate limit SHALL be unavailable and retried after the provider's delay; a failure after the request was written SHALL be uncertain and SHALL NOT be resent. Each send SHALL carry an idempotency key unique to its outbox row. A number in any country SHALL be accepted for linking, and a refusal to deliver abroad SHALL be reported with its category rather than hidden.

#### Scenario: Lost answer
- **WHEN** the connection drops after the send request was written
- **THEN** the message is `uncertain` and is not sent again

#### Scenario: Number outside the US
- **WHEN** a host linked with a `+82` number gets a summary and Photon refuses it as unsupported
- **THEN** the message is `failed` with category `invalid_recipient` and the binding stays

### Requirement: SMS limits
SMS SHALL be plain text with no markup, buttons, pictures, read marks, typing indicator, tapbacks or contact card. The assistant's SMS instructions SHALL ask for replies under 480 characters unless the host asks for more. Outbound SMS to one recipient SHALL be capped at the configured limit (40 by default) in any 24-hour window, counting the limit notice. The message that would be the last one allowed SHALL be replaced by a notice that the text limit is reached and the conversation continues at findmeatime.com. Messages that would exceed the cap SHALL be `suppressed`, and sending SHALL resume once the 24-hour count falls below the cap; a second notice SHALL NOT be sent within 24 hours of the first.

#### Scenario: Cap reached
- **WHEN** a recipient has received 39 SMS in the last 24 hours and another message is queued
- **THEN** that message is replaced by the limit notice and the next one in that window is `suppressed`

#### Scenario: Sending resumes
- **WHEN** the oldest of those 40 messages becomes more than 24 hours old and a message is queued
- **THEN** it is sent normally and no second limit notice goes out that day

#### Scenario: No decision buttons
- **WHEN** a proposal summary is sent on SMS
- **THEN** it is plain text naming the exact reference to approve or decline, with no buttons

### Requirement: Decisions by SMS name the reference
Because a phone number can be spoofed, an approval or decline by SMS SHALL take effect only when the message contains the current proposal's reference (as in `approve <ref>-<version>`, alone or within the host's words). A decision in words without the reference SHALL change nothing, and the assistant SHALL reply with the exact text to send. The other channels SHALL keep approval in the host's own words.

#### Scenario: Approval without the reference
- **WHEN** a linked host texts "yes, book it"
- **THEN** nothing is approved and the reply gives the exact `approve` text with the current reference

#### Scenario: Approval with the reference
- **WHEN** a linked host texts "approve K7Q2MX-3"
- **THEN** the proposal is approved as on iMessage and the confirmation is queued on SMS

### Requirement: SMS conversation behavior
A text from a host with an active SMS binding SHALL be handled as an iMessage from a linked host, apart from decisions (above) and the limits of SMS: exact commands and references, switching the conversation in words, forwarding into shared discussions, summaries and outcomes, setup over chat, admission limits, ordered receipts and the outbox. Its text SHALL enter the conversation with the `[SMS] ` prefix. A request for a schedule image SHALL be answered in words only. A text from an unlinked sender SHALL get the unlinked-sender reply at most as often as on the other channels, counted for SMS separately. SMS message records SHALL be deleted after 30 days, and messaging SHALL be admitted only where the other channels are.

#### Scenario: Schedule image asked by SMS
- **WHEN** a linked host texts "show this week as an image"
- **THEN** no picture is sent and the reply describes the week in words

#### Scenario: Preview deployment
- **WHEN** a preview deployment has copied SMS credentials and tries to send
- **THEN** the send is denied by the messaging environment gate and nothing reaches Photon
