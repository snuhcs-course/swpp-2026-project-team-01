## MODIFIED Requirements

### Requirement: Contextual artifacts and actions
The website SHALL present draft changes, calendar choices, candidate times, current proposals, and decision status as reviewable artifacts in the relevant conversation. For guests, every card SHALL appear inside the conversation thread at the point it is needed and remain in its history; an answered card SHALL become the guest's own reply with its **Change** where changing is allowed. The guest's request summary, timezone, creation email line and privacy note SHALL be in a **Request details** panel that stays closed until the guest opens it. Available actions SHALL be labeled, keyboard-operable buttons adjacent to the artifact and SHALL invoke the authorized commands with current revisions. A guest MAY also make their own decisions in words, which the assistant records only through the same commands.

#### Scenario: Review a candidate
- **WHEN** a requester receives feasible candidate times
- **THEN** the times appear in a conversation artifact with a select action and enough date, time, timezone, and duration detail to identify the choice

#### Scenario: Confirm a proposal
- **WHEN** the exact current proposal awaits requester agreement or host approval
- **THEN** the appropriate audience sees its own explicit decision button beside that proposal, and the host's decision is never recorded from message text

#### Scenario: Stale artifact
- **WHEN** a decision artifact refers to a superseded revision
- **THEN** the action is unavailable or rejected, the current artifact is shown, and no stale decision is saved

#### Scenario: Guest identity in the thread
- **WHEN** a guest opens the web start
- **THEN** the identity card appears in the thread under the two fixed messages, and no identity form is shown elsewhere on the page

#### Scenario: Answered step in the thread
- **WHEN** a guest answers the Calendar step
- **THEN** the thread shows their answer as their own reply with **Change**, and **Request details** lists it
