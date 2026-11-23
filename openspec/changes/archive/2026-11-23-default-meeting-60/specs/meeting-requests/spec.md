## ADDED Requirements

### Requirement: One default meeting length
The service SHALL use one default meeting length of 60 minutes wherever no one has given a length: the host setup starter default for meeting length, the host's offer shown to a guest when the host's settings hold no length, the tutorial's sample request, and the starting value of the host's change form when neither the current proposal nor the request has a length. A length the host saved, a length inferred from the host's calendars, and a length a guest or host stated SHALL take precedence over the default, and the default SHALL NOT rewrite a host's confirmed settings.

#### Scenario: Starter default for a sparse calendar
- **WHEN** a host's calendar scan counted fewer than 5 meetings
- **THEN** the meeting length suggestion is 60 minutes, labeled as a starter default

#### Scenario: Saved length kept
- **WHEN** a host confirmed a 30-minute meeting length before the default changed
- **THEN** their requests and offer keep 30 minutes

#### Scenario: Sample request
- **WHEN** the host accepts the request-review tutorial
- **THEN** the sample request asks for a 60-minute meeting
