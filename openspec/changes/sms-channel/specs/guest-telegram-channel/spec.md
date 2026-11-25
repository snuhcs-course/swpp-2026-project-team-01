## MODIFIED Requirements

### Requirement: Guest Telegram linking
Where Telegram is configured, the booking page's waiting card SHALL offer **Get updates in Telegram**. It SHALL ask for no number, SHALL create a request-owned one-time link code with the same validity, limits and replacement as a guest iMessage code, and SHALL open the bot's start link carrying the code, or on a computer show that link as a QR code with **Open Telegram**. Only the code arriving from a private Telegram chat SHALL complete the attempt, and it SHALL bind the sender to the request as soon as it arrives, with no **Is this your Telegram?** confirmation (`link-on-code` D1). The card that shows the start link SHALL say, before the guest taps Start, that Telegram keeps bot chats on its servers. A request SHALL have at most one active guest binding across iMessage, WhatsApp, Telegram and SMS.

#### Scenario: Link Telegram from the booking page
- **WHEN** the guest presses **Get updates in Telegram** and taps Start in the bot
- **THEN** the request has one active Telegram guest binding, the card names the guest's Telegram name with **Unlink Telegram**, and the welcome goes out on Telegram

#### Scenario: No number for Telegram
- **WHEN** the guest presses **Get updates in Telegram**
- **THEN** no number is asked for and nothing is registered with Photon

#### Scenario: Code from the other channel
- **WHEN** a Telegram attempt's code arrives from iMessage
- **THEN** the attempt is voided and nothing is bound

#### Scenario: Telegram not configured
- **WHEN** the deployment has no bot username
- **THEN** the card shows no **Get updates in Telegram** and a Telegram code request is refused

#### Scenario: Unlink Telegram
- **WHEN** the guest presses **Unlink Telegram**
- **THEN** the binding ends, unsent guest messages are suppressed, and later messages from that sender reach no discussion of the request
