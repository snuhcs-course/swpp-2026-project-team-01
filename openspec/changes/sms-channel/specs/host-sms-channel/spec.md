## Purpose

Let a host keep their scheduling conversation in plain text messages (SMS) on any phone, through an Android gateway phone: receive signed inbound texts durably, link a number by a texted code after explicit SMS consent, honor opt-out keywords, report delivery truthfully, stay honest when the gateway is offline, and behave like the other host channels within SMS's limits.

## ADDED Requirements

### Requirement: SMS webhook
The agent service SHALL accept the SMS gateway's events at `POST /sms/webhook`. It SHALL accept a request only when its `X-Signature` equals the HMAC-SHA256, under the configured signing key, of the raw body followed by `X-Timestamp`, and the timestamp is within 300 seconds, and SHALL answer `401` otherwise. For an inbound text it SHALL store a receipt keyed by the event ID before answering `200`, SHALL treat a repeated event ID with the same body as already stored, and SHALL answer `409` to a repeated ID with a different body. An event whose recipient is set and, once normalized, is not the configured SMS number (a missing recipient counts as the configured SIM), a message with no text, and any event it does not use SHALL be acknowledged with `200` and do nothing; media SHALL be ignored and only the text used. When the SMS channel is not configured the route SHALL answer `404`.

#### Scenario: Signed inbound text
- **WHEN** the gateway posts a correctly signed `sms:received` event
- **THEN** one receipt is stored before the `200` answer and its processing is queued

#### Scenario: Bad signature
- **WHEN** a request's `X-Signature` does not verify or its `X-Timestamp` is older than 300 seconds
- **THEN** the answer is `401` and nothing is stored

#### Scenario: Redelivered event
- **WHEN** the gateway posts the same event twice with the same ID and body
- **THEN** one receipt exists and the second delivery is answered `200` without a new job

#### Scenario: Same ID, different body
- **WHEN** a second request reuses a stored event ID with a different body
- **THEN** the answer is `409` and the stored receipt is unchanged

#### Scenario: SMS not configured
- **WHEN** the SMS signing key is not set and a request arrives
- **THEN** the answer is `404` and nothing is stored

### Requirement: SMS gateway health
The service SHALL record the time of the gateway's latest heartbeat (`system:ping` or `app:started`). While that time is older than the configured staleness threshold (30 minutes by default), SMS SHALL NOT be offered for new links, SMS sends SHALL be treated as unavailable and wait in the outbox, and operational diagnostics SHALL report the gateway as stale. Existing SMS bindings SHALL stay, and the waiting messages SHALL be sent, under the limits, once heartbeats resume.

#### Scenario: Phone goes offline
- **WHEN** no heartbeat has arrived for 31 minutes and a summary is queued for an SMS host
- **THEN** the summary waits as unavailable, **Connect SMS** is not offered to anyone, and diagnostics report the gateway as stale

#### Scenario: Phone comes back
- **WHEN** a heartbeat arrives after the phone was stale
- **THEN** SMS is offered again and the waiting summary is sent

### Requirement: SMS sender identity
The sender of an inbound SMS SHALL be identified by its number normalized to E.164, a national number being read in the SIM's country, and compared exactly. A sender that cannot be normalized SHALL be dropped. The number SHALL be stored only hashed in the `sms` namespace and sealed for replies, and the browser SHALL show it only masked.

#### Scenario: National format
- **WHEN** a text arrives from sender `010-1234-5678`
- **THEN** it is treated as `+821012345678`

#### Scenario: Same digits on another channel
- **WHEN** the same phone number is linked on iMessage and later texts the SMS number
- **THEN** the SMS sender hash differs from the iMessage one and the SMS text is treated as an unlinked sender

### Requirement: Linking SMS by a host-sent code after consent
Where SMS is configured and the gateway is healthy, **Connect SMS** SHALL show the SMS consent checkbox unticked, with the consent text, the privacy and terms links, a sentence that SMS is not end-to-end encrypted and that the carrier's message rates may apply, and **Get my code**, which SHALL be disabled until the box is ticked. **Get my code** SHALL create the attempt and show the code with **Open Messages**, or on a computer the SMS number, the code, **Copy** and a QR code. The service SHALL refuse an SMS attempt that does not carry the current consent text version, and SHALL record that version and the time it received the request. The code SHALL be the same one-time `FMAT-` code with the same validity, limits and replacement as an iMessage code. **Open Messages** SHALL open Messages addressed to the SMS number with the code in the body. No number SHALL be asked for. Only the code arriving by SMS SHALL complete the attempt, and it SHALL bind the sender as soon as it arrives. A code for an SMS attempt arriving on another channel SHALL void the attempt. The service SHALL never send the first message.

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
- **WHEN** the SMS number, gateway credentials or signing key is missing
- **THEN** no SMS action is offered and an SMS code request is refused

### Requirement: SMS start before sign-in
The landing's SMS start (`/?flow=sms`) SHALL show the same consent checkbox and **Get my code** before any code, and SHALL otherwise work as the iMessage start before sign-in. The attempt SHALL be owned by the starting browser and record an arriving sender. It SHALL bind nothing before sign-in. It SHALL be given to the host who signs in with Google in that browser, or from the sign-in link in the reply to the code, and SHALL bind on arrival once a host owns it. The consent version and time SHALL be kept with the attempt and carried to the binding.

#### Scenario: Start by SMS, then sign in
- **WHEN** a visitor ticks the box on `/?flow=sms`, texts the code and signs in with Google in the same browser
- **THEN** the sender is bound to that host with the recorded consent

#### Scenario: No consent on the landing
- **WHEN** a visitor opens `/?flow=sms` and does not tick the box
- **THEN** no code is issued and nothing is recorded

### Requirement: SMS consent record
When an SMS sender is bound, the service SHALL keep a consent record holding the sender hash, whether it is a host or guest binding, the consent text version and the consent time, but not the number. When the binding ends, the record SHALL note when and why. The record SHALL be kept for four years after that, and then deleted, independently of the 30-day deletion of message records.

#### Scenario: Proof of opt-in after messages are deleted
- **WHEN** an SMS binding has been active for 60 days
- **THEN** its link attempt and early messages are deleted, but its consent record still shows the version and time of consent

### Requirement: SMS keywords and opt-out
The opt-out keywords SHALL be `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `중지`, `수신거부` and `해지`, plus the commands `stop` and `unlink`, matched as the whole trimmed message in any case. An opt-out keyword received by SMS SHALL end every active SMS binding of that sender, host and guest alike, suppress their undispatched messages, and send one fixed confirmation that names Find Me a Time and says how to link again. `HELP`, `help` or `도움말` SHALL get one fixed text naming Find Me a Time, the support address and how to stop. `START` SHALL get one fixed text saying to link again from findmeatime.com, and SHALL bind nothing. The same replies SHALL go to a sender with no binding. None of these SHALL reach the assistant, and a repeated keyword from the same sender within a day SHALL NOT get a second reply. These replies SHALL NOT count toward or be stopped by the per-recipient cap, and SHALL count toward the per-phone cap.

#### Scenario: Host texts STOP
- **WHEN** a linked host texts `STOP`
- **THEN** the SMS binding ends, queued SMS are suppressed, and exactly one confirmation is sent

#### Scenario: Korean opt-out
- **WHEN** a linked host texts `수신거부`
- **THEN** it is handled exactly as `STOP`

#### Scenario: Number that is host and guest
- **WHEN** a number bound as a host and as a guest on one request texts `stop`
- **THEN** both bindings end and one confirmation is sent

#### Scenario: HELP
- **WHEN** a linked host texts `HELP`
- **THEN** one fixed help text with the support address is sent and no assistant turn runs

### Requirement: Truthful SMS delivery
Each SMS send SHALL end in exactly one of accepted, rejected with a category, unavailable or uncertain, decided by the gateway's answer to the send. Accepted SHALL mean only that the gateway took the message:
- an authentication failure SHALL be `provider_authentication`;
- an invalid number SHALL be `invalid_recipient`;
- another refusal SHALL be `provider_rejected`;
- a rate limit, a stale gateway or the per-phone cap SHALL be unavailable, and the message SHALL wait and be sent later without spending its send attempts, so an outage of any length loses nothing;
- a failure after the request was written SHALL be uncertain and SHALL NOT be resent.

Each send SHALL carry its outbox row's ID as the gateway's message ID. A later delivery report SHALL record delivery, and a later failure report SHALL record the failure and its reason; neither SHALL resend. A number in any country SHALL be accepted for linking, and a refusal to deliver abroad SHALL be reported with its category rather than hidden.

#### Scenario: Lost answer
- **WHEN** the connection drops after the send request was written
- **THEN** the message is `uncertain` and is not sent again

#### Scenario: Failure reported later
- **WHEN** an accepted message gets an `sms:failed` event
- **THEN** the row records the failure and its reason, and nothing is resent

### Requirement: SMS limits
SMS SHALL be plain text with no markup, buttons, pictures, read marks, typing indicator, tapbacks or contact card. The assistant's SMS instructions SHALL ask for replies under 480 characters unless the host asks for more.

Outbound SMS to one recipient SHALL be capped at the configured limit (40 by default) in any 24-hour window, the limit notice included:
- the message that would be the last one allowed SHALL be replaced by a notice that the text limit is reached and the conversation continues at findmeatime.com;
- messages over the cap SHALL be `suppressed`, and sending SHALL resume once the 24-hour count falls below the cap;
- a second notice SHALL NOT be sent within 24 hours of the first.

Outbound SMS from the gateway phone SHALL be capped per hour (100 by default), and messages over that cap SHALL wait, not be dropped.

#### Scenario: Recipient cap reached
- **WHEN** a recipient has received 39 SMS in the last 24 hours and another message is queued
- **THEN** that message is replaced by the limit notice and the next one in that window is `suppressed`

#### Scenario: Phone cap reached
- **WHEN** the phone has sent 100 SMS in the last hour and another is queued
- **THEN** it waits and is sent once the hourly count allows

#### Scenario: No decision buttons
- **WHEN** a proposal summary is sent on SMS
- **THEN** it is plain text naming the exact reference to approve or decline, with no buttons

### Requirement: Decisions by SMS name the reference
Because a phone number can be spoofed, a state-changing host action by SMS SHALL take effect only when the message contains the exact current reference of what it acts on, alone or within the host's words. That covers approving or declining a proposal, sharing or dismissing suggested changes, and confirming or changing settings. An action in words without the reference SHALL change nothing, and the assistant SHALL reply with the exact text to send. The other channels SHALL keep actions in the host's own words.

#### Scenario: Approval without the reference
- **WHEN** a linked host texts "yes, book it"
- **THEN** nothing is approved and the reply gives the exact `approve` text with the current reference

#### Scenario: Approval with the reference
- **WHEN** a linked host texts "approve K7Q2MX-3"
- **THEN** the proposal is approved as on iMessage and the confirmation is queued on SMS

### Requirement: SMS conversation behavior
A text from a host with an active SMS binding SHALL be handled as an iMessage from a linked host, except for actions (above) and the limits of SMS. On SMS, replies and summaries SHALL give the exact text that carries the reference, instead of saying the host may act in their own words. This covers exact commands and references, switching the conversation in words, forwarding into shared discussions, summaries and outcomes, setup over chat, admission limits, ordered receipts and the outbox. Its text SHALL enter the conversation with the `[SMS] ` prefix. A request for a schedule image SHALL be answered in words only. A text from an unlinked sender SHALL get the unlinked-sender reply at most as often as on the other channels, counted for SMS separately. SMS message records SHALL be deleted after 30 days, and messaging SHALL be admitted only where the other channels are.

#### Scenario: Schedule image asked by SMS
- **WHEN** a linked host texts "show this week as an image"
- **THEN** no picture is sent and the reply describes the week in words

#### Scenario: Preview deployment
- **WHEN** a preview deployment has copied SMS credentials and tries to send
- **THEN** the send is denied by the messaging environment gate and nothing reaches the gateway
