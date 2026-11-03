## ADDED Requirements

### Requirement: Platform routing on the shared webhook
The Photon receiver SHALL verify a delivery once, as the iMessage channel requires, and then route the event by its platform. An event SHALL reach the WhatsApp channel only when at least one platform field is present and every platform field it carries names WhatsApp Business. It SHALL reach the iMessage channel only under the iMessage rule. An event that names no platform, names several platforms or names any other platform SHALL be acknowledged with no receipt and no job. A stored WhatsApp receipt SHALL record its channel and follow the iMessage channel's durability, duplicate and conflict rules.

#### Scenario: WhatsApp event stored for WhatsApp
- **WHEN** a verified direct message names WhatsApp Business on every platform field
- **THEN** one receipt with channel `whatsapp` and one processing job are stored before the acknowledgment

#### Scenario: Platforms never cross
- **WHEN** a verified event names iMessage on one field and WhatsApp Business on another
- **THEN** it is acknowledged, nothing is stored, and neither channel processes it

#### Scenario: Unlabelled event
- **WHEN** a verified event carries no platform field
- **THEN** it is acknowledged and nothing is stored

### Requirement: WhatsApp sender identity
The WhatsApp sender SHALL be the provider's sender identifier, normalized to the international number as digits without `+`. It SHALL count only when the conversation identifier names the same number and the conversation is not a group. It SHALL be stored only as a keyed hash in a namespace separate from iMessage senders, and sealed for replies and the masked display. A number SHALL never be parsed from message text.

#### Scenario: Group or mismatched conversation
- **WHEN** a WhatsApp event's conversation is a group or names a different number from its sender
- **THEN** it creates no link, no session and no reply

#### Scenario: Same number on both platforms
- **WHEN** one phone number is the sender on both iMessage and WhatsApp
- **THEN** the two senders have different hashes and neither one's binding applies to the other

### Requirement: Linking WhatsApp by a host-sent code
An authenticated active host SHALL be able to create a WhatsApp link attempt whose one-time code, message, expiry and limits are those of the iMessage channel. **Connect WhatsApp** SHALL create the code and then open `https://wa.me/<number>?text=<message>` with the message percent-encoded. Where it does not navigate, it SHALL show the number, the code, a copy action and a QR code of that link. Opening WhatsApp SHALL NOT change linking state. Only a WhatsApp message carrying the pending, unexpired code SHALL record its sender for confirmation, and the sender SHALL be bound only after the host confirms the masked number in the authenticated browser. A code that arrives from the other channel SHALL void the attempt. The service SHALL NOT send the first message and SHALL NOT offer a service-sent fallback code on WhatsApp. A linking message SHALL never reach the model or the transcript.

#### Scenario: Link from an Android phone
- **WHEN** the host taps **Connect WhatsApp** on Android, sends the prefilled message and confirms the masked number
- **THEN** that number is bound to the host and Thyme's first WhatsApp message is a reply in the conversation the host started

#### Scenario: Code sent from the wrong app
- **WHEN** the code of a WhatsApp attempt arrives in iMessage
- **THEN** nothing is bound and the attempt is voided

#### Scenario: Code arrives but is not confirmed
- **WHEN** the code's WhatsApp message arrives and the host never confirms in the browser
- **THEN** no binding exists and the sender has no host authority

### Requirement: Channel offered by device
The linking card, the link step after sign-in and the landing's start before sign-in SHALL offer WhatsApp alone on Android, offer iMessage with a choice to use WhatsApp instead on iPhone, iPad and Mac, and on other devices first ask which app the host uses on their phone.

#### Scenario: Android host
- **WHEN** an Android host opens the link step
- **THEN** it offers **Connect WhatsApp** and no iMessage action

#### Scenario: Windows computer
- **WHEN** a host opens the linking card in a browser on Windows
- **THEN** it asks whether the host uses iMessage or WhatsApp before showing either channel's code

### Requirement: One messaging channel per host
A host SHALL have at most one active messaging binding across iMessage and WhatsApp. Before confirmation, the browser SHALL say that confirming a sender on one channel replaces the host's link on the other. Confirmation SHALL end the earlier binding in the same transaction. Messages queued for the ended binding that have not been dispatched SHALL be suppressed. No summary SHALL go to both channels.

#### Scenario: iMessage host links WhatsApp
- **WHEN** a host linked on iMessage confirms a WhatsApp sender
- **THEN** the iMessage binding ends, later summaries go only to WhatsApp, and the iMessage sender gets the unlinked-sender reply if it writes again

### Requirement: The WhatsApp messaging window
The service SHALL send free-form WhatsApp text only while the host's last inbound WhatsApp message is no more than 23 hours 50 minutes old at dispatch. A free-form message outside that window, or refused by the provider because the window closed, SHALL NOT be sent or retried as free text. It SHALL be recorded as not sent because the window closed, and the host SHALL see it in `/app`.

#### Scenario: Reply after a long deferral
- **WHEN** a turn reply is dispatched more than 23 hours 50 minutes after the host's last message
- **THEN** it is not sent and `/app` shows that it was not sent on WhatsApp

#### Scenario: Provider refuses for the window
- **WHEN** the provider refuses a free-form send because the window closed
- **THEN** the message is final and is not sent again

### Requirement: Template notices outside the window
When a new request arrives, a proposal awaits approval, or a booking is confirmed or could not be made while the window is closed, the service SHALL send a pre-approved utility template instead of the summary. The only parameter SHALL be the request reference, and the template SHALL carry no requester name, time, place or proposal detail. It SHALL send at most one template per host per 12 hours and at most the configured number per line per rolling day. A template the provider refuses as unavailable SHALL be final and shown in `/app`. Replying with the request command SHALL open the window and select the request.

#### Scenario: Proposal waits after a quiet day
- **WHEN** a proposal awaits approval two days after the host last wrote on WhatsApp
- **THEN** the host receives one template with the request reference and no meeting details, and replying `request <reference>` shows the proposal in WhatsApp

#### Scenario: Several events in one quiet period
- **WHEN** two requests arrive within 12 hours while the window is closed
- **THEN** one template is sent, and both requests are listed by `requests` and in `/app`

#### Scenario: Template not approved
- **WHEN** the provider refuses a template as missing or paused
- **THEN** no further attempt is made and `/app` shows that the notice was not sent

### Requirement: Stopping WhatsApp messages
The exact command `stop` from a linked sender SHALL end the binding as **Unlink** does, and send one confirmation reply. After it, the service SHALL send that number no summary and no template.

#### Scenario: Host sends stop
- **WHEN** a linked WhatsApp host sends `stop`
- **THEN** the binding ends, one confirmation is sent, and later events send nothing to that number

### Requirement: Truthful WhatsApp delivery
Every outbound WhatsApp message, template or not, SHALL be one frozen outbox row dispatched under the messaging gate. Delivery outcomes SHALL be accepted, rejected, unavailable or uncertain as on iMessage. Only an unavailable outcome, including a provider rate limit, SHALL be retried. A send whose answer was lost SHALL be recorded uncertain and never sent again. A delivery or read receipt SHALL never count as a decision.

#### Scenario: Simulated delivery failure
- **WHEN** the transport answers that a summary was undeliverable
- **THEN** the row ends failed, `/app` shows the failure, and the request's state is unchanged

#### Scenario: Lost answer
- **WHEN** a template send times out after the request left
- **THEN** the row is uncertain and no second template is sent for it

### Requirement: Host channel behavior shared with iMessage
For a linked WhatsApp host, the service SHALL apply the iMessage channel's rules on these points. Unlinked senders get a fixed reply limited per channel. Content other than text gets a fixed reply, and reactions get nothing. Exact commands and references run before any model turn, with approval bound to the current proposal and replays keyed by the receipt. Free text is forwarded into the shared setup or selected request discussion, marked as coming from WhatsApp. Setup over chat updates the same draft as `/app`. Receipts are ordered under admission limits. Records are kept for the same retention periods. WhatsApp SHALL NOT be offered **Add to contacts**. Only the identified production deployment SHALL reach Photon for WhatsApp.

#### Scenario: Approve the current proposal from WhatsApp
- **WHEN** a linked WhatsApp host sends the exact approve command for the current review reference
- **THEN** the proposal is approved once, as from `/app`, and a replay of the same message after a restart changes nothing

#### Scenario: Ambiguous yes
- **WHEN** a linked WhatsApp host replies "yes" to a summary
- **THEN** nothing is approved and the reply asks for the exact command or points to `/app`

#### Scenario: Preview deployment
- **WHEN** a preview deployment with copied Photon credentials would send a WhatsApp message
- **THEN** the messaging gate refuses it and Photon is not called
