## MODIFIED Requirements

### Requirement: Evidence-based delivery outcomes
The system SHALL record successful submission only with affirmative provider acceptance for every intended recipient and with a dispatch identity: the provider's message identity when the provider returns one, otherwise an application dispatch identity frozen before dispatch and sent with the message. Suppressed or bounced recipients SHALL NOT be marked successfully sent. When Cloudflare refuses a message or answers with a server error, the delivery evidence SHALL keep the code and message of each error Cloudflare names, at most five and with any email address in a message masked, and SHALL NOT keep recipients, content or any other part of the response. Email submission SHALL NOT establish contact verification or change booking state.

#### Scenario: Successful HTTP response without recipient acceptance
- **WHEN** the provider response omits acceptance evidence or lists a recipient as suppressed
- **THEN** the application does not record successful submission

#### Scenario: Accepted without a provider message identity
- **WHEN** Cloudflare lists every intended recipient as delivered or queued and returns no message identity
- **THEN** the submission is recorded as accepted with the application dispatch identity that the message carried

#### Scenario: Permanent bounce
- **WHEN** Cloudflare lists an intended recipient as a permanent bounce
- **THEN** the delivery is recorded as rejected for that recipient and no contact or request state changes

#### Scenario: Refusal keeps the provider's error
- **WHEN** Cloudflare answers a send with HTTP 400 and an error whose code is 10001
- **THEN** the delivery is recorded as rejected and its evidence keeps the HTTP status, that code and its message, and no recipient or message content

### Requirement: Booking confirmation message
A booking confirmation email SHALL be generated from the confirmed event details for each recipient, in that recipient's language and timezone. Its From header SHALL carry the host's display name on `no-reply@findmeatime.com`; a display name outside printable ASCII SHALL be sent as RFC 2047 encoded-words so the provider accepts it. The requester's copy SHALL set Reply-To to the product's conversational inbox when the deployment has one and SHALL say that a reply reaches the assistant; without an inbox its Reply-To SHALL be the host's verified email. The host's copy SHALL set Reply-To to the requester's email. The subject SHALL follow `{title} between {host} and {guest}` in the recipient's language. The message SHALL be HTML with a plain-text alternative and SHALL contain the confirmed status, the what/when/who/where blocks with the timezone named, the **View booking** link and, for online meetings, the join link, and SHALL contain no host-private notes, rules or credentials beyond the booking link. A `text/calendar` part with `METHOD:REQUEST` SHALL be attached only when its `UID` equals the created calendar event's `iCalUID`.

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

#### Scenario: Host named in Korean
- **WHEN** a booking is confirmed for a host whose display name is written in Korean
- **THEN** both copies are sent with that name encoded in the From header, and recipients see the name as written
