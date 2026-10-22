## MODIFIED Requirements

### Requirement: Google-only MVP host login
The host workspace SHALL offer Google sign-in through Supabase Auth and SHALL NOT offer email/password, email OTP or magic-link login in the MVP. The application SHALL initiate one Google OAuth consent that requests identity together with the Calendar scopes needed to read selected calendars and create events, with browser-bound PKCE, offline access and a `/auth/callback` return to `/app`, and SHALL record the scopes Google actually granted and the refresh token server-side at sign-in. The only other return SHALL be to a live, undecided agent consent transaction at `/connect/consent`, which sign-in records in an HTTP-only cookie after checking the transaction and which the callback checks again; a query parameter or other caller-supplied value SHALL NOT choose the destination. The deployed Auth configuration SHALL disable email login. First-time Google sign-in SHALL create an active host account whether or not the Calendar scopes were granted. Calendar permission SHALL exist only for granted scopes; login SHALL NOT grant requester authority, and requester contact email fields SHALL remain available.

#### Scenario: First Google sign-in
- **WHEN** a user completes Google sign-in for the first time
- **THEN** the service creates an active host account and the workspace opens the setup conversation with the Calendar access granted on that screen

#### Scenario: Calendar scopes unchecked at sign-in
- **WHEN** the user completes Google sign-in but unchecks the Calendar scopes on the consent screen
- **THEN** the active host account is still created and setup offers **Connect Google Calendar** before calendar analysis or booking-destination selection, without blocking unrelated settings

#### Scenario: Invalid or cancelled return
- **WHEN** Google login is cancelled, the code is replayed or the callback arrives in another browser
- **THEN** no new authorized host session is established and the user can restart Google sign-in at `/app`

#### Scenario: Former email login request
- **WHEN** a client submits an email address to the sign-in endpoint
- **THEN** the request is rejected without sending an authentication email

#### Scenario: Sign-in from agent consent
- **WHEN** a signed-out host starts sign-in from the consent page of a live transaction
- **THEN** the callback returns to that consent page instead of `/app`

#### Scenario: Return to a stale transaction
- **WHEN** the recorded transaction expired or was decided before the callback
- **THEN** the callback returns to `/app`
