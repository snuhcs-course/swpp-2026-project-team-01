## ADDED Requirements

### Requirement: Account requester identity
A request created through an account connection SHALL be identified with the account itself: its host display name and the Google address it signed in with, stored as the confirmed contact, and its host timezone unless the request names another. The account connection SHALL NOT accept a typed requester name or email. The account's host conflict calendars SHALL count as the requester's busy time from creation, without a calendar question, and the creation result SHALL name those calendars. An account without confirmed host settings SHALL be linked with no host calendars. Nothing about the account's settings or calendars SHALL reach the other host.

#### Scenario: Account requests a meeting
- **WHEN** an account with request scopes calls `create_request` with only a host handle, meeting details and a retry key
- **THEN** the request carries the account's name and verified Google address as a confirmed contact and the account's host timezone, and the result names the account's conflict calendars

#### Scenario: Typed identity
- **WHEN** an account connection passes a name or email to `create_request`
- **THEN** the input is refused and no request is created

#### Scenario: Host calendars count
- **WHEN** times are found for a request created through an account connection whose account has confirmed host settings
- **THEN** the account's host conflict calendars count as the requester's busy time, and a failed host grant pauses the search instead of assuming free time

#### Scenario: Account without settings
- **WHEN** an account without confirmed host settings creates a request
- **THEN** the request is linked to the account with no host calendars
