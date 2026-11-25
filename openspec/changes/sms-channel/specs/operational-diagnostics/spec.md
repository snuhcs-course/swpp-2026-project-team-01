## MODIFIED Requirements

### Requirement: Counts-only channel usage records
The system SHALL keep, per UTC day and messaging channel (iMessage, WhatsApp, Telegram, SMS), the number of hosts with an active host binding, inbound messages, requests whose guest linked the channel and original bookings confirmed on those requests. A record SHALL hold only those counts, its day, its channel and its recording time, never a host, request, sender, conversation or message. The counts SHALL be recounted from the stored receipts, bindings, requests and bookings at least hourly for the last seven days, and SHALL be kept after those sources are deleted. Sample requests and changes after booking SHALL NOT be counted.

#### Scenario: Sources deleted after 30 days
- **WHEN** the receipts and bindings a day was counted from are deleted by retention
- **THEN** that day's counts remain and are unchanged

#### Scenario: A day counted again
- **WHEN** a recent day is recounted
- **THEN** it keeps one record per channel with the current counts, and a channel with no activity has a record of zeros

#### Scenario: A guest's binding moves to a revised request
- **WHEN** a guest binding moves from a declined request to its revision
- **THEN** only the original link counts as a guest link
