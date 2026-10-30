## ADDED Requirements

### Requirement: Soft guest preferences from a host profile
When a guest opted in to Preferences from their host profile, candidate ordering SHALL place candidates inside the guest's weekly hours first and then candidates from weeks below the guest's weekly limit, after the host's own ordering keys. These preferences SHALL NOT remove a candidate, gate evaluation, add buffers or open an exception control, and SHALL NOT change the host's rules or the guest's stated windows. Their explanations SHALL appear only in the guest's view.

#### Scenario: Outside usual hours
- **WHEN** the only feasible candidates fall outside the guest's weekly hours
- **THEN** they are still offered

#### Scenario: Order inside usual hours first
- **WHEN** feasible candidates fall both inside and outside the guest's weekly hours in the same week
- **THEN** the ones inside are offered first and the host's view does not mention the guest's hours
