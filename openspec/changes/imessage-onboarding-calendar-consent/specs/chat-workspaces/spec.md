## ADDED Requirements

### Requirement: Renewed consent when sign-in gives no lasting Calendar access
A host Google sign-in that asks for Calendar without Google's consent screen SHALL record that in an HTTP-only cookie scoped to `/auth`. When its callback finds that Google granted every Calendar scope but the host's grant still cannot use Calendar (no refresh token, or a stored token Google has rejected), the callback SHALL keep the new session and redirect to the renewed Calendar consent (`/auth/sign-in?consent=calendar`), carrying over the recorded return, instead of returning to `/app`. A sign-in that already asked Google for the consent screen, an identity-only sign-in, or one where the host left a Calendar scope unticked SHALL NOT be redirected.

#### Scenario: Account that authorized the client before
- **WHEN** a host whose Google account already authorized Find Me a Time signs in from the web, Google skips the consent screen, grants the Calendar scopes and returns no refresh token
- **THEN** the callback goes straight on to Google's consent screen, the refresh token it returns is stored, and neither `/app` setup nor the messenger welcome asks the host to connect Google Calendar again

#### Scenario: Renewed consent still gives no token
- **WHEN** the renewed consent's own callback still finds no refresh token
- **THEN** it returns to `/app` without another redirect

#### Scenario: Calendar permission unticked
- **WHEN** the host unticks a Calendar permission on Google's screen
- **THEN** the callback returns to `/app` as before, and setup asks for Calendar later
