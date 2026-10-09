# Spec Delta

## ADDED Requirements

### Requirement: Bounded rejection observations
Explicitly enabled server collection SHALL record only fixed authorization-denial and stale-action categories for recognized rejected database RPC attempts. It SHALL exclude caller/resource identities, input, credentials, raw errors and provider content. Counts SHALL use at most 24 hourly buckets per category and disclose saturation.

#### Scenario: Recognized rejection with private input
- **WHEN** a database RPC rejects an attempt in a recognized category
- **THEN** collection sends only the category and the stored observation contains no request or error content

#### Scenario: Concurrent or aged counters
- **WHEN** concurrent observations arrive or an observation follows expired buckets
- **THEN** accepted increments are atomic, out-of-window buckets are pruned on write, and counts remain bounded with saturation visible

### Requirement: Rejection collection preserves outcomes
Collection SHALL have an independent bounded wait, no retry and no recursion. Disabled collection, storage failure, timeout and unrecognized errors SHALL NOT change the original database result, error or domain state. Successful actions SHALL NOT be recorded as rejections.

#### Scenario: Telemetry unavailable
- **WHEN** collection fails or its deadline elapses after a rejected RPC
- **THEN** the caller receives the same original rejection without waiting indefinitely or performing another domain action

#### Scenario: Disabled or unrelated result
- **WHEN** collection is disabled or the RPC returns success or an unrecognized error
- **THEN** no rejection observation is sent

### Requirement: Truthful rejection inspection
An explicitly targeted server-authorized operator SHALL be able to inspect counts for the current and preceding 23 UTC hourly buckets without mutation. The result SHALL identify its best-effort database-only scope, missing pre-database/uncategorized coverage and partial current bucket. Empty or saturated counts SHALL NOT be presented as complete event rates, collection health or release readiness.

#### Scenario: Unauthorized or wrong-target inspection
- **WHEN** a browser/anonymous caller requests counts or the operator selects a mismatched project
- **THEN** inspection fails without revealing counters

#### Scenario: Partial observed activity
- **WHEN** the operator requests the rejection snapshot
- **THEN** fixed categories, bounded counts, observation/window timestamps and coverage limits are returned without changing counters or domain work
