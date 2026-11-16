## MODIFIED Requirements

### Requirement: Requester travel legs
When the requester connected Google Calendar and the meeting is in person, feasibility SHALL also check the requester's trip from their previous event and to their next event on the same local day in the requester's timezone, using the travel mode the requester named or, when they named none, public transit, with the same unresolved rules as host legs and no host buffer. A missing requester travel mode SHALL NOT by itself leave a requester leg unresolved. A requester leg that does not fit SHALL exclude the candidate. An unresolved requester leg SHALL keep the candidate from being offered until the requester confirms an allowance for it. Requester event details SHALL NOT appear in host or agent output.

#### Scenario: Requester cannot get there
- **WHEN** the requester's previous event ends at 14:00 at a place 50 minutes by public transit from the meeting, and a candidate starts at 14:30
- **THEN** the candidate is excluded and the host sees no reason that mentions the requester's event

#### Scenario: Requester named no travel mode
- **WHEN** the requester connected Google Calendar, named no travel mode, and has an event at a known place before an in-person candidate
- **THEN** that trip is estimated by public transit and the candidate is offered or excluded by the estimate, not held back

#### Scenario: Requester named a travel mode
- **WHEN** the requester said they will drive
- **THEN** their trips are estimated by driving

#### Scenario: Requester leg unresolved
- **WHEN** the requester's next event has no location
- **THEN** the candidate is held back and the requester can allow minutes for that trip to have it offered

#### Scenario: No requester calendar
- **WHEN** the requester gave availability windows without connecting Google Calendar
- **THEN** no requester leg is checked
