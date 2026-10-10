# meeting-feasibility Specification

## Purpose

Offer only deterministically feasible candidates and keep uncertainty, private host constraints, and asynchronous interpretation from silently authorizing scheduling.

## Requirements

### Requirement: Deterministic interval feasibility
Candidates SHALL fit requester date windows, duration, timezone, host working hours, focus rules, busy calendars, buffers, and explicitly supplied or authorized requester availability.

#### Scenario: Proposal starts before requester agreement
- **WHEN** the selected proposal reaches its start time before a new agreement commits, including during a database lock wait
- **THEN** the service rejects agreement without advancing the request or recording a decision, and browser and agent reads disable agreement
- **AND** an exact retry of an already committed decision returns current state without another mutation or erasing the historical agreement

#### Scenario: Busy requester
- **WHEN** the connected requester has a busy interval overlapping a candidate
- **THEN** the candidate is excluded without disclosing private requester events

#### Scenario: Host focus block
- **WHEN** an otherwise free candidate overlaps a host focus block
- **THEN** it is excluded under the current hard rules

### Requirement: Timezone-safe instants
The service SHALL represent proposal times as unambiguous instants with display timezone and clarify ambiguous or nonexistent local inputs across daylight-saving transitions.

#### Scenario: Different daylight-saving offsets
- **WHEN** parties view a candidate in different timezones across a daylight-saving boundary
- **THEN** both displays identify the same start/end instants and duration

#### Scenario: Ambiguous local input
- **WHEN** intake names a local time that occurs twice or does not exist
- **THEN** the service requests clarification before selecting an instant

### Requirement: Both adjacent travel legs
Physical meeting feasibility SHALL check previous commitment to candidate and candidate to next commitment using authorized locations, mode, departure context, estimated travel, and host buffers. Both legs SHALL fit their available gaps.

#### Scenario: Outbound trip cannot fit
- **WHEN** the previous trip fits but travel to the next commitment plus buffer exceeds its gap
- **THEN** the candidate is excluded

#### Scenario: Inbound trip cannot fit
- **WHEN** travel from the previous commitment plus buffer exceeds its gap
- **THEN** the candidate is excluded even if the meeting interval is free

### Requirement: Travel uncertainty requires resolution
Unknown locations, unsupported routes, provider failures, and stale travel context SHALL remain unresolved until clarified or replaced by a specific host-confirmed manual allowance. Missing estimates SHALL never be zero travel.

#### Scenario: Routes returns no route
- **WHEN** the provider returns no route for the requested geography and mode
- **THEN** the candidate requires clarification or explicit manual allowance and is not automatically feasible

#### Scenario: Manual allowance confirmed
- **WHEN** the host explicitly confirms an allowance for the relevant leg and context
- **THEN** feasibility applies that allowance plus current buffers without exposing its private reasoning

### Requirement: Private explicit preference exceptions
Preference exceptions SHALL require an explicit host decision, remain bound to applicable details/rules, and remain host-private. Exceptions SHALL not waive hard conflicts or final host approval.

#### Scenario: No preference match
- **WHEN** no candidate satisfies a private preference
- **THEN** the host receives private exception/revision controls and requester output omits rule or exception reasoning

### Requirement: Versioned asynchronous results
Calendar, travel, and model results SHALL carry relevant request/rule context and SHALL be discarded or recomputed when that context changes before persistence. AI SHALL only rank candidates that pass deterministic checks.

#### Scenario: Rules change during evaluation
- **WHEN** rules or request details change while an evaluation is running
- **THEN** its stale candidates cannot replace the current result

#### Scenario: Model suggests hard conflict
- **WHEN** ranking output selects an interval with a deterministic conflict
- **THEN** that interval is rejected and no proposal is authorized from it

### Requirement: Shared evaluation deadline
A scheduling evaluation SHALL share one 18-second elapsed-time budget across credential refresh, Calendar reads, travel and optional ranking. Pagination, additional candidates and parties SHALL NOT reset it. On expiry the service SHALL stop waiting, cancel active provider work and prevent new provider requests or publication from that evaluation. Narrower operation limits SHALL still apply.

#### Scenario: Later page exhausts remaining time
- **WHEN** a Calendar page stalls after earlier work consumed part of the evaluation budget
- **THEN** its active request and response-body read are cancelled at the original deadline
- **AND** no later page, party, candidate or ranking request starts

#### Scenario: Provider ignores cancellation
- **WHEN** a provider completes after the shared deadline or never settles
- **THEN** the service returns a sanitized incomplete evaluation without waiting indefinitely
- **AND** late completion cannot save evidence, publish candidates or start booking

#### Scenario: Ranking has less time remaining
- **WHEN** ranking begins with less time remaining than its own model timeout
- **THEN** the original evaluation deadline still applies and incomplete ranking is not published

### Requirement: Deadline uncertainty preserves durable state
An expired evaluation SHALL NOT turn failed reads into availability or zero travel, release an uncertain booking, or claim an in-flight command was rolled back. Already committed authorized effects SHALL retain their existing retry and recovery identities. Further evidence, publication and booking dispatch from the expired evaluation SHALL be denied.

#### Scenario: Expiry during booking revalidation
- **WHEN** booking revalidation exhausts the evaluation budget
- **THEN** no new Calendar insertion is authorized by that incomplete evaluation
- **AND** any existing dispatched attempt remains subject to same-event reconciliation

#### Scenario: Command started before expiry
- **WHEN** an authorized command was already sent before the deadline and its reply is lost or late
- **THEN** the service retains uncertainty and uses the existing durable read/retry protocol
- **AND** it does not claim cancellation undid the command

### Requirement: Overnight weekly host hours
A host weekly availability window SHALL start on each selected weekday in the host timezone. An end clock earlier than its start SHALL mean the following local date; equal clocks SHALL be rejected. Candidate evaluation SHALL include the preceding day's applicable overnight tail without changing existing full-interval, busy, focus or buffer checks.

#### Scenario: Request only names the following morning
- **WHEN** Monday availability is 22:00–02:00 and a request names Tuesday 01:00–01:30
- **THEN** the entire candidate is inside that Monday window, subject to all other constraints
- **AND** Wednesday 01:00 is not included unless Tuesday was also selected

#### Scenario: Week and timezone boundary
- **WHEN** an overnight Saturday window ends Sunday in the host timezone while the requester is on a different date
- **THEN** the starting Saturday owns the complete window and both parties refer to the same instants

#### Scenario: Invalid equal clocks
- **WHEN** a draft supplies identical start and end clocks
- **THEN** the system rejects it without treating it as all-day availability or altering confirmed settings

### Requirement: Overnight clock changes and review
Overnight boundaries SHALL use actual local calendar dates and timezone rules. An ambiguous or nonexistent boundary SHALL require clarification rather than a guessed instant. Host editing and review SHALL clearly identify next-day ends, and saving SHALL retain explicit confirmation requirements.

#### Scenario: Daylight-saving transition
- **WHEN** an overnight window crosses a clock change with unambiguous boundaries
- **THEN** feasibility uses actual elapsed duration, including the shorter or longer night
- **AND** an ambiguous or nonexistent end boundary yields no actionable candidate for that unresolved window

#### Scenario: Review next-day hours
- **WHEN** a host edits or reviews 22:00–02:00
- **THEN** the display identifies 02:00 as next day and does not save the draft without the existing explicit confirmation
