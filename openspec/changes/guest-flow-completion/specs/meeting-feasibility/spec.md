## MODIFIED Requirements

### Requirement: Deterministic interval feasibility
Candidates SHALL fit requester date windows, duration, timezone, host working hours, focus rules, busy calendars, buffers, and explicitly supplied or authorized requester availability. Without requester windows, candidates SHALL come from the next two weeks within the host's working hours, spread so each day's first start comes before any day's second, and that search SHALL NOT be ranked by a model. A request's excluded times, starting with the time the host declined, SHALL be excluded from its revised request's searches without any reason. A time the guest names that lies wholly inside them SHALL be refused when the assistant drafts it, with an authored answer that the time no longer works for the host and no reason.

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

#### Scenario: No windows from the guest
- **WHEN** a guest gives no preferred times
- **THEN** candidates cover the next two weeks within the host's hours, across several days

#### Scenario: Revised request after a decline
- **WHEN** the host declined a proposed time and the guest's next message starts a revised request
- **THEN** the revised request offers no candidate at the declined time

#### Scenario: Guest names an excluded time
- **WHEN** the guest of the revised request asks for the declined time again
- **THEN** the assistant's draft of that time is refused before any search, and the guest hears that it no longer works for the host, with no reason

