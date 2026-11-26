## MODIFIED Requirements

### Requirement: Channel offered by device
The linking card, the link step after sign-in and the landing's start before sign-in SHALL offer WhatsApp first on Android when it is configured, and iMessage first on iPhone, iPad and Mac, each with every other configured channel (Telegram and SMS, and WhatsApp on Apple devices) as a choice to use instead, and on other devices first ask which app the host uses on their phone among the configured channels. When WhatsApp is not configured, Android SHALL follow `host-telegram-channel` "Channel offered by device with Telegram".

#### Scenario: Android host
- **WHEN** an Android host opens the link step while WhatsApp is configured
- **THEN** it offers **Connect WhatsApp** and no iMessage action

#### Scenario: Windows computer
- **WHEN** a host opens the linking card in a browser on Windows
- **THEN** it asks which of the configured apps the host uses on their phone before showing any channel's code
