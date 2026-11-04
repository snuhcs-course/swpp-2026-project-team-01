## ADDED Requirements

### Requirement: Guest WhatsApp linking
Where WhatsApp is configured, the booking page's waiting card SHALL offer **Get updates in WhatsApp**. It SHALL ask for the guest's number, register it, create a request-owned one-time link code with the same validity, limits and replacement as a guest iMessage code, and open WhatsApp at the configured WhatsApp number with the guest link message written. Only a message carrying the code from WhatsApp SHALL complete the attempt, and nothing SHALL be bound before **Confirm and link**. A request SHALL have at most one active guest binding across iMessage and WhatsApp, and each binding SHALL record its channel.

#### Scenario: Link WhatsApp from the booking page
- **WHEN** the guest presses **Get updates in WhatsApp**, enters their number, sends the prefilled message from WhatsApp and presses **Confirm and link**
- **THEN** the request has one active WhatsApp guest binding and the welcome goes out on WhatsApp

#### Scenario: Code from the other channel
- **WHEN** a WhatsApp attempt's code arrives from iMessage
- **THEN** the attempt is voided and nothing is bound

#### Scenario: WhatsApp not configured
- **WHEN** the deployment has no WhatsApp number
- **THEN** the card shows no **Get updates in WhatsApp** and a WhatsApp code request is refused

#### Scenario: Unlink WhatsApp
- **WHEN** the guest presses **Unlink WhatsApp**
- **THEN** the binding ends, unsent guest messages are suppressed, and later messages from that sender reach no discussion of the request

### Requirement: Guest WhatsApp routing
A message from a sender with an active WhatsApp guest binding SHALL be routed as a guest iMessage is, and its text SHALL enter the request's requester discussion with the `[WhatsApp] ` prefix. Replies to the guest's message SHALL go out on WhatsApp.

#### Scenario: Guest writes on WhatsApp
- **WHEN** a linked guest sends text on WhatsApp
- **THEN** the requester discussion holds one input starting with `[WhatsApp] ` and the turn's reply is queued on WhatsApp

### Requirement: Guest WhatsApp window
A guest's WhatsApp notice or reply SHALL be sent as plain text only within 23 hours 50 minutes of the guest's last WhatsApp message, the link message included. Outside that window it SHALL be suppressed with category `window_closed`, and no template or other WhatsApp message SHALL be sent in its place. Guest WhatsApp messages SHALL carry no reply buttons.

#### Scenario: Notice inside the window
- **WHEN** a status notice is queued for a WhatsApp guest who wrote within the window
- **THEN** it is sent as plain text on WhatsApp

#### Scenario: Notice outside the window
- **WHEN** a status notice is queued for a WhatsApp guest whose last message is older than the window
- **THEN** it is suppressed with `window_closed`, no template is queued, and the booking email still goes out
