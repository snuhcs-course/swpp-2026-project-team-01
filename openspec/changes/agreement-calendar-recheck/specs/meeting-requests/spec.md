# Spec Delta

## ADDED Requirements

### Requirement: Agreement rechecks the host's calendars
Before recording requester agreement, the service SHALL read the host's conflict calendars again for the proposed interval under the same deterministic checks as booking revalidation, without the requester's calendar. An interval that no longer fits SHALL record no agreement and send the host no approval request, and the requester SHALL be told and offered newly evaluated times. A calendar read that fails or exceeds the evaluation deadline SHALL NOT block agreement; booking revalidation remains the check before any event is written.

#### Scenario: Host calendar changed after the times were found
- **WHEN** the requester agrees to a proposal whose interval became busy on the host's conflict calendars after its evaluation
- **THEN** no agreement is recorded, the host receives no approval request, the request stays negotiating, and a new evaluation becomes the current times

#### Scenario: Host calendar cannot be read
- **WHEN** the host's calendars cannot be read during agreement
- **THEN** agreement is recorded and the request awaits host approval, with booking revalidation still required before the event is created
