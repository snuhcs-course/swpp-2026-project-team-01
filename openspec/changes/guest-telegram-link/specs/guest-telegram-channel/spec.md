## ADDED Requirements

### Requirement: Guest Telegram linking
Where Telegram is configured, the booking page's waiting card SHALL offer **Get updates in Telegram**. It SHALL ask for no number, SHALL create a request-owned one-time link code with the same validity, limits and replacement as a guest iMessage code, and SHALL open the bot's start link carrying the code, or on a computer show that link as a QR code with **Open Telegram**. Only the code arriving from a private Telegram chat SHALL complete the attempt, and nothing SHALL be bound before **Confirm and link**. A request SHALL have at most one active guest binding across iMessage, WhatsApp and Telegram.

#### Scenario: Link Telegram from the booking page
- **WHEN** the guest presses **Get updates in Telegram**, taps Start in the bot and presses **Confirm and link**
- **THEN** the request has one active Telegram guest binding, the card names the guest's Telegram name, and the welcome goes out on Telegram

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

### Requirement: Guest Telegram link through the agent
The requester agent's `start_updates_link` SHALL accept the Telegram channel without a number and return a connect link whose page shows the bot's start link and, after the code arrives, **Confirm and link**.

#### Scenario: Agent starts a Telegram link
- **WHEN** the requester agent calls `start_updates_link` with the Telegram channel
- **THEN** a pending Telegram attempt exists for the request and the result carries a connect link

### Requirement: Guest Telegram routing
A Telegram message from a sender with an active Telegram guest binding SHALL be routed as a guest iMessage is, and its text SHALL enter the request's requester discussion with the `[Telegram] ` prefix. Replies to the guest's message and the request's notices SHALL go out on Telegram as plain text without buttons. A button tap SHALL never reach a guest's discussion.

#### Scenario: Guest writes on Telegram
- **WHEN** a linked guest sends text to the bot
- **THEN** the requester discussion holds one input starting with `[Telegram] ` and the turn's reply is queued on Telegram

#### Scenario: Notice to a Telegram guest
- **WHEN** a status notice is queued for a Telegram guest
- **THEN** it is sent on Telegram with no buttons

### Requirement: Guest Telegram blocking
When a guest blocks the bot, or Telegram refuses a guest message because the bot was blocked, the guest's Telegram binding SHALL end and its unsent messages SHALL be suppressed.

#### Scenario: Guest blocks the bot
- **WHEN** a blocking update arrives from a sender with an active Telegram guest binding
- **THEN** the binding ends and nothing more is sent to that sender for the request
