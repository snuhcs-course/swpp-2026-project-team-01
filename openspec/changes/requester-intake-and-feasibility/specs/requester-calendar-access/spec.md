## Purpose

Let a requester without any product account prefill their identity and share read-only Google Calendar access for one request, used privately for their busy times and travel, through a consent flow that is separate from host sign-in and never grants request authority, agreement or host capabilities.

## ADDED Requirements

### Requirement: Request-bound Google consent flow
**Continue with Google** and **Connect Google Calendar** for requesters SHALL use a Google OAuth flow owned by the application, separate from host sign-in: it SHALL NOT create a Supabase Auth user, a host account or a product session, and SHALL return to its own callback rather than `/auth/callback`. Each round trip SHALL be bound to one anonymous intake on a ready host's public page or to one open request whose booking link the starting page held, to the starting browser, and to a single-use, short-lived transaction with PKCE. A cancelled, replayed, expired or other-browser return SHALL change no request and reveal no request.

#### Scenario: Requester continues with Google
- **WHEN** a requester on a ready host's public page completes Google consent
- **THEN** one request is created for that host with the Google name and email, the browser continues at its booking link, and no host account, Supabase user or product session exists for the requester

#### Scenario: Return in another browser
- **WHEN** the callback for a consent started in one browser is opened in another browser or replayed
- **THEN** no request is created or changed and the page offers to start again from the host's public page without naming any request

#### Scenario: Consent cancelled
- **WHEN** the requester cancels on the Google consent screen
- **THEN** they return to the page they started from with their conversation and timezone intact, and no grant or request is recorded

### Requirement: Identity and Calendar recorded as separate grants
Identity and Calendar access requested on one consent screen SHALL be recorded as separate grants bound to the request. An identity grant SHALL fill in the requester's name and email; an email Google reports as verified SHALL count as the request's confirmed contact only while it equals the current contact. A Calendar grant SHALL exist only for the Calendar scopes Google reported as granted. Neither grant SHALL confer agreement, host approval, host eligibility or access to any other request.

#### Scenario: Calendar part unchecked
- **WHEN** the requester unchecks the Calendar scopes on the consent screen
- **THEN** the identity grant is recorded, name and email are filled in, no Calendar grant exists, and the booking page later offers **Connect Google Calendar** and **Skip for now**

#### Scenario: Matching existing contact
- **WHEN** a requester on an existing request continues with Google and the Google-verified address equals the request's current contact
- **THEN** **Use verified Google email** confirms that contact and changes nothing else

#### Scenario: Different Google address
- **WHEN** the Google-verified address differs from the request's current contact
- **THEN** the contact stays as it was until the requester reviews and applies the change, which sends the new address its confirmation email

### Requirement: Private read-only Calendar access
A requester Calendar grant SHALL request only calendar-list and read-only event access and SHALL be used only by evaluations of its own request, on the calendars the requester selected, to derive busy intervals under the same rules as host calendars and the places of the requester's events adjacent to in-person candidates. Event titles, attendees, descriptions and locations SHALL NOT be stored, logged, placed in a tool result or model context, or shown to the host or any agent; requester-facing text SHALL refer to an adjacent event only generically.

#### Scenario: Busy requester interval
- **WHEN** a selected requester calendar is busy during an otherwise feasible candidate
- **THEN** the candidate is excluded and neither the host nor the requester's agent sees the requester's event

#### Scenario: Declined requester event
- **WHEN** the requester declined an invitation during an otherwise feasible candidate
- **THEN** that event does not block the candidate

#### Scenario: Grant used for another request
- **WHEN** an operation for a different request would read the requester's calendar
- **THEN** that request's own grants are the only ones consulted and the first request's grant is never read

### Requirement: Request-bound grant lifetime
A requester grant SHALL last no longer than its request remains open and its booking link unexpired. Closure, link expiry and **Disconnect** SHALL delete the stored token, and SHALL request revocation at Google unless another open request of the same Google identity still holds a grant. Requester grants SHALL use an OAuth client separate from host sign-in, so revoking them never removes a host's Calendar access. A revoked, expired or failing grant SHALL pause evaluations that depend on it until the requester reconnects or replaces it with manual or agent-supplied availability; it SHALL NOT be treated as free time.

#### Scenario: Request closes
- **WHEN** a request is withdrawn or expires
- **THEN** its Calendar token is deleted, revocation is requested unless another open request of the same Google identity holds a grant, and no later evaluation reads that calendar

#### Scenario: Failed availability read
- **WHEN** reading the requester's busy intervals fails or the grant was revoked at Google
- **THEN** the evaluation offers no candidates that depend on it and the booking page offers reconnection or manual availability

#### Scenario: Skip for now
- **WHEN** the requester skips Calendar connection and gives availability windows instead
- **THEN** evaluation uses those windows and requesting continues without any Calendar grant
