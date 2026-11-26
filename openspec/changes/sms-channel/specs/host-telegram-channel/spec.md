## RENAMED Requirements

- FROM: `### Requirement: One messaging channel across three`
- TO: `### Requirement: One messaging channel across four`

## MODIFIED Requirements

### Requirement: Channel offered by device with Telegram
The linking card, the link step after sign-in and the landing's start before sign-in SHALL offer the configured channels by device. iPhone, iPad and Mac SHALL get iMessage, with a choice to use each other configured channel instead. Every other device SHALL get SMS when it is configured, with a choice to use each other configured channel instead. When SMS is not configured or its gateway is stale, Android SHALL get WhatsApp when configured and Telegram otherwise, and other devices SHALL first ask which app the host uses on their phone, among the configured channels. A channel that is not configured SHALL NOT be offered.

#### Scenario: Android without WhatsApp
- **WHEN** an Android host opens the link step while SMS and WhatsApp are not configured
- **THEN** it offers **Connect Telegram** and no WhatsApp, SMS or iMessage action

#### Scenario: Android host with SMS
- **WHEN** an Android host opens the link step while SMS and Telegram are configured
- **THEN** it offers **Connect SMS** with **Use Telegram instead** and no iMessage action

#### Scenario: Windows computer with SMS
- **WHEN** a host opens the link step in a browser on Windows while SMS is configured
- **THEN** it offers **Connect SMS** with the other configured channels as choices

#### Scenario: iPhone host
- **WHEN** an iPhone host opens the linking card while Telegram and SMS are configured
- **THEN** it offers **Connect iMessage** with **Use Telegram instead** and **Use SMS instead**

### Requirement: One messaging channel across four
A host SHALL have at most one active messaging binding across iMessage, WhatsApp, Telegram and SMS. Linking SHALL end the earlier binding in the same transaction and suppress messages queued for it that have not been dispatched. No summary SHALL go to two channels.

#### Scenario: iMessage host links Telegram
- **WHEN** a host linked on iMessage links a Telegram sender
- **THEN** the iMessage binding ends, later summaries go only to Telegram, and the iMessage sender gets the unlinked-sender reply if it writes again

#### Scenario: Telegram host links SMS
- **WHEN** a host linked on Telegram links an SMS sender
- **THEN** the Telegram binding ends, its queued messages are suppressed, and later summaries go only to SMS
