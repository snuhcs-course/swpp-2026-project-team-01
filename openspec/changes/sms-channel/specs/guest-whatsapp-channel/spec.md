## MODIFIED Requirements

### Requirement: Guest WhatsApp linking
Where WhatsApp is configured, the booking page's waiting card SHALL offer **Get updates in WhatsApp**. It SHALL ask for the guest's number, register it, create a request-owned one-time link code with the same validity, limits and replacement as a guest iMessage code, and open WhatsApp at the configured WhatsApp number with the guest link message written. Only a message carrying the code from WhatsApp SHALL complete the attempt, and it SHALL bind the sender to the request as soon as it arrives, with no confirmation on the booking page (`link-on-code` D1). A request SHALL have at most one active guest binding across iMessage, WhatsApp, Telegram and SMS, and each binding SHALL record its channel.

#### Scenario: Link WhatsApp from the booking page
- **WHEN** the guest presses **Get updates in WhatsApp**, enters their number, and sends the prefilled message from WhatsApp
- **THEN** the request has one active WhatsApp guest binding, the welcome goes out on WhatsApp, and the card shows the number's last four digits with **Unlink WhatsApp**

#### Scenario: Code from the other channel
- **WHEN** a WhatsApp attempt's code arrives from iMessage
- **THEN** the attempt is voided and nothing is bound

#### Scenario: WhatsApp not configured
- **WHEN** the deployment has no WhatsApp number
- **THEN** the card shows no **Get updates in WhatsApp** and a WhatsApp code request is refused

#### Scenario: Unlink WhatsApp
- **WHEN** the guest presses **Unlink WhatsApp**
- **THEN** the binding ends, unsent guest messages are suppressed, and later messages from that sender reach no discussion of the request
