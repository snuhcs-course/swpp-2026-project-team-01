## MODIFIED Requirements

### Requirement: Bounded rejection observations
Explicitly enabled server collection SHALL record only fixed authorization-denial and stale-action categories for application commands that the command pipeline rejects in a recognized category: `unauthenticated` and `forbidden` as authorization denial, `stale_revision` and `request_closed` as stale action. It SHALL exclude caller/resource identities, the operation, input, credentials, raw errors and provider content. Counts SHALL use at most 24 hourly buckets per category and disclose saturation.

#### Scenario: Recognized rejection with private input
- **WHEN** a command is rejected in a recognized category
- **THEN** collection sends only the category and the stored observation contains no request or error content

#### Scenario: Concurrent or aged counters
- **WHEN** concurrent observations arrive or an observation follows expired buckets
- **THEN** accepted increments are atomic, out-of-window buckets are pruned on write, and counts remain bounded with saturation visible

## ADDED Requirements

### Requirement: Fixed snapshot categories
The snapshot SHALL report, in a fixed order, exhausted jobs, jobs running with an expired lease, jobs overdue by more than five minutes, bookings whose write may exist, bookings reserved for more than fifteen minutes, uncertain transactional emails, uncertain thread replies, uncertain or failed iMessage sends, failed conversation sessions, and conversation inputs unanswered ten minutes after acceptance. Each category SHALL carry its total count, its oldest timestamp and an identifier sample ordered by that timestamp and then the identifier.

#### Scenario: Empty category
- **WHEN** no record matches a category
- **THEN** the category reports a zero count with no oldest timestamp and no sample, and nothing labels the snapshot healthy

#### Scenario: Job outcome text
- **WHEN** an exhausted job holds an outcome or payload with private text
- **THEN** only the job's identifier, count and timestamp appear in the snapshot
