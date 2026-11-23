# Spec Delta

## ADDED Requirements

### Requirement: Same-day trip preference
A host MAY confirm in setup a preference to group trips by day; it SHALL be off by default and on every policy confirmed before it existed, and it SHALL be a preference, never a hard constraint. With it on, for an in-person meeting whose place the host's travel mode puts beyond 30 minutes of the host's preferred area, candidates on days that already hold a timed in-person commitment within 15 minutes of the meeting place SHALL come first, and candidates on days whose in-person commitments all lie within 15 minutes of the preferred area SHALL come last. Distances SHALL come from the same route estimates and cache as the travel check, not straight-line distance. The preference SHALL order candidates after the weekly meeting load preference and before requester preferences and the spread across days, SHALL never remove a candidate, and SHALL leave the order unchanged for online meetings, an unknown meeting place, a per-trip travel mode, or missing estimates. The host's private explanation MAY say the host is already near the meeting place that day; requester output SHALL contain only the times.

#### Scenario: Already out that way
- **WHEN** the policy is on, the meeting place is far from the preferred area, and one day holds an in-person commitment near the meeting place
- **THEN** that day's candidates are offered before other days' and the host's explanation says they are already near the meeting place that day

#### Scenario: A day in the preferred area
- **WHEN** the policy is on, the meeting place is far, and one day's in-person commitments are all near the preferred area
- **THEN** that day's candidates come after every other day's, and no candidate is removed

#### Scenario: Weekly limit still wins
- **WHEN** the day with a nearby commitment falls in a week at the weekly limit and another week is below it
- **THEN** candidates from the week below the limit come first

#### Scenario: Online meeting
- **WHEN** the meeting is online
- **THEN** the order is the same as with the policy off

#### Scenario: Requester view
- **WHEN** a candidate is ranked by the preference
- **THEN** the requester's projection contains no basis, place or explanation of the rank
