# Spec Delta

## ADDED Requirements

### Requirement: Guest stops messenger updates
A guest SHALL be able to send `STOP` from a linked iMessage or WhatsApp chat, or `STOP` or `/stop` from Telegram, to stop Find Me a Time messages on that channel. The service SHALL handle it before the assistant, end all active guest bindings for the sender on that channel, suppress queued messages, and confirm how to opt in again from a request's booking link.

#### Scenario: Guest stops updates before an assistant turn
- **WHEN** a guest sends `STOP` in a linked iMessage or WhatsApp chat, or `STOP` or `/stop` in Telegram
- **THEN** no assistant turn receives the text, no future message is queued for that guest on the channel, and one confirmation explains that updates can be restarted by reconnecting from the booking link in the request email

#### Scenario: Guest has several requests linked on one channel
- **WHEN** a guest sends `STOP` while more than one of their requests has an active binding on that channel
- **THEN** all of those bindings end and their queued messages are suppressed, while the requests, bookings, events, email updates, and other messenger channels stay unchanged

#### Scenario: Guest opts in again
- **WHEN** a guest who stopped updates opens a request's booking link and links a messenger again
- **THEN** that request has a new active binding and future updates go to the newly linked messenger
