# Spec Delta

## ADDED Requirements

### Requirement: Host Calendar disconnect from a linked messenger
A host SHALL be able to explicitly disconnect Google Calendar from Connected apps or their linked iMessage, WhatsApp, or Telegram conversation. Disconnecting SHALL remove the saved grant and calendar selections, make the host unready and pause new requests, while preserving existing requests, bookings, and Calendar events. Calendar-dependent work on existing requests SHALL wait until the host reconnects and completes setup.

#### Scenario: Disconnect from a linked messenger
- **WHEN** a host clearly asks Thyme in their linked iMessage, WhatsApp, or Telegram conversation to disconnect Google Calendar
- **THEN** Thyme disconnects the saved grant, explains that new requests are paused and existing requests remain open, and says existing bookings and Calendar events stay in place

#### Scenario: Work resumes after reconnecting
- **WHEN** a host who disconnected Calendar reconnects and completes setup with a writable booking calendar
- **THEN** the host becomes ready again and calendar-dependent work can continue on existing requests
