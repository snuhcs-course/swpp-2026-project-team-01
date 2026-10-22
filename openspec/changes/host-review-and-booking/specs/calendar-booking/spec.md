## Purpose

Turn a requester's agreement and the host's explicit approval of the same current proposal into exactly one Google Calendar event, owned by the host's booking destination, after a fresh feasibility check, while keeping every uncertain outcome truthful and recoverable.

## ADDED Requirements

### Requirement: Attributable approval of the current proposal
Host approval SHALL be recorded only by an explicit host command naming the exact current proposal version, by the request's own active host, while the request awaits host approval, the version carries the requester's agreement and its start is still in the future. Approval SHALL record the host, the version, the request revision and the command's retry identity. A repeated approval of the same version SHALL return the existing booking rather than create another. Message text, an agent's claim or a requester action SHALL NOT approve.

#### Scenario: Approval of a superseded version
- **WHEN** the host approves a version after a newer version replaced it
- **THEN** the approval is rejected with the current status and no booking is reserved

#### Scenario: Two approvals arrive together
- **WHEN** a mobile approval and a repeated approval with a different retry identity arrive for the same version
- **THEN** both observe the same single booking and at most one event is created

#### Scenario: Approval without agreement
- **WHEN** the host tries to approve a version the requester has not agreed to
- **THEN** the approval is rejected and the request stays as it was

### Requirement: Reserved booking with revalidation before dispatch
Approval SHALL atomically reserve a booking that records its identity, the destination calendar, the provider event identity derived from the booking identity and the proposal interval with the host's buffers, and SHALL publish the durable booking job. Immediately before dispatch the job SHALL recheck, under a per-host lock, that the request is still being booked and unexpired, that the approval and agreement still name the current version, that the host is active, and that the interval is still feasible under the shared evaluation deadline with route estimates no older than one hour and the host's other in-flight and confirmed bookings counted as busy. A failed recheck SHALL dispatch nothing.

#### Scenario: New busy event before booking
- **WHEN** a busy event overlapping the approved interval appears in the host's conflict calendars before dispatch
- **THEN** no event is created, the booking fails as a conflict, the approval is spent and the request returns to negotiating for another time

#### Scenario: Two requests compete for one slot
- **WHEN** two approved bookings for the same host overlap
- **THEN** the job dispatches at most one of them, and the other fails its recheck as a conflict

#### Scenario: Revalidation exhausts its deadline
- **WHEN** the recheck reaches the evaluation deadline
- **THEN** no event is created by that recheck, the approval is spent and the host can approve again

### Requirement: Host-owned event with stable identity
The event SHALL be created with the host's own Calendar grant in the host's confirmed booking destination, with the requester as the only attendee, Google's own invitation sent to attendees, and the destination's default reminders. Its provider event identity SHALL be fixed and stored before dispatch, so a repeated create cannot produce a second event. The organizer shown to either party SHALL be the organizer Google reports for the event. The shared description SHALL contain the meeting details and any join link and SHALL NOT contain the booking link, host notes, rules or exception reasons.

#### Scenario: Insert repeated after a lost response
- **WHEN** an event insert is repeated after the first one succeeded but its response was lost
- **THEN** Google refuses the duplicate identity, the existing event is read and confirmed, and only one event exists

#### Scenario: Online meeting with Google Meet
- **WHEN** an approved online proposal's link plan is Google Meet
- **THEN** the event is created with a Meet conference and the join link Google returns appears in the receipt and the confirmation

### Requirement: Reconciled uncertain writes
Once a dispatch is committed, the booking SHALL keep its reservation and SHALL be reported as booking in progress until reconciliation reads the event by its identity. A found event SHALL be confirmed; an absent one SHALL be created again only with the same frozen payload and identity; feasibility SHALL NOT be rechecked after dispatch. Retry exhaustion SHALL leave the booking visibly in progress, and an explicit status check SHALL start another reconciliation.

#### Scenario: Calendar response lost
- **WHEN** an event insert times out after Google created the event
- **THEN** a later attempt finds the event by its identity and confirms it without a second insert

#### Scenario: Insert never arrived
- **WHEN** reconciliation finds no event with the booking's identity
- **THEN** the same frozen payload is inserted under the same identity

#### Scenario: Retries exhausted
- **WHEN** reconciliation still cannot reach Google after its last attempt
- **THEN** both parties see that booking is in progress, with no confirmed receipt, and **Check booking status** starts another reconciliation

### Requirement: Definitive failure and retry
A definitive provider rejection or a revoked Calendar grant during dispatch SHALL fail the booking with its category, spend the approval and return the request to awaiting host approval. A retry SHALL be a new host approval, which revalidates agreement, approval and feasibility from the start.

#### Scenario: Calendar access revoked
- **WHEN** the host's Calendar grant is revoked before dispatch
- **THEN** the booking fails as revoked access, the host sees a reconnection and retry action, and no event exists

### Requirement: Withdrawal and decline before dispatch evidence
Requester withdrawal and host decline SHALL cancel a reserved booking and close the request only while no dispatch has been committed. After a dispatch commits, both SHALL be refused with the pending outcome and SHALL NOT claim that event creation was prevented.

#### Scenario: Withdrawal wins the race
- **WHEN** withdrawal commits before the booking job commits its dispatch
- **THEN** the booking is cancelled, no event is created and the request is withdrawn

#### Scenario: Withdrawal after dispatch
- **WHEN** withdrawal is attempted after the dispatch committed
- **THEN** it is refused, and the requester sees that booking is in progress and its outcome will follow

### Requirement: Booking receipt
A confirmed booking SHALL produce a receipt built only from its confirmed provider evidence and frozen payload: title, start and end with duration and the viewer's timezone named, organizer and requester, the place or **Join meeting**. The requester SHALL see it at the booking link, also after closure while the link is valid; the host SHALL see it on the request in `/app`. No receipt or join action SHALL appear before confirmation. **Check booking status** SHALL refresh the state for either party.

#### Scenario: Requester opens the booking link after booking
- **WHEN** the requester opens a valid booking link of a booked request
- **THEN** only the status and the receipt are shown, with no conversation, and no command is accepted

#### Scenario: Booking still in progress
- **WHEN** either party opens the request while its booking is reserved or dispatching
- **THEN** it shows booking in progress with no join link or confirmed receipt
