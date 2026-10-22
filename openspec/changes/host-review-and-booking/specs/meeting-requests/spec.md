## ADDED Requirements

### Requirement: Booking attempt outcomes
A request SHALL enter booking only through host approval and SHALL leave it only through its booking's outcome: booked when the event is confirmed; negotiating, with the proposal stale, when revalidation finds a conflict; awaiting host approval, with the approval spent, when revalidation cannot complete or the provider definitively rejects the write; and withdrawn or declined only while no dispatch was committed. The expiry sweep SHALL NOT close a request whose booking is in flight; a reserved booking whose request expired SHALL be cancelled by its own revalidation. Every outcome SHALL advance the request revision.

#### Scenario: Conflict found at booking
- **WHEN** revalidation finds the approved interval no longer feasible
- **THEN** the request returns to negotiating, the agreed proposal can no longer be approved, and no event is created

#### Scenario: Expiry while booking is in flight
- **WHEN** a request's expiry passes while its booking is dispatching
- **THEN** the request stays booking until reconciliation establishes the outcome

### Requirement: Host-shared changes create a checked proposal
The host SHALL be able to suggest changed shared details (time, duration, mode, place or meeting link) from the proposal review or through the assistant, and SHALL share them only with an explicit **Share revised details** command at the expected revision. Sharing SHALL apply the details as a new request revision, which voids earlier agreement and approval, and SHALL check the suggested time with the feasibility engine before writing the next proposal version for the requester's agreement. A time that fails the check SHALL create no version and SHALL be explained to the host only. **Dismiss suggestions** SHALL change nothing shared.

#### Scenario: Shared change passes the check
- **WHEN** the host shares a later time that is feasible
- **THEN** a new proposal version exists for the requester to agree to, and the earlier agreement cannot authorize booking

#### Scenario: Shared change fails the check
- **WHEN** the host shares a time that overlaps a busy event
- **THEN** no proposal version is created, the host sees why privately, and the requester sees only that the request is being negotiated

### Requirement: Host request link
The host's links to a request, in `/app` and in the host's confirmation email, SHALL name the request by its ID and open the host's authorized workspace. The requester's booking link SHALL NOT be shown or sent to the host.

#### Scenario: Host opens the confirmation's link
- **WHEN** the host follows **View booking** in their confirmation email
- **THEN** `/app` opens that request after sign-in, and the URL carries no booking link
