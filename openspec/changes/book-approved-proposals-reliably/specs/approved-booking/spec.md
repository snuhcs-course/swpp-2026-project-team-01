# Spec Delta

## Purpose

Create an approved current proposal through one durable booking identity and resolve uncertain provider writes without claiming unverified success or duplicating events.

## ADDED Requirements

### Requirement: Attributable current approval
Booking SHALL require requester agreement and an explicit authenticated human host web confirmation for the current proposal and revision. OAuth grants, client permissions, model text, and superseded decisions SHALL not qualify as approval.

#### Scenario: Stale approval
- **WHEN** the host confirms a proposal after its material details change
- **THEN** approval is rejected and no booking work is authorized

#### Scenario: Model supplies confirmation
- **WHEN** model or arbitrary client input claims host approval without the attributable web action
- **THEN** it creates no approval or Calendar write

### Requirement: One guarded booking identity
Each request SHALL have one durable booking identity with immutable dispatched attempts. Competing jobs SHALL use fenced ownership and per-host reservations so overlapping application bookings cannot dispatch concurrently.

#### Scenario: Duplicate queue delivery
- **WHEN** two workers receive the same booking work
- **THEN** at most one current owner dispatches the saved attempt and repeated delivery preserves the same identity

#### Scenario: Competing host requests
- **WHEN** two approved requests need the same host interval
- **THEN** reservation and revalidation prevent both from dispatching as available

### Requirement: Revalidate before dispatch
Before dispatch, booking SHALL recheck current decisions, lifecycle, calendars, requester availability, host rules, and travel. It SHALL write only the frozen payload to the selected writable host booking calendar.

#### Scenario: Availability changed
- **WHEN** requester or host availability conflicts during final revalidation
- **THEN** dispatch is blocked and the request returns to a visible revision/recovery action

#### Scenario: Wrong calendar destination
- **WHEN** the selected booking calendar is absent or no longer writable
- **THEN** booking requires reconnection or selection recovery and does not silently write to another calendar

#### Scenario: Booking destination differs from conflict calendars
- **WHEN** the frozen booking destination is not among the selected conflict calendars
- **THEN** final booking checks read both the selected conflict calendars and that destination for busy time and applicable adjacent travel context, and a failed destination read cannot authorize dispatch

### Requirement: Uncertain writes retain identity and reservation
A timeout, crash after possible dispatch, or lost provider response SHALL leave booking pending and preserve the attempted calendar/event/payload and reservation. Lease expiry or immediate not-found SHALL not justify a replacement write.

#### Scenario: Successful insert response lost
- **WHEN** Google creates the saved event but the response is lost
- **THEN** the service stays pending and reconciles that event identity without creating a replacement

#### Scenario: Immediate not-found after timeout
- **WHEN** a lookup immediately after an uncertain insert does not find the event
- **THEN** uncertainty and reservation remain until evidence proves the prior write resolved or could not create

### Requirement: Provider-evidenced booking completion
Booked status SHALL require verified provider evidence matching the saved request, calendar, event identity, noncancelled state, and dispatched details. Duplicate-ID responses alone SHALL not establish success.

#### Scenario: Foreign event uses expected ID
- **WHEN** lookup finds an event whose request association or details do not match the attempt
- **THEN** the service reports an operational conflict and does not mark the request booked

#### Scenario: Reconciled success
- **WHEN** lookup verifies the matching noncancelled event after a lost response
- **THEN** booking commits once, releases its reservation, and records confirmation work atomically

### Requirement: Audited recovery preserves prerequisites
Recovery SHALL distinguish definitive noncreation from uncertainty and recheck all current prerequisites before a new creation attempt. Operators SHALL not fabricate approval or booked status to clear work.

#### Scenario: Definitive rejection and retry
- **WHEN** a conclusively noncreating attempt fails and an operator resumes it after credential recovery
- **THEN** a creation attempt occurs only after current agreement, approval, and feasibility checks

### Requirement: Honest withdrawal cutoff
Withdrawal before booking SHALL prevent dispatch. After a write may have begun, the service SHALL report pending outcome without claiming prevention or automatically deleting a confirmed event.

#### Scenario: Withdrawal races with uncertain dispatch
- **WHEN** withdrawal arrives after the frozen attempt may have reached Google
- **THEN** reconciliation continues and no fabricated withdrawn-success outcome or compensating event deletion occurs
