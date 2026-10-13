# Tasks

Tasks describe replacement implementation and verification; completion is tracked below and in the implementation evidence ledger.


## 1. Approval and booking identities

- [x] 1.1 Add attributable explicit authenticated web approval for exact current version/revision and separate requester agreement records; verify stale approval, changed details, arbitrary client confirmation, and concurrent decisions.
- [x] 1.2 Add one durable booking identity per request, immutable attempts, provider-valid stable IDs, consistent host/request lock ordering, reservations, and fenced ownership; verify uniqueness and competing host requests.
- [x] 1.3 Add desired SQL and reviewed migration for decisions/attempts/reservations/outbox; verify local reset, service-only guards, atomic publication, and preserved uncertain records.
- [x] 1.4 Document approval evidence and dispatch cutoff in owning technical/setup documentation; verify UI communicates pending booking and no client/model field is accepted as human evidence.

## 2. Revalidated dispatch and reconciliation

- [x] 2.1 Re-read required grants/calendars/rules/requester availability/travel and current decisions before frozen dispatch; verify changed availability, revoked credentials, changed rules, stale approval, and wrong destination block creation.
- [x] 2.1a Restore final booking checks over selected conflict calendars plus a distinct frozen booking destination. Verify destination-only busy/travel evidence, provider failure, deduplication and maximum calendar selection without changing ordinary selection; deploy the correction.
- [x] 2.2 Implement Calendar insert using exact saved ID/calendar/payload and verified attendee `sendUpdates=all`; verify host-supplied HTTPS links, no automatic destination fallback, and no requester grant writes.
- [x] 2.3 Implement uncertain-write reconciliation with association/payload/noncancelled validation; verify lost successful response, immediate not-found, duplicate-ID mismatch, post-dispatch termination, and expired ownership never create a replacement.
- [x] 2.4 Implement definitive failure and audited reconnect/reconcile/retry operations; verify current prerequisites are rechecked and operators cannot forge approval/booked outcomes or release unresolved reservations.
- [x] 2.5 Document recovery actions and limits; verify an operator can recover controlled fixtures without manual state-forcing or compensating event deletion.

## 3. Completion and notification isolation

- [x] 3.1 Commit provider-evidenced booked state, reservation release, and separate audience-safe confirmation records atomically; verify repeated completion, mismatched event evidence, and rollback boundaries.
- [x] 3.2 Implement independent delivery status/retry records and web confirmation visibility; verify notification failure preserves booked status, retries create no event, recipients are rechecked, and unavailable channel adapters are not marked sent.
- [x] 3.3 Add fault-injection integration tests for duplicate delivery, every pre/post-dispatch termination boundary, withdrawal races, lost wake-ups, and competing reservations; verify at most one confirmed event identity.
- [ ] 3.4 Run controlled live Calendar booking case with host/user consent and lost-response recovery, and document deployment evidence; verify one actual matching event and honest separation of live versus mocked results.
