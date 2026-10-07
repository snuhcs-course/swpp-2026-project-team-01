# Spec Delta

## ADDED Requirements

### Requirement: Google-only MVP host login
The host workspace SHALL offer Google sign-in through Supabase Auth and SHALL NOT offer email/password, email OTP or magic-link login in the MVP. The application SHALL initiate identity-only OAuth with browser-bound PKCE and a fixed `/auth/callback` return to `/app`. The deployed Auth configuration SHALL disable email login. Login SHALL NOT grant host admission, Calendar permission or requester authority; waitlist and requester contact email fields SHALL remain available.

#### Scenario: Google login before admission
- **WHEN** a user completes Google sign-in without a redeemed invitation
- **THEN** the workspace displays invitation controls without private host conversation or Calendar access

#### Scenario: Invalid or cancelled return
- **WHEN** Google login is cancelled, the code is replayed or the callback arrives in another browser
- **THEN** no new authorized host session is established and the user can restart Google sign-in at `/app`

#### Scenario: Former email login request
- **WHEN** a client submits an email address to the sign-in endpoint
- **THEN** the request is rejected without sending an authentication email

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
