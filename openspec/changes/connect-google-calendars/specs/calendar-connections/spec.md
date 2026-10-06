# Spec Delta

## Purpose

Bind Google Calendar permissions to their authorized host or request and make consent, calendar selection, and credential recovery explicit.

## ADDED Requirements

### Requirement: Bound single-use consent
Calendar callbacks SHALL validate an expiring single-use consent context bound to the initiating browser and authorized host or request. Invalid, replayed, or swapped callbacks SHALL not attach a grant.

#### Scenario: Swapped browser context
- **WHEN** a callback presents valid provider data with another browser's binding
- **THEN** no grant is attached and the user receives a safe restart action

#### Scenario: Replayed callback
- **WHEN** a consumed or expired consent context is reused
- **THEN** the callback is rejected without changing an existing grant

### Requirement: Distinct host and requester authority
Host grants SHALL support authorized conflict reads and writes only to the selected writable booking calendar. Requester grants SHALL supply availability only for their authorized request and SHALL never permit host reads or event creation.

#### Scenario: Requester grant used for booking
- **WHEN** a booking operation presents a requester grant
- **THEN** it is rejected without an event write

#### Scenario: Cross-request availability access
- **WHEN** a requester grant is accessed from another request
- **THEN** access is denied without disclosing availability or credentials

### Requirement: Explicit calendar permissions
Host setup SHALL list authorized calendars and verify selected conflict calendars and the booking destination's current permissions. A read-only calendar SHALL not become a booking destination.

#### Scenario: Read-only destination
- **WHEN** a host selects a calendar without event creation permission
- **THEN** setup rejects the destination and remains incomplete

### Requirement: Server-only protected grants
Calendar tokens SHALL remain protected server-side and absent from public, guest, host DTOs, model context, and logs. Disconnection SHALL revoke local authority and delete locally stored refresh credentials.

#### Scenario: Inspect connection responses
- **WHEN** either party reads setup or request connection status
- **THEN** the response contains actionable status and no provider tokens

#### Scenario: Disconnect
- **WHEN** the authorized owner disconnects a grant
- **THEN** later dependent reads or writes cannot use the stored grant

### Requirement: Honest calendar failures
Denied consent, revoked access, refresh failure, and failed required calendar reads SHALL produce a recovery action and SHALL not be interpreted as an empty calendar.

#### Scenario: Required read fails
- **WHEN** a connected requester calendar cannot be read
- **THEN** dependent evaluation pauses until reconnection or explicitly confirmed manual availability replaces it

#### Scenario: Requester skips consent
- **WHEN** an account-free requester declines optional Calendar consent
- **THEN** manual or agent-supplied availability remains available without agreeing to a proposal or admitting a host

### Requirement: Bounded requester grant lifecycle
Requester grants SHALL be scoped to an open authorized request and SHALL lose authority on closure or continuation-credential revocation. Resuming consent SHALL return to that same protected request.

#### Scenario: Consent interrupted and resumed
- **WHEN** a requester completes browser consent after leaving intake
- **THEN** continuation resumes the same request with its current state and no host signup requirement

### Requirement: Optional guest identity independent of Calendar access
Guests SHALL be offered optional Google identity to prefill name and verified email alongside manual contact entry without mandatory product signup. The service SHALL validate identity server-side and bind callbacks to the initiating browser and intake/request authority. Identity sign-in SHALL not grant Calendar access, host admission, request access by email matching or proposal agreement. Manual or alternate recipient email SHALL pass contact verification before trusted invitation/recovery use.

#### Scenario: Identity only or no Google
- **WHEN** a guest completes Google identity sign-in without Calendar consent or chooses manual contact entry
- **THEN** the same intake/request continues with the appropriate contact verification state and manual availability remains available without Calendar access or host onboarding

#### Scenario: Changed account or callback binding
- **WHEN** a callback uses another browser's state, a different request binding or a matching email without request authority
- **THEN** it cannot attach or reveal a request, and the guest receives a safe restart/continuation action without merging histories

### Requirement: Guest timezone suggestion without redundant prompts
Guest intake SHALL use detected browser IANA timezone for initial time display unless an explicit guest choice exists. It SHALL show a timezone selector and date-specific offsets without a separate confirmation question when the context is unambiguous. Missing or conflicting timezone and ambiguous local-time/travel input SHALL require clarification.

#### Scenario: Detection and explicit correction
- **WHEN** a guest views candidates, changes the display timezone and returns from Google authorization
- **THEN** the explicit timezone persists, candidate instants remain unchanged and rendered offsets reflect each date, without repeating the timezone question
