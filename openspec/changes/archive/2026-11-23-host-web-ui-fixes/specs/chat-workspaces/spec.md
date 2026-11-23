## MODIFIED Requirements

### Requirement: Single host workspace
Host sign-in, setup, request selection, review and settings SHALL remain inside `/app` as authorized states, cards or dialogs. Browser authentication and consent SHALL return to that workspace with the permitted context restored. The wordmark on every signed-in host page SHALL link to `/app`. While the workspace reads the host's session, it SHALL show the workspace background with a loading status, not the sign-in layout. A return from Google consent begun at Thyme's Calendar link SHALL say that Google Calendar is connected only when the grant can use Calendar.

#### Scenario: Return from calendar consent
- **WHEN** an active host completes valid browser consent
- **THEN** `/app` restores the authorized draft and server-confirmed next action without a separate setup page

#### Scenario: Return from Thyme's Calendar link
- **WHEN** a linked host who is not ready grants Calendar on the consent opened from Thyme's Calendar link
- **THEN** `/app` says that Google Calendar is connected and that setup continues in the linked app, with its open action, instead of the link confirmation

#### Scenario: Wordmark opens the workspace
- **WHEN** a signed-in host selects the Find Me a Time wordmark on the Dashboard, the requests, the setup conversation, the notes page, the link step or the suspended-account page
- **THEN** the workspace at `/app` opens

#### Scenario: Workspace loading
- **WHEN** a host opens `/app` or `/app/notes` and the server has not yet read the session
- **THEN** the page shows the workspace background with a loading status announced to screen readers, and no sign-in layout

### Requirement: Host calendar Dashboard
The Dashboard SHALL show confirmed Find Me a Time bookings and events from the host's selected Google calendars in the host's saved timezone. The two sources SHALL have distinct colors and text labels. A confirmed booking that is also present in Google Calendar SHALL appear only once as a Find Me a Time meeting. The Dashboard SHALL provide week and month views, previous and next period navigation, a return to today, source filters, and details for a selected day and event. Calendar details SHALL be available only to the authenticated host. A Google Calendar access error SHALL leave confirmed bookings visible with an explanation. Period navigation SHALL keep the date and time grid visible, showing loading feedback in the event area while the period's events are fetched; a period loaded earlier in the visit SHALL show its events at once, the adjacent periods SHALL be fetched ahead, and the events shown SHALL always be those of the selected period.

#### Scenario: Compare sources
- **WHEN** a host opens a week containing a Google event and a confirmed Find Me a Time booking
- **THEN** both appear with distinct colors and labels, and selecting either reveals its time and available location

#### Scenario: Booking also appears in Google Calendar
- **WHEN** a confirmed booking's event is returned from a selected Google calendar
- **THEN** the Dashboard shows one Find Me a Time meeting for it, not a second Google event

#### Scenario: Google Calendar access fails
- **WHEN** Google Calendar cannot be read for the host
- **THEN** confirmed Find Me a Time bookings remain visible and a status message explains the Google Calendar problem

#### Scenario: Changing weeks
- **WHEN** the host moves to the next week and back in the Week view
- **THEN** the grid stays visible throughout, the next week's events usually show without waiting, and the week returned to shows its events at once

#### Scenario: Answers arrive out of order
- **WHEN** the host moves through several weeks quickly and an earlier week's answer arrives last
- **THEN** the Dashboard shows the selected week's events, not the earlier week's
