## MODIFIED Requirements

### Requirement: Channel offered by device
The linking card, the link step after sign-in and the landing's start before sign-in SHALL offer iMessage first on iPhone, iPad and Mac and SMS first on every other device when SMS is configured, each with every other configured channel (WhatsApp and Telegram included) as a choice to use instead. When SMS is not configured or its gateway is stale, Android SHALL get WhatsApp first when it is configured, and other devices SHALL first ask which app the host uses on their phone among the configured channels, as `host-telegram-channel` "Channel offered by device with Telegram" specifies.

#### Scenario: Android host
- **WHEN** an Android host opens the link step while SMS and WhatsApp are configured
- **THEN** it offers **Connect SMS** with **Use WhatsApp instead** and no iMessage action

#### Scenario: Windows computer
- **WHEN** a host opens the linking card in a browser on Windows while SMS is not configured
- **THEN** it asks which of the configured apps the host uses on their phone before showing any channel's code

### Requirement: One messaging channel per host
A host SHALL have at most one active messaging binding across iMessage, WhatsApp, Telegram and SMS. Linking a sender on one channel SHALL end the host's binding on any other in the same transaction. Messages queued for the ended binding that have not been dispatched SHALL be suppressed. No summary SHALL go to two channels.

#### Scenario: iMessage host links WhatsApp
- **WHEN** a host linked on iMessage links a WhatsApp sender
- **THEN** the iMessage binding ends, later summaries go only to WhatsApp, and the iMessage sender gets the unlinked-sender reply if it writes again
