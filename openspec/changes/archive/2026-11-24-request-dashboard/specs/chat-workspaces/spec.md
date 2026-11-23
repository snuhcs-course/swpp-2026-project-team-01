## MODIFIED Requirements

### Requirement: Host calendar Dashboard
The Dashboard SHALL show confirmed Find Me a Time bookings received by the signed-in account, timed requests the account sent as a verified guest, and events from selected Google calendars in the account's saved timezone. The sources SHALL have distinct colors and text labels. A confirmed booking also present in Google Calendar SHALL appear only once. The Dashboard SHALL provide week and month views, previous and next period navigation, a return to today, source filters, and details for a selected day and event. Calendar details SHALL be available only to the authenticated account. A Google Calendar access error SHALL leave Find Me a Time bookings and sent requests visible with an explanation. Period navigation SHALL keep the date and time grid visible, showing loading feedback in the event area while the period's events are fetched; a period loaded earlier in the visit SHALL show its events at once, the adjacent periods SHALL be fetched ahead, and the events shown SHALL always be those of the selected period.

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

#### Scenario: Sent booking and Google invitation
- **WHEN** a signed-in account has a confirmed booking made as a guest and Google Calendar returns its invitation
- **THEN** the Dashboard shows one labeled sent meeting at its confirmed time, not a second Google event

#### Scenario: Sent request waiting for approval
- **WHEN** a matched guest request has an agreed proposal awaiting approval
- **THEN** the Dashboard shows its proposed time and **Awaiting approval**, without calling it booked

#### Scenario: Guest without a verified account match
- **WHEN** a guest neither signs in with Google for a request nor has an existing signed-in account session
- **THEN** that request is absent from the account's sent view

## ADDED Requirements

### Requirement: Account request inbox
The Requests view SHALL combine requests received by the signed-in account with requests it sent as a guest whose verified Google subject or existing signed-in account session matched that active account, whether or not host settings were completed. A typed contact email alone SHALL NOT link a request. Each card SHALL show the other party, purpose when available, state, proposed time when available, and a direction tag reading **Received request** or **Sent request**. All, Received and Sent filters SHALL narrow the list. Received requests requiring action SHALL say **Needs your decision** in red, and a sent request awaiting the other party's approval SHALL say **Awaiting host approval**. Direction SHALL be conveyed by text as well as color.

#### Scenario: Both directions
- **WHEN** a signed-in account has one received and one matched sent request
- **THEN** both appear in All, and each appears only in its matching filter

#### Scenario: Signed-in guest continues without Google
- **WHEN** an already signed-in account identifies a guest request manually
- **THEN** the request is linked to that account after identification succeeds, without using the typed contact email as proof

#### Scenario: Open a sent request
- **WHEN** the account selects an open sent request with a valid private link
- **THEN** the existing guest workspace opens under that link, with its existing requester permissions; a closed sent request shows its conversation read only in the list instead ([guest-account-history](../../../../../specs/guest-account-history/spec.md))

#### Scenario: Expired private link
- **WHEN** the sent request's private link has expired
- **THEN** the summary remains visible but no link or request credential is exposed

#### Scenario: Closed request history
- **WHEN** a matched request closes
- **THEN** its host-profile settings choice is cleared and the account still sees the sent request summary
