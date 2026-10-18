# Design

## Context

See the proposal. All three conversation channels call the same durable message acceptance function. Current authority locks precede scope locking; one pending input per scope and a 200-message lifetime cap already exist. Eve has session token caps but direct-provider cost metadata is not an enforced service spend budget.

## Decisions

Use one private bounded counter row per host/request plus one service row, with independent minute/hour windows. Lock service then principal after existing authority/scope locks. There is no network I/O inside the transaction. Recheck current authority after quota locks before inserting input. A rejected transaction rolls back both counter increments. This avoids transcript scanning and prevents rotation of a browser credential, audience or channel from granting a new allowance. Fixed windows permit a boundary burst; these are not rolling-window promises.

Charge only new accepted inputs. Reads, settlement, delivery, replay and invalid input do not charge. Keep token and lifetime limits independent. No automatic model-budget override or new session is created when throttled.

Photon returns its existing busy outcome after moving the pending job one minute forward. Requester email releases its lease to pending, delays one minute and reverses the claim attempt increment. Both retain prepared input, ordering and original authority expiry. Existing schedulers retry; a quota delay never extends a credential. Web uses a distinct CONVERSATION_RATE_LIMIT error with HTTP 429 and the existing retained-message retry UI.

## Risks / Trade-offs

- Service counter contention → short transactions without external I/O; verify concurrent ceilings and expiry after observed lock waits.
- Fixed-window bursts → documented exact semantics and independent hourly caps.
- Hourly throttling outlasts a channel credential → current authority rejection wins; no expiry extension.
- Admission counts do not measure token cost, ranking calls or tool infrastructure → retain remaining Phase 9 spend-budget gate.
- Counter rows outlive principals → they contain only opaque IDs, timestamps and counts; general retention/deletion remains a separate gate.

## Migration and rollout

Generate an additive pg-delta migration and validate clean local rebuild, SQL, concurrent acceptance and both channel paths. Deploy application error support and then the reviewed database migration to the identified release project. Use rollback-only production quota probes with no external deliveries. A rollback requires a new migration restoring prior function bodies; preserve counters and applied migration history.
