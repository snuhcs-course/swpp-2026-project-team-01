# Spec Delta

## ADDED Requirements

### Requirement: Scheduling deletion from Settings
A signed-in, active host SHALL be able to schedule the deletion of their own account from the Settings dialog after typing their current handle, or their Google address when they hold no handle, compared without regard to case or surrounding spaces. Scheduling SHALL record a due time 7 days after the request, SHALL sign the host out of every session, and SHALL queue an email to the host's Google address that names the date and says that signing in before then cancels it. Scheduling an account whose deletion is already scheduled SHALL keep the original due time. The card SHALL say that the deletion cannot be undone once it runs, that open requests will be closed and their guests told, and that meetings already on a calendar stay there. `/app?settings=account` SHALL open the dialog at that card.

#### Scenario: Host schedules deletion
- **WHEN** a host types their handle and chooses **Delete my account**
- **THEN** the deletion is due 7 days later, the host is signed out and sees that signing in before then cancels it, and an email with the date is queued

#### Scenario: Wrong confirmation
- **WHEN** the typed text does not match the host's handle
- **THEN** nothing is scheduled and the card says the handle does not match

#### Scenario: Cross-site or signed-out request
- **WHEN** the route is called from another site or without a host session
- **THEN** it is refused and nothing is scheduled

### Requirement: Cancelling by signing in
A host's Google sign-in to an account whose deletion is scheduled SHALL cancel the deletion in the sign-in transaction and SHALL queue an email to the host saying it was cancelled. A cancelled schedule SHALL never run, including when the host schedules again later.

#### Scenario: Host signs in during the grace period
- **WHEN** the host signs in before the due time
- **THEN** the schedule is cleared, the account is unchanged, and a cancellation email is queued

#### Scenario: Schedule again after cancelling
- **WHEN** the host schedules, signs in, and schedules again
- **THEN** only the latest schedule runs, 7 days after it was made

### Requirement: Running a scheduled deletion
When a schedule falls due and is still current, the service SHALL delete the account with the same database function and rules as operator deletion, recorded as a self-service deletion. In the same transaction it SHALL queue, for each open request with a contact address, an email telling the guest that the host closed their account, and an email telling the host that the deletion ran. A booking whose write may exist SHALL postpone the deletion until its outcome is known.

#### Scenario: Deletion runs
- **WHEN** the due time passes and the host has not signed in
- **THEN** the host's data and Auth user are deleted as an operator deletion would, the handle stays reserved, the audit names self-service, and the guest and host emails are queued

#### Scenario: Booking in flight
- **WHEN** the deletion falls due while one of the host's bookings is being written
- **THEN** nothing is deleted and the deletion is retried later

### Requirement: Account emails survive the deletion
Account emails SHALL be sent only while their purpose still holds (scheduled: the same due time is still set; cancelled: no deletion is scheduled; completed and guest notice: the account is deleted), SHALL survive the deletion of the host's data, and SHALL be deleted 30 days after reaching a final state.

#### Scenario: Scheduled email after cancellation
- **WHEN** the host cancels before the scheduled email is dispatched
- **THEN** the scheduled email is suppressed

### Requirement: Chats point to Settings
The assistant on every channel and the MCP server's instructions SHALL NOT delete an account. When a host asks to delete their account, the assistant SHALL reply with the Settings link (`/app?settings=account`) and say that deletion is confirmed there and can be cancelled by signing in within 7 days.

#### Scenario: Host asks in iMessage
- **WHEN** a linked host writes "delete my account"
- **THEN** Thyme replies with the Settings link and nothing is deleted
