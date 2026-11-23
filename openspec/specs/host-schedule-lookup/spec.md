# host-schedule-lookup Specification

## Purpose
Let a host ask about their own schedule outside the web Dashboard: the host's setup conversation and the host MCP connection read the Dashboard's labeled events for a period without changing anything.

## Requirements

### Requirement: Read-only host schedule lookup
The host's own setup conversation, on the web and in the linked iMessage, WhatsApp or Telegram chat, and the host MCP connection under `host:read` SHALL offer a read-only schedule lookup for a period of 1 to 31 local days in the host's timezone, defaulting to seven days from today. It SHALL return the same events the Dashboard shows for that period: confirmed Find Me a Time meetings, other events from the Google Calendars the host chose, received requests awaiting a decision at their proposed time and requests the host sent, each labeled by kind, with local times, the week each falls in and the current date. Titles, places and names SHALL be marked as quoted data, guest contact details and join links SHALL be left out, a booked meeting SHALL appear once, and no calendar the host did not choose SHALL be read. The lookup SHALL change nothing.

#### Scenario: What is on tomorrow
- **WHEN** the host asks in the linked chat "What's on tomorrow?"
- **THEN** the assistant reads tomorrow's schedule and answers in time order, naming booked meetings apart from other calendar events and from requests not yet booked

#### Scenario: A booked meeting also in Google Calendar
- **WHEN** a confirmed booking's event is returned from a selected Google calendar
- **THEN** the lookup lists it once, as a booked meeting

#### Scenario: Google Calendar cannot be read
- **WHEN** the host's Google Calendar cannot be read
- **THEN** the lookup says so and still lists Find Me a Time meetings and requests, and the assistant says Google Calendar could not be read instead of inventing events

#### Scenario: MCP schedule
- **WHEN** the host's agent with `host:read` asks for this week's schedule
- **THEN** `get_schedule` returns the same labeled entries, and nothing is written

#### Scenario: Period out of range
- **WHEN** a lookup asks for more than 31 days or a date that does not exist
- **THEN** it is refused before any calendar is read
