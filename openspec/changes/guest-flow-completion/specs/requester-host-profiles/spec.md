## ADDED Requirements

### Requirement: Match a guest to a host account by Google identity
On the requester Google return, the service SHALL compare the verified Google subject with host accounts' Google identities and SHALL link the request to an active account other than the request's host, even when that account has not completed host settings. The host-profile card SHALL be offered only when that account has confirmed settings. An email address match alone SHALL NOT count. A match SHALL create no account session, sign-in or Google grant.

#### Scenario: Same address, different Google account
- **WHEN** the guest's Google email equals a host's address but the subject differs
- **THEN** no host-profile card is shown

#### Scenario: Guest is the request's host
- **WHEN** a host requests a meeting through their own public page
- **THEN** no host-profile card is shown

#### Scenario: Active account without host settings
- **WHEN** a guest's verified Google subject matches an active account without confirmed host settings
- **THEN** the sent request is linked to that account but no host-profile settings card is shown

### Requirement: Opt-in host profile per request
A matched guest SHALL see one card offering calendars and basic details, each uncheckable, and nothing SHALL be used before **Use these settings**. **Not now** SHALL be kept so the card does not return; **Change** on its receipt SHALL reopen it. The choice SHALL be stored per open request and cleared when the request closes. The verified account-to-request match SHALL remain for the signed-in account's sent request history until the request or account is deleted. With Calendars chosen, busy time from the guest's host conflict calendars SHALL be combined with busy time from any Calendar connected for the request.

#### Scenario: Partial opt-in
- **WHEN** the guest unchecks Basic details and presses **Use these settings**
- **THEN** their host calendars are used for this request and no review is drafted from their host settings

#### Scenario: Both calendars count
- **WHEN** the guest chose Calendars and also connected a Calendar for the request
- **THEN** no candidate overlaps busy time from either

#### Scenario: Closure
- **WHEN** the request is declined
- **THEN** the stored host-profile choice is cleared in the same transaction as the request's requester grants, while the verified account match remains

### Requirement: Host data stays with the guest
Host-profile data used for a request SHALL NOT reach the request's host, the host projection or host model context. Calendar events read through the guest-host's grant SHALL be used inside the evaluation only and never stored or shown. A failed or revoked guest-host grant SHALL clear the calendar item and pause dependent evaluation until the guest connects a calendar or supplies availability, and SHALL never be treated as free time.

#### Scenario: Revoked host grant
- **WHEN** the guest-host's Google grant is revoked between evaluations
- **THEN** the request shows **Connect Google Calendar** and no candidate is offered from missing data

#### Scenario: Host's view
- **WHEN** the request's host opens the request
- **THEN** nothing shows that the guest is a host or which of their settings are in use

### Requirement: Basic details through review
Timezone and travel mode from a host profile SHALL be applied only through a pending review the guest applies.

#### Scenario: Prefilled details
- **WHEN** the guest opts in to Basic details
- **THEN** a review card shows the values and the request changes only after **Apply these details**
