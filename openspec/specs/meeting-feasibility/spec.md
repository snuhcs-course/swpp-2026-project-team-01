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

### Requirement: Weekly meeting load preference
A confirmed weekly meeting limit SHALL be a host preference, not a hard constraint. The count for a week SHALL include confirmed bookings and the calendar events the host has not excluded as note-like, grouped by week in the host's timezone. When a candidate's week already holds the limit, candidates from weeks below the limit SHALL be offered first, and the host SHALL be able to waive the limit for one request through the existing private exception controls.

#### Scenario: Week at the limit
- **WHEN** the requested window spans a week that already holds the limit and a later week below it
- **THEN** candidates from the later week are offered first and requester output explains nothing about the limit

#### Scenario: Only full weeks
- **WHEN** every feasible candidate falls in a week at or above the limit
- **THEN** the host receives the private exception control and no candidate is offered until the host waives the limit or the requester widens the window

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

### Requirement: Route estimates, geography and freshness
Travel legs SHALL be estimated with Google Routes for the host's confirmed travel mode and the leg's departure time, wherever the provider returns a route; no country list SHALL limit evaluation. A leg SHALL be checked against the nearest host commitment before or after the candidate on the same local day, whatever the gap; a candidate in an overnight window belongs to the window's starting day through the window's end. An adjacent commitment with no location, only a conference link, or both a place and a conference link SHALL leave its leg unresolved. An estimate MAY be reused for 24 hours for the same endpoints, mode and 15-minute departure slot. Cleartext event locations SHALL NOT be stored with cached estimates.

#### Scenario: Mode without routes in a region
- **WHEN** the provider returns no route for the host's mode between two places
- **THEN** the leg is unresolved and the candidate is not offered to the requester

#### Scenario: Previous meeting was online
- **WHEN** the commitment before an in-person candidate has only a conference link
- **THEN** the inbound leg is unresolved rather than assumed to start at home or the office

#### Scenario: Cached estimate
- **WHEN** two evaluations within 24 hours need the same endpoints, mode and departure slot
- **THEN** the second uses the saved estimate, and a changed event location requires a new estimate

#### Scenario: Overnight candidate
- **WHEN** an in-person candidate at 01:00 in a window that started at 22:00 follows a host commitment that ended at 23:30
- **THEN** the inbound leg from that commitment is checked

#### Scenario: Distant commitment
- **WHEN** the nearest earlier commitment that day ended five hours before an in-person candidate
- **THEN** the inbound leg from that commitment is still checked

### Requirement: Manual travel allowance scope
A manual travel allowance SHALL cover one leg of one candidate: the party whose trip it is, the candidate's interval, the direction, the origin and destination and the travel mode, in 5-minute steps from 5 to 240 minutes. The host SHALL confirm allowances for host legs and the requester for their own legs. An allowance SHALL be applied together with that party's buffers, SHALL be void when the candidate's interval, either endpoint or the mode changes, SHALL NOT waive busy intervals or other hard constraints, and a host allowance SHALL NOT appear in requester output.

#### Scenario: Allowance resolves one leg
- **WHEN** the host confirms 40 minutes for the inbound trip of one candidate
- **THEN** that leg uses 40 minutes plus the buffers, and the same trip for another candidate stays unresolved

#### Scenario: Endpoint changes
- **WHEN** the adjacent event's location changes after an allowance was confirmed
- **THEN** the allowance no longer applies and the leg is unresolved again

### Requirement: Requester travel legs
When the requester connected Google Calendar and the meeting is in person, feasibility SHALL also check the requester's trip from their previous event and to their next event on the same local day in the requester's timezone, using the travel mode the requester chose, with the same unresolved rules as host legs and no host buffer. A requester leg that does not fit SHALL exclude the candidate. An unresolved requester leg SHALL keep the candidate from being offered until the requester confirms an allowance for it. Requester event details SHALL NOT appear in host or agent output.

#### Scenario: Requester cannot get there
- **WHEN** the requester's previous event ends at 14:00 at a place 50 minutes by public transit from the meeting, and a candidate starts at 14:30
- **THEN** the candidate is excluded and the host sees no reason that mentions the requester's event

#### Scenario: Requester leg unresolved
- **WHEN** the requester's next event has no location
- **THEN** the candidate is held back and the requester can allow minutes for that trip to have it offered

#### Scenario: No requester calendar
- **WHEN** the requester gave availability windows without connecting Google Calendar
- **THEN** no requester leg is checked

### Requirement: Bounded evaluations per request
Asking for times again while an evaluation of the same request and settings revisions is still running SHALL return that evaluation instead of starting another, whether the assistant or the **Find times** card asks. A request SHALL start at most 10 new evaluations in any rolling hour; past that, the service SHALL start none and SHALL return temporary-limit feedback.

#### Scenario: Eleventh evaluation in an hour
- **WHEN** a request that started 10 evaluations in the last hour asks for times again
- **THEN** no evaluation starts, no calendar or route is read, and the requester is told to try again later
