## ADDED Requirements

### Requirement: Guest linking on the code's arrival
A guest's request-owned link code on iMessage, WhatsApp or Telegram SHALL bind its sender to the request as soon as the code's message arrives, when the code is pending and unexpired, the message comes from a direct conversation on the channel the code was made for, and the request is open. No **Is this your Telegram?** or other confirmation SHALL be asked. The messenger SHALL receive the guest's welcome, and the booking page's card SHALL show the linked sender (last four digits or Telegram name) with an unlink action without a reload. A code SHALL be single-use, valid for 15 minutes and limited to 5 per request per hour.

#### Scenario: Telegram on Start
- **WHEN** a guest who submitted a request taps **Get updates in Telegram** and then **Start** in the bot
- **THEN** the request has one active Telegram binding, the bot's first message is the welcome, and the card reads that Telegram is linked with **Unlink Telegram**

#### Scenario: Closed request
- **WHEN** the code arrives after the request closed
- **THEN** nothing is bound and the sender gets at most a fixed reply
