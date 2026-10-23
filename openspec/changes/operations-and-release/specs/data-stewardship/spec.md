## ADDED Requirements

### Requirement: Retention schedule
A maintenance pass SHALL delete, at most a bounded number of rows per rule per pass: closed requests and everything under them 90 days after closure; completed jobs, command outcomes, link-resend records, admission windows and agent protocol attempts after 30 days; exhausted jobs and model reservations after 90 days; operator audit rows after one year. Open requests, live accounts and their confirmed settings SHALL NOT be deleted by retention.

#### Scenario: Old closed request
- **WHEN** the pass runs 91 days after a request closed
- **THEN** the request, its proposals, discussions, booking and delivery rows are gone and the host's calendar event is untouched

#### Scenario: Open request
- **WHEN** the pass runs while an old request is still awaiting approval
- **THEN** the request is kept

### Requirement: Deletion on request
An operator SHALL be able to delete a host's data or a single request's data on request, with the same explicit environment, reason, confirmation and audit as recovery. Host deletion SHALL remove the host's identity, Auth user, grants, settings, requests, channel bindings and agent grants, and SHALL keep only a suspended, nameless account record with its handle history so that no handle is ever assigned to another host. A deleted account SHALL NOT be restored.

#### Scenario: Deleted host signs in again
- **WHEN** the deleted host's Google account signs in later
- **THEN** a new empty host account is created and none of the deleted data is visible

#### Scenario: Handle of a deleted host
- **WHEN** another host asks for a handle the deleted host once held
- **THEN** the handle is refused as taken

#### Scenario: Restore after deletion
- **WHEN** an operator restores a deleted account
- **THEN** the restoration is refused

### Requirement: Backup restoration drill
The team SHALL be able to restore a logical backup into a separate database that no service uses, from a source holding synthetic data only, and verify that every table's rows, the migration history and every constraint match the source. The drill SHALL print counts and hashes only.

#### Scenario: Drill on the local stack
- **WHEN** the drill runs against the local stack
- **THEN** the restored database matches the source table by table and is dropped afterwards, and the local stack's own database is unchanged

### Requirement: Public data notice
A public page SHALL state, in English and Korean, what each audience's data is used for, which providers process it, how long it is kept, how to request deletion and whom to contact, including that the AI provider is called with storage off, does not train on the data and may keep abuse-monitoring logs, and that provider-side copies are outside the retention pass. The public entry, the public host page, the booking page and the requester's Google Calendar connection SHALL link to it.

#### Scenario: Requester before connecting Calendar
- **WHEN** a requester sees the Continue with Google card
- **THEN** a link to the notice's Calendar section is shown before any consent
