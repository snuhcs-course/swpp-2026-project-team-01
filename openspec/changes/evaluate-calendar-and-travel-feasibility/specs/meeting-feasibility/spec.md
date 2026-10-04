# Spec Delta

## Purpose

Offer only deterministically feasible candidates and keep uncertainty, private host constraints, and asynchronous interpretation from silently authorizing scheduling.

## ADDED Requirements

### Requirement: Deterministic interval feasibility
Candidates SHALL fit requester date windows, duration, timezone, host working hours, focus rules, busy calendars, buffers, and explicitly supplied or authorized requester availability.

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
