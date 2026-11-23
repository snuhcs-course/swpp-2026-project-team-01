# email-delivery Specification

## Purpose

Deliver authentication and transactional messages using the selected sender while preserving conversational email and safe handling of uncertain outcomes.

## Requirements

### Requirement: Separate transactional sending from conversations
New transactional emails SHALL use Cloudflare Email Service. Supabase Auth SHALL retain authentication authority with Google-only login for the MVP; email/password, email OTP and magic-link login SHALL NOT be offered. Cloudflare custom SMTP SHALL remain configured for applicable Auth notifications. AgentMail SHALL remain the conversational email provider. Missing Cloudflare configuration SHALL NOT fall back to another sender.

#### Scenario: Transactional email requested
- **WHEN** an enabled verification, recovery, or booking notification is dispatched
- **THEN** its sender is Cloudflare and its existing audience and authority restrictions remain enforced

#### Scenario: Cloudflare configuration unavailable
- **WHEN** an enabled new delivery lacks required Cloudflare configuration
- **THEN** no message is sent through AgentMail or a default sender as fallback

#### Scenario: MVP host login
- **WHEN** a host signs in to the MVP
- **THEN** authentication uses Google through Supabase Auth, with email login disabled and no emailed login link

#### Scenario: Authentication notification
- **WHEN** an applicable non-login Auth notification is sent in production
- **THEN** it uses Cloudflare SMTP without enabling email login or changing identity or session validation

### Requirement: Evidence-based delivery outcomes
The system SHALL record successful submission only with affirmative provider acceptance for every intended recipient and with a dispatch identity: the provider's message identity when the provider returns one, otherwise an application dispatch identity frozen before dispatch and sent with the message. Suppressed or bounced recipients SHALL NOT be marked successfully sent. Email submission SHALL NOT establish contact verification or change booking state.

#### Scenario: Successful HTTP response without recipient acceptance
- **WHEN** the provider response omits acceptance evidence or lists a recipient as suppressed
- **THEN** the application does not record successful submission

#### Scenario: Accepted without a provider message identity
- **WHEN** Cloudflare lists every intended recipient as delivered or queued and returns no message identity
- **THEN** the submission is recorded as accepted with the application dispatch identity that the message carried

#### Scenario: Permanent bounce
- **WHEN** Cloudflare lists an intended recipient as a permanent bounce
- **THEN** the delivery is recorded as rejected for that recipient and no contact or request state changes

### Requirement: Preserve uncertain dispatch identities
The system SHALL freeze sender identity and content before dispatch. Previously dispatched Cloudflare messages SHALL NOT be automatically sent again after an uncertain outcome or process interruption. Previously dispatched AgentMail messages SHALL retain their original provider identity and bounded idempotent retry behavior.

#### Scenario: Cloudflare response lost
- **WHEN** a Cloudflare send may have succeeded but its response is lost
- **THEN** a later job records uncertainty without issuing another send

#### Scenario: Conversational delivery retry
- **WHEN** an uncertain AgentMail delivery is retried within its supported horizon
- **THEN** its original inbox, payload, and idempotency identity are retained

### Requirement: Selected product sender domain
New production authentication and transactional messages SHALL use `no-reply@findmeatime.com`. Existing dispatched messages SHALL retain their original immutable sender identity. AgentMail conversational inboxes SHALL remain available.

#### Scenario: Production message prepared
- **WHEN** a new production authentication or transactional email is prepared
- **THEN** the configured sender is `no-reply@findmeatime.com`

### Requirement: Requester status notifications
The service SHALL email the requester's current contact address, whether or not the requester confirmed it, when a new proposal version awaits their agreement, when the host declines, when the request expires and when a booking stays unconfirmed 15 minutes after its first dispatch. Each notification SHALL carry the current status and the booking link, SHALL be generated from domain records, SHALL be suppressed at dispatch when its condition no longer holds, and SHALL NOT change request state. Requesters who entered through email SHALL receive the same notices in their existing conversational thread.

#### Scenario: Host requests changes
- **WHEN** the host shares revised details that create a new proposal version
- **THEN** the requester's contact address receives an action-needed email with the changed details and the booking link, and no agreement is recorded

#### Scenario: Notification delivery fails
- **WHEN** a status email is rejected or uncertain
- **THEN** the delivery job retries or records uncertainty without changing the request or booking state

#### Scenario: Booking still pending
- **WHEN** a booking is still unconfirmed 15 minutes after its first dispatch
- **THEN** the requester receives one email saying the booking is in progress, with the booking link and no claim that the meeting is booked

#### Scenario: Notice no longer current
- **WHEN** a new-version email reaches dispatch after the requester agreed or a newer version replaced it
- **THEN** it is suppressed and not sent

### Requirement: Booking confirmation message
A booking confirmation email SHALL be generated from the confirmed event details for each recipient, in English and in that recipient's timezone. Its From header SHALL carry the host's display name on `no-reply@findmeatime.com`. The requester's copy SHALL set Reply-To to the product's conversational inbox when the deployment has one and SHALL say that a reply reaches the assistant; without an inbox its Reply-To SHALL be the host's Google-verified email (guest-email-and-agree-notices D2). The host's copy SHALL set Reply-To to the requester's contact address, confirmed or not. The subject SHALL follow `{title} between {host} and {guest}`. The message SHALL be HTML with a plain-text alternative and SHALL contain the confirmed status, the what/when/who/where blocks with the timezone named, the **View booking** link (the booking link for the requester, the request in `/app` for the host) and, for online meetings, the join link, and SHALL contain no host-private notes, rules or credentials beyond the requester's own booking link. A `text/calendar` attachment with `METHOD:REQUEST` SHALL be included only when its `UID` equals the created calendar event's `iCalUID`.

#### Scenario: Requester receives the confirmation
- **WHEN** an event is confirmed for a Korean-speaking requester in `Asia/Seoul`
- **THEN** the subject and labels are in English, the times are in `Asia/Seoul` with the zone named, and **View booking** opens that request's booking page

#### Scenario: Reply to the confirmation
- **WHEN** the requester replies to the confirmation email in a deployment with a conversational inbox
- **THEN** the reply is addressed to that inbox, not to the host or the product sender, and the email says a reply reaches the assistant

#### Scenario: Confirmation without an inbox
- **WHEN** the deployment has no conversational inbox
- **THEN** the requester's copy replies to the host's verified email and the host's copy replies to the requester

#### Scenario: Calendar part cannot match the event
- **WHEN** the created calendar event's `iCalUID` is unavailable when the email is prepared
- **THEN** the email is sent without a calendar part and the calendar-native invitation remains the only calendar entry

#### Scenario: Host's copy
- **WHEN** a booking is confirmed
- **THEN** the host receives their own copy in their timezone whose **View booking** opens the request in `/app` and which carries no booking link

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

### Requirement: Reminders deferred
The first release SHALL NOT send reminder or follow-up emails for confirmed bookings. Created events SHALL keep the destination calendar's default reminders.

#### Scenario: Meeting approaches
- **WHEN** a confirmed meeting is a day away
- **THEN** the service sends no email about it, and any reminder comes from the participants' own calendars

### Requirement: Thread notices for email requesters
A request with an active email thread SHALL receive each requester status notice in that thread as a reply from the product inbox, in addition to the email to its contact address. A thread notice SHALL be generated from the same domain records and template, SHALL carry the booking link only in its sealed form until dispatch, and SHALL be suppressed at dispatch when its condition no longer holds or the thread is no longer bound.

#### Scenario: Decline reaches the thread
- **WHEN** the host declines a request whose thread is bound
- **THEN** the thread receives the decline notice and the contact address receives the decline email

#### Scenario: Thread unlinked before dispatch
- **WHEN** the requester unlinks the thread while a notice for it is queued
- **THEN** the thread notice is suppressed and the email to the contact address is unaffected

### Requirement: Conversational reply identity
Every AgentMail reply SHALL be frozen before dispatch and sent with an idempotency key equal to its reply identity. A reply whose dispatch outcome is unknown SHALL be retried only with the same key and payload, and only while its first dispatch is less than 23 hours old; after that it SHALL be recorded uncertain and never sent again.

#### Scenario: Reply response lost
- **WHEN** a thread reply was dispatched and its response was lost
- **THEN** the next attempt sends the same payload with the same key and records the provider's original message

#### Scenario: Retry horizon passed
- **WHEN** a reply found dispatching was first dispatched more than 23 hours earlier
- **THEN** it is recorded uncertain without another send

### Requirement: English transactional email copy
All transactional email templates SHALL use English copy regardless of the request or account language. Their HTML document SHALL declare `lang="en"`, and the plain-text alternative SHALL carry the same English content. This requirement applies to subjects, preheaders, headings, body copy and action labels; it does not change in-product or generated email-conversation language.

#### Scenario: Korean-speaking guest receives a transactional email
- **WHEN** any transactional email is rendered for a request or account whose stored language is Korean
- **THEN** its subject, HTML and plain-text copy are English, and the HTML declares `lang="en"`

#### Scenario: Guest resends a booking link
- **WHEN** a guest requests the booking link again from a Korean-language request
- **THEN** the resend email uses the same English copy and presentation

#### Scenario: Meeting status emails describe their actual outcome
- **WHEN** a request, proposal or booked meeting changes status
- **THEN** the email states whether the request is awaiting a decision, closed, still being booked, confirmed, cancelled, or unchanged after a dropped change, without implying that an unbooked request is already accepted or confirmed

#### Scenario: Account emails describe deletion state
- **WHEN** an account deletion is scheduled, cancelled, completed, or closes a host's open requests
- **THEN** the email clearly states the current state and the action the recipient can take, if any

### Requirement: Ink-blue request-link email design
The HTML versions of request-creation and booking-link resend emails SHALL use a calm, professional, responsive layout based on the product's ink-blue palette: paper background, white content surface, dark ink text and `#2C3E63` primary actions. The booking link SHALL be the visually primary action. When an email-address confirmation link is present, it SHALL appear in a separate, secondary section that says confirmation is optional and scheduling continues without it. The emails SHALL retain a plain-text alternative.

#### Scenario: Address confirmation is optional
- **WHEN** the request-creation email includes an email-confirmation link
- **THEN** the booking link remains the primary action, the confirmation action is visually secondary, and the copy explains that scheduling continues without confirmation

#### Scenario: Address already confirmed
- **WHEN** the contact address is already confirmed
- **THEN** the email contains the booking action and omits the confirmation section
