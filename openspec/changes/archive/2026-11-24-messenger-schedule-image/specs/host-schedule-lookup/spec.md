## ADDED Requirements

### Requirement: Schedule image in the linked chat
When the host, writing from their linked iMessage, WhatsApp or Telegram chat, asks to see their schedule as an image, the assistant SHALL send one picture of up to seven local days of the same events the schedule lookup returns, each drawn by kind, in that chat. The picture SHALL be its own outbox message that carries no settings review, so it never counts as or replaces the settings preview, and it SHALL change nothing. The reply SHALL say the same days in words, so it stands alone when the picture cannot be drawn; a picture that cannot be drawn SHALL send nothing. A request for the picture from anywhere but the linked chat SHALL send nothing.

#### Scenario: This week as an image
- **WHEN** the host writes in the linked chat "Show this week's schedule as an image"
- **THEN** one picture of this week's booked meetings, other calendar events, requests to decide and sent requests goes to that chat, and the reply sums the week up in words

#### Scenario: The settings preview is untouched
- **WHEN** a schedule image was sent after the host's latest slot preview
- **THEN** confirming the settings still reads that slot preview, and the confirmation is not stale

#### Scenario: Google Calendar cannot be read
- **WHEN** the host asks for the picture and Google Calendar cannot be read
- **THEN** the picture shows only Find Me a Time meetings and requests and says Google Calendar could not be read

#### Scenario: The picture cannot be drawn
- **WHEN** rendering the picture fails
- **THEN** nothing is sent for it and the reply still gives the schedule in words

#### Scenario: Not from the linked chat
- **WHEN** the tool is called for a turn that did not come from the linked chat
- **THEN** nothing is queued and the assistant answers in words
