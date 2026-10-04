# Request and booking runtime

Date: 2026-10-05. This explains the P3/P4 implementation and its verification boundaries. The agreed [request lifecycle contract](../../openspec/specs/meeting-requests/spec.md) is backed by its [archived implementation record](../../openspec/changes/archive/2026-10-05-implement-request-lifecycle/proposal.md). Detailed feasibility and booking requirements remain in the pending OpenSpec changes: [feasibility](../../openspec/changes/evaluate-calendar-and-travel-feasibility/proposal.md) and [approved booking](../../openspec/changes/book-approved-proposals-reliably/proposal.md). See [backend runtime configuration](../../supabase/functions/README.md) and [host/Calendar setup](06_host_setup.md) for operations.

## Persisted requests and guest authority

PostgreSQL owns gathering, negotiating, awaiting approval, booking, and terminal states. An actionable request expires at the earlier of seven days from creation or its latest requested window end. The expiry sweep closes gathering/negotiating/awaiting-approval requests; it does not turn an uncertain booking into a claim of noncreation.

Mutations carry an expected revision and idempotency key. A matching retry returns its recorded outcome after current access checks; stale revisions and changed input under a reused key fail. Proposals are immutable snapshots. Changed meeting details, physical context, or applicable rules require reevaluation and invalidate the relevant current decisions. Requester agreement and host approval identify the exact current proposal.

Guest continuation is request-bound and stored only as a SHA-256 hash. The API derives high-entropy retry-stable tokens using the persisted encryption/HMAC key, so retrying creation can return the same authority without storing its plaintext. Credentials have a maximum thirty-day lifetime; closure revokes mutation and Google-consent authority. A matching unexpired old credential can still read a **minimal terminal receipt**: status and, when booked, shared meeting/event details. It cannot retrieve private history, contact/purpose fields, candidate lists, or regain scheduling permissions.

Contact verification and recovery use 256-bit challenge tokens with fifteen-minute expiry. Initiation returns pending status rather than disclosing a code or proving email ownership. Verification requires the current protected request/revision and matching contact; recovery requires the delivered one-time challenge and rotates continuation authority. Submitted email text and provider delivery success alone do not verify contact. Web links carry verification/recovery secrets in fragments, which the app removes after reading.

## Deterministic feasibility and private context

The evaluator uses UTC instants and IANA timezone rules. It checks the whole buffered interval against working hours, focus blocks, host events, requester windows/busy intervals, and duration. Ambiguous/nonexistent local times and invalid offsets fail closed. Optional connected requester reads remain mandatory once selected; a failed read is not free availability.

Physical evaluation checks both neighboring travel legs with departure context and host margins. The host may privately record physical whereabouts, including where an online commitment takes place. A confirmed manual allowance is specific to one before/after leg and its exact slot, rules version, adjacent event/context, endpoints, and departure/arrival timing. Changing that context invalidates the allowance. Multiple conflicting matches require a fresh confirmation. A manual allowance does not waive busy/focus/working-hour conflicts, required buffers, requester agreement, or final approval.

Private notes, physical context, allowances, diagnostic reasons, and travel checks remain in host projections. Public candidates contain start/end values. Host preference text remains private soft input; it cannot authorize a hard-rule waiver. The implemented host-only preference exception records explicit confirmation and a reason against the exact proposal details/version and current rules version. It disappears from the current projection when either changes. Recording an exception neither approves a meeting nor bypasses deterministic constraints.

The captured public Seoul City Hall → Seoul Station probe returned no DRIVE/WALK routes and a TRANSIT estimate of 512 seconds over 1,562 metres. This establishes that fixture's result only. Missing routes/locations or provider failures remain unresolved, requiring clarification or a specifically confirmed allowance; no missing estimate becomes zero travel. [Captured provider evidence](../../scripts/p0/probe-results-2026-10-05.json).

Provider calls share a single **18-second deadline** per evaluation, including OAuth refresh, Calendar reads, Routes, and optional ranking. Ranking also has a **6-second cap**, within the remaining global budget. The runtime Routes adapter permits at most twelve external requests per evaluation; exhausted budget yields unresolved travel rather than a zero estimate. These limits bound provider work, rather than promising an eighteen-second database/HTTP response. Ranking returns only a complete permutation of already feasible candidate IDs; malformed/refused/unavailable output preserves deterministic order. Saving candidates checks the current request revision and rules version.

The database caps model claims at eight per request. Extraction receives bounded requester fields, validates a strict JSON shape, and treats English/Korean messages as untrusted data. Refusals, malformed output, and unavailable model access preserve explicit form-based continuation. Model output supplies suggestions, never agreement, human approval, private-data authority, or Calendar commands.

## Approval, frozen dispatch, and reconciliation

Host approval is a separate authenticated web action. The HTTP adapter supplies server-attributed confirmation source; SQL requires that source, explicit confirmation, owning host, current revision/proposal, requester agreement, and verified contact. Google consent and agent permission do not supply meeting approval.

Booking owns one durable identity per request and immutable attempt snapshots containing the selected calendar, provider-valid event ID, proposal association, and approved payload fingerprint. The database checks worker identity/lease and acquires a per-host reservation before dispatch. Revalidation must freshly check current credentials, destination, decisions, rules, calendars, requester availability, and both trips through the same feasibility evaluator.

The attempt also freezes its Google connection ID and provider subject. Revalidation captures the current credential metadata timestamp; dispatch compares both that timestamp and subject under database locks, so replacing credentials behind the same connection ID cannot silently reuse an earlier feasibility check. Refresh updates use compare-and-swap against the expected credential timestamp and subject, then reread the encrypted bundle and metadata together. Reconciliation uses the frozen connection/subject and event identity even when newer scheduling rules would prevent a fresh insertion.

Confirmed local booking receipts supplement provider reads for subsequent feasibility checks. The trusted SQL projection filters by owning host, selected conflict/booking calendars, requested window range, and a different request identity. It retains the explicit meeting mode from the confirmed proposal. The merge deduplicates a matching calendar/event/interval, preserves conservative busy evidence if provider times differ, and gives online commitments no inferred physical location. Receipts neither replace failed required Calendar reads nor expose host booking data to guests.

After possible dispatch, crashes, timeouts, lost successful responses, or duplicate-ID responses are resolved against the **saved calendar/event identity**. No replacement ID or payload is generated. An immediate not-found observation or expired worker lease does not prove noncreation and does not release the reservation. Matching provider evidence includes association, details, attendees, times/timezones, and noncancelled status; a matching ID alone is insufficient.

Audited `booking_reconcile` work observes the saved attempt. `booking_retry` rechecks proof of noncreation and current prerequisites; it cannot blindly retry an uncertain provider write. Operators cannot manufacture approval/booked status or clear uncertainty by freeing its reservation. Withdrawal before booking prevents dispatch; after a write may have begun, the outcome stays pending rather than falsely claiming prevention. Confirmed events are not automatically deleted as compensation.

An exhausted `prepared` attempt can be retired only when it has no dispatch timestamp or provider evidence and no pending or currently leased booking/reconciliation job. Retirement marks that attempt blocked and releases its reservation atomically. A withdrawn/closed/expired request retires without recreation; an expired booking request also closes and revokes guest authority. Changed proposal, revision, rules, calendar, contact, or connection prerequisites retire the attempt and return the request to negotiation for a fresh review. Only unchanged current decisions and recorded human approval permit preparation of another attempt. The audit records retirement/retry; the durable request event identity remains stable. A live job or uncertain/dispatched write is not eligible for this recovery path.

Confirmation commits booked state, reservation release, and audience-safe outbox work atomically. Delivery has its own frozen encrypted recipient/body/inbox evidence and retry identity. Failed notification delivery preserves booked state and cannot create another event. AgentMail retries stop before its twenty-four-hour idempotency horizon; uncertain sends remain visible after that limit.

The two email switches serve distinct operations:

| Runtime setting | Enabled action |
|---|---|
| `TRANSACTIONAL_EMAIL_ENABLED=true` | User-requested contact verification/recovery messages |
| `EXTERNAL_SENDS_ENABLED=true` | Booking confirmation delivery |

Both default false. Switching off a delivery that may already have dispatched preserves uncertainty. Missing delivery configuration never becomes fabricated sent status. This fixed-template delivery adapter does not implement the P6 conversational email/iMessage channels.

## Verification and local integration

The latest P3/P4 verification includes **101 backend Deno tests** and **291 SQL assertions**, including **102 booking assertions**, after resetting the complete generated migration chain locally. The earlier P3 snapshot passed 46 backend tests, 21 scheduling tests, and 189 SQL assertions. Real local P3 RPC integration passed request creation, evaluation/ranking, proposal selection, agreement, private preference exceptions, guest projection privacy, stale revision rejection/exception invalidation, and withdrawal. These are separate verification surfaces, not deployed browser/provider compatibility or a claim that every pending requirement is complete.

P3 commit `87d2659` was deployed from a frozen snapshot to [findmeatime.com](https://findmeatime.com), with Vercel deployment `dpl_F6BT1GRE1JwppQnpPz5LzLVoCT3P`. Production checks returned HTTP 200 for API health and worker status, 401 for unauthenticated requests, and 400 for a Google callback missing its binding. The actual production browser displayed the landing page and Google login control without browser errors; no sign-in or Calendar consent occurred. [GitHub Actions run 37241253688](https://github.com/snuhcs-course/swpp-2026-project-team-01/actions/runs/37241253688) passed the clean Linux application checks, all 189 database checks, and the real local RPC runner. This confirms the deployed P3 snapshot and those boundaries, not a live Calendar booking or authenticated approval journey.

The opt-in [booking integration script](../../scripts/tests/booking-integration.ts) exercises real service-only SQL commands and the durable booking handler against an otherwise idle local stack. Google insert/lookup and delivery are injected fixtures. Its host actor is synthetic trusted service input, so it does not test browser authentication or human Google consent. The test intentionally simulates a successful write with a lost response, immediate not-found, reconciliation, lease fencing, duplicate delivery, and notification failure while checking one saved event identity.

The latest actual local run passed on request `c7368cae-ca2d-4003-95ac-a0253f519c93`: one simulated provider insertion, reconciliation of that identity, booked receipt, and separate delivery failure that preserved booking. Runtime coverage included the actual encrypted grant path, Calendar destination/conflict roles, metadata fences, and trusted receipt overlay. Injected provider evidence is not a live Google event.

Run only against the disposable local stack; the status file contains local secrets and belongs in the ignored `.local/` directory:

```sh
mkdir -p .local
supabase status --output json > .local/supabase-status.json
chmod 600 .local/supabase-status.json
FMAT_LOCAL_INTEGRATION=1 deno run \
  --allow-env=FMAT_LOCAL_INTEGRATION,FMAT_LOCAL_SUPABASE_URL,FMAT_LOCAL_SERVICE_ROLE_KEY,FMAT_LOCAL_STATUS_FILE \
  --allow-read=.local \
  --allow-net=127.0.0.1:54321,localhost:54321 \
  scripts/tests/booking-integration.ts
```

The script rejects endpoints other than local HTTP port 54321, sends no external messages, and creates no live Calendar event. It does not reset/delete the database; controlled records remain for inspection. Do not substitute the production `.env` or broaden its network permissions.

## Operator recovery

The [booking administration command](../../scripts/manage-bookings.mjs) calls the actual service-only `booking_reconcile` or `booking_retry` RPC with an explicit operator audit identity and request UUID:

```sh
node scripts/manage-bookings.mjs reconcile --local --operator-id local-test --request-id UUID
node scripts/manage-bookings.mjs retry --local --operator-id local-test --request-id UUID
```

For an identified linked remote project, use `node --env-file=.env scripts/manage-bookings.mjs reconcile --project-ref REF --operator-id OPERATOR --request-id UUID` (or `retry`). The explicit ref must match `SUPABASE_PROJECT_REF`, the exact HTTPS `SUPABASE_URL`, and the CLI linked-project cache. A server-only secret/service-role key is required; publishable, anon, and user keys are rejected. Local mode obtains credentials internally from `supabase status` and accepts only local HTTP port 54321. The operator ID records who invoked the privileged command; it does not replace authentication or authorize public access.

Output is an allowlisted acknowledgement, not proof that a Calendar event exists or a worker has finished. The command exposes no credentials/provider payload, offers no manual status override, and makes no automatic retry after a timeout or unreadable response. An unknown RPC outcome requires inspection of the operator audit before repeating. Database guards decide whether reconciliation/retry is admissible.

Actual CLI/RPC verification passed on controlled local request `36de7ed3-227d-47a0-beca-679e48c2824d`: a live prepared job rejected retry with `JOB_STILL_ACTIVE`; a conclusively blocked undispatched attempt allowed retry; a synthetic dispatched/uncertain attempt rejected retry with `BOOKING_UNCERTAIN`; reconciliation of that saved attempt was accepted. The guest receipt remained pending booking with no fabricated event. The fixture used synthetic trusted host/worker actors and real service-only SQL commands, no direct status override, Google transport, or external message. Syntax/help, thirteen mocked argument/target/key/operation/output checks, and documentation links also passed.

Still pending: actual authenticated browser approval journey, and controlled live Calendar consent/refresh/create/lost-response reconciliation. A local RPC integration result can prove local transactions and recovery behavior with injected providers; it cannot satisfy the live Calendar M2 gate.

## P4 deployment evidence

Commit `86296d1` was deployed from a frozen snapshot to the identified Supabase project `anelszynxtvxoxqvzgqt`; migration `20261004225750_approved_booking.sql` was previewed, applied, and followed by API/worker deployment. Vercel production deployment `dpl_6ahRhaReQPAegQXCtrm2kmjK4FyS` serves [findmeatime.com](https://findmeatime.com), with Cloudflare remaining authoritative DNS.

Production verification returned website/API health 200, unknown-host 404, unauthenticated request/worker 401, and unbound Google callback 400. Recurring Cron processed persisted ping job `1fe69546-fcfc-4398-9a2f-2b933b12576d` in one attempt at `2026-10-04 23:08:00.961225 UTC`, without an immediate worker invocation. Worker/recovery/expiry/credential-cleanup schedules remain active. This proves deployed database/runtime wiring; the ping creates no Calendar event or message.

[GitHub Actions run 37242545049](https://github.com/snuhcs-course/swpp-2026-project-team-01/actions/runs/37242545049) passed clean Linux application installation/typecheck/lint/101 Deno tests/build, complete local reset/291 SQL checks, and both request and booking RPC runners. Live Google consent, refresh and controlled Calendar M2 remain open; deployment does not mark those tests passed.
