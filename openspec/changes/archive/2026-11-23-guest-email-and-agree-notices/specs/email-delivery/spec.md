## MODIFIED Requirements

### Requirement: Booking confirmation message
A booking confirmation email SHALL be generated from the confirmed event details for each recipient, in that recipient's language and timezone. Its From header SHALL carry the host's display name on `no-reply@findmeatime.com`. The requester's copy SHALL set Reply-To to the product's conversational inbox when the deployment has one and SHALL say that a reply reaches the assistant; without an inbox its Reply-To SHALL be the host's verified email. The host's copy SHALL set Reply-To to the requester's email. The subject SHALL follow `{title} between {host} and {guest}` in the recipient's language. The message SHALL be HTML with a plain-text alternative and SHALL contain the confirmed status, the what/when/who/where blocks with the timezone named, the **View booking** link and, for online meetings, the join link, and SHALL contain no host-private notes, rules or credentials beyond the booking link. A `text/calendar` part with `METHOD:REQUEST` SHALL be attached only when its `UID` equals the created calendar event's `iCalUID`.

#### Scenario: Requester receives the confirmation
- **WHEN** an event is confirmed for a Korean-speaking requester in `Asia/Seoul`
- **THEN** the subject, labels and times are rendered in Korean and in `Asia/Seoul` with the zone named, and **View booking** opens that request's booking page

#### Scenario: Reply to the confirmation
- **WHEN** the requester replies to the confirmation email in a deployment with a conversational inbox
- **THEN** the reply is addressed to that inbox, not to the host or the product sender, and the email says a reply reaches the assistant

#### Scenario: Confirmation without an inbox
- **WHEN** the deployment has no conversational inbox
- **THEN** the requester's copy replies to the host's verified email and the host's copy replies to the requester

#### Scenario: Calendar part cannot match the event
- **WHEN** the created calendar event's `iCalUID` is unavailable when the email is prepared
- **THEN** the email is sent without a calendar part and the calendar-native invitation remains the only calendar entry

## ADDED Requirements

### Requirement: Replies to the booking confirmation reach the guest conversation
An authenticated email to the conversational inbox that answers no bound thread SHALL reach a request's requester discussion when its sender is the recipient of that request's accepted requester booking confirmation, that confirmation replied to this inbox, and the sender is still the request's contact. When the reply names a confirmation in In-Reply-To or References, that confirmation's request SHALL be chosen; otherwise the latest such confirmation's. The reply's thread SHALL be bound to the request as a started thread, or, when the request already has an active thread, the message SHALL be forwarded through that binding; either way the assistant's answer SHALL go back by email in the reply's thread. A reply from any other sender, or to a confirmation that replied elsewhere, SHALL do nothing.

#### Scenario: Guest replies to their confirmation
- **WHEN** the guest replies from their address to the booking confirmation
- **THEN** the message, with its subject, is forwarded into that request's requester discussion and the assistant answers in the same email thread

#### Scenario: Someone else replies
- **WHEN** a message naming the confirmation comes from an address that did not receive it
- **THEN** nothing is forwarded and no thread is bound

### Requirement: Address change after a bounce
When the creation email to a request's unconfirmed contact was rejected or suppressed, the requester SHALL be able to replace the contact address from the booking page. The new address SHALL receive the creation email with the booking link and its own confirmation link, earlier confirmation links SHALL be voided, and the change SHALL count toward and obey the creation-email bounds, being rejected with nothing changed past one. No revision, agreement or booking SHALL change. A delivered or confirmed contact SHALL NOT be replaced this way.

#### Scenario: Guest fixes a mistyped address
- **WHEN** the booking link bounced and the guest enters another address under **Change email**
- **THEN** the request's contact becomes the new address, which receives the booking link and a confirmation link

#### Scenario: Delivered address
- **WHEN** the creation email to the contact was delivered or the contact is confirmed
- **THEN** **Change email** is not offered and the command is refused

### Requirement: Booking link resend from the conversation
The requester assistant SHALL be able to email the request's booking link again when the guest asks for it, only to the request's confirmed contact address, while the request is open or booked and its link unexpired, under the per-request, per-recipient and service limits of the public link resend. A retried call SHALL send no second email. An unconfirmed contact SHALL receive nothing, and the assistant SHALL never show the link or send it to an address the guest names.

#### Scenario: Guest asks for the link in chat
- **WHEN** a guest whose address is confirmed asks the assistant for their booking link
- **THEN** one link resend email goes to the confirmed address and the conversation shows neither the link nor the address

#### Scenario: Unconfirmed address
- **WHEN** the guest's address is not confirmed
- **THEN** no email is sent and the assistant says the link goes only to a confirmed address
