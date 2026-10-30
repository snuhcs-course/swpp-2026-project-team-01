## ADDED Requirements

### Requirement: Match a guest to a host account by Google identity
On the requester Google return, the service SHALL compare the verified Google subject with host accounts' Google identities and SHALL treat the guest as a host only when that account is active, has confirmed settings and is not the request's host. An email address match alone SHALL NOT count. A match SHALL create no account session, sign-in or Google grant.

#### Scenario: Same address, different Google account
- **WHEN** the guest's Google email equals a host's address but the subject differs
- **THEN** no host-profile card is shown

#### Scenario: Guest is the request's host
- **WHEN** a host requests a meeting through their own public page
- **THEN** no host-profile card is shown

### Requirement: Opt-in host profile per request
A matched guest SHALL see one card offering calendars, iMessage (only with an active host binding), preferences and basic details, each uncheckable, and nothing SHALL be used before **Use these settings**. **Not now** SHALL be kept so the card does not return; **Change** on its receipt SHALL reopen it. The choice SHALL be stored per request and deleted when the request closes or is deleted.

#### Scenario: Partial opt-in
- **WHEN** the guest unchecks Preferences and presses **Use these settings**
- **THEN** calendars, iMessage and basic details are used for this request and candidate ordering ignores their host preferences

#### Scenario: Closure
- **WHEN** the request is declined
- **THEN** the stored host-profile choice is deleted in the same transaction as the request's requester grants

### Requirement: Host data stays with the guest
Host-profile data used for a request SHALL NOT reach the request's host, the host projection or host model context. Calendar events read through the guest-host's grant SHALL be used inside the evaluation only and never stored or shown. A failed or revoked guest-host grant SHALL clear the calendar item and pause dependent evaluation until the guest connects a calendar or supplies availability, and SHALL never be treated as free time.

#### Scenario: Revoked host grant
- **WHEN** the guest-host's Google grant is revoked between evaluations
- **THEN** the request shows **Connect Google Calendar** and no candidate is offered from missing data

#### Scenario: Host's view
- **WHEN** the request's host opens the request
- **THEN** nothing shows that the guest is a host or which of their settings are in use

### Requirement: Basic details through review
Timezone, language and travel mode from a host profile SHALL be applied only through a pending review the guest applies.

#### Scenario: Prefilled details
- **WHEN** the guest opts in to Basic details
- **THEN** a review card shows the values and the request changes only after **Apply these details**
