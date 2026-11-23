## ADDED Requirements

### Requirement: Counts-only channel usage records
The system SHALL keep, per UTC day and messaging channel (iMessage, WhatsApp, Telegram), the number of hosts with an active host binding, inbound messages, requests whose guest linked the channel and original bookings confirmed on those requests. A record SHALL hold only those counts, its day, its channel and its recording time, never a host, request, sender, conversation or message. The counts SHALL be recounted from the stored receipts, bindings, requests and bookings at least hourly for the last seven days, and SHALL be kept after those sources are deleted. Sample requests and changes after booking SHALL NOT be counted.

#### Scenario: Sources deleted after 30 days
- **WHEN** the receipts and bindings a day was counted from are deleted by retention
- **THEN** that day's counts remain and are unchanged

#### Scenario: A day counted again
- **WHEN** a recent day is recounted
- **THEN** it keeps one record per channel with the current counts, and a channel with no activity has a record of zeros

#### Scenario: A guest's binding moves to a revised request
- **WHEN** a guest binding moves from a declined request to its revision
- **THEN** only the original link counts as a guest link

### Requirement: Read-only channel usage report
A server-authorized operator who selects exactly one environment SHALL be able to read the channel usage counts per channel by UTC day (at most 90) or by ISO week starting on Monday (at most 52), ending at a chosen date or today. Each period SHALL show how many of its days were recorded, and periods without records SHALL be shown as not recorded rather than as measured zeros. A week SHALL sum its days and report its highest day's active hosts. The report SHALL return counts and dates only, SHALL state what each count covers, and SHALL change nothing.

#### Scenario: Weekly report
- **WHEN** the operator asks for weeks
- **THEN** each channel lists Monday-to-Sunday periods with summed messages, guest links and bookings and the highest daily active hosts, with their recorded days

#### Scenario: Unrecorded days
- **WHEN** a requested day falls before the first record or was missed
- **THEN** it is shown as not recorded, not as a day with no activity

#### Scenario: Invalid request
- **WHEN** the operator names an unknown period, too many periods or an invalid date
- **THEN** the command refuses before reading any counts
