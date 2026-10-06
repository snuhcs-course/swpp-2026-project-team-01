# Spec Delta

## ADDED Requirements

### Requirement: Single host workspace
Host admission, setup, request selection, review and settings SHALL remain inside `/app` as authorized states, cards or dialogs. Browser authentication and consent SHALL return to that workspace with the permitted context restored.

#### Scenario: Return from calendar consent
- **WHEN** an admitted host completes valid browser consent
- **THEN** `/app` restores the authorized draft and server-confirmed next action without a separate setup page

### Requirement: Stable protected requester destination
Public `/{handle}` intake SHALL continue at `/booking/[bookingId]` after request creation. The route identifier SHALL not provide authority or imply a confirmed event. Closed access SHALL obey the existing request credential lifetime and minimal receipt limits.

#### Scenario: Shared calendar link has no credential
- **WHEN** a browser without request authority opens a booking route from a shared calendar description
- **THEN** it receives no protected history or receipt details
