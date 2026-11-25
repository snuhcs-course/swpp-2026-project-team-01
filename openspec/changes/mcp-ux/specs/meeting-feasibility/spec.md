## ADDED Requirements

### Requirement: Week schedule precedence
Candidate evaluation, fixed-interval booking revalidation and open-time preview SHALL resolve hours in the host timezone using the dated week replacement first, then alternate-week windows on every second week from their anchor, then the base weekly windows. Negative offsets from the anchor SHALL use the same alternating cycle. Overnight windows SHALL belong to their start date's week and use the existing DST rules. Busy time and buffers SHALL remain enforced.

#### Scenario: Closed replacement week
- **WHEN** a week replacement has no windows
- **THEN** that week starts no available windows even if base or alternate-week rules are open

#### Scenario: Anchor crosses a year boundary
- **WHEN** the evaluated week is two weeks before or after the alternate anchor
- **THEN** the alternate windows apply consistently across the year boundary
