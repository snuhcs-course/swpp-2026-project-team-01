# Design

## Context

See [proposal.md](proposal.md). Request lifecycle supplies normalized details and revisions; Calendar grants supply authorized host event context and requester free/busy. Missing travel must remain unresolved.

Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md): root `agent/`, Next.js in `apps/web/`, shared contracts and authorized server operations in root `lib/`, and separately built eve/web services composed through root `vercel.ts`. The reconstruction target is `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`. Runtime and provider compatibility require fresh verification.

## Goals / Non-Goals

**Goals:** pure deterministic evaluation, two-leg travel, private explicit exceptions, reproducible versioned results.

**Non-Goals:** model-selected rule waivers, invented locations, zero-duration missing routes, or regional coverage claims from one fixture.

## Decisions

- Use half-open intervals over ISO instants; use IANA timezone rules for daily host availability and resolve DST ambiguity before converting input. Evaluate duration/windows first, then working hours/focus/busy/buffers and requester intersections.
- Fetch host events with the authorized context needed for neighboring physical locations; requester free/busy remains availability-only. Calendar failures return typed recovery rather than empty arrays. Model context never receives unnecessary private event descriptions or locations.
- For physical candidates, compute previous-event endpoint to meeting and meeting to next-event endpoint. Persist travel mode, departure context, locations/context fingerprints, timestamps, estimates, and explicit allowance source. Recompute before booking; cached estimates must match current context and bounded freshness.
- Google Routes adapter returns success, no-route, unsupported, or failure explicitly. A missing location or estimate creates a clarification. An authenticated host can confirm a manual allowance for one relevant leg/context; changing context invalidates it. Both legs add host margin and must fit.
- Split hard constraints from preferences. Exceptions are explicit current host decisions and remain private; they cannot waive busy/focus hard conflicts or final approval.
- Model structured ranking accepts only deterministic candidate IDs. Check response validity and freshness before saving candidates against expected request/rule versions. A model-generated interval never expands the candidate set.

## Risks / Trade-offs

- [Provider coverage/latency] → Typed unresolved results, deadlines, and manual-confirmation fallback; report tested modes/geographies.
- [Travel context changes] → Context fingerprint plus booking-time revalidation, not timestamps alone.
- [Calendar race] → Re-read near dispatch; external changes can still race after the final read and remain an operational limit.

## Migration Plan

Extend rules and candidate context desired SQL and command shapes. Add pure interval/travel tests and provider fixtures, then deployed evaluation without enabling writes. Booking reuses the exact evaluator; do not introduce separate booking feasibility logic.

## Interval implementation (2026-10-07)

The pure time-filtering stage now lives in `lib/server/scheduling/intervals.ts`, with strict snapshot contracts and a shared browser-safe local-time converter. It intersects continuous requester and host windows, subtracts both parties' busy intervals and host focus blocks, expands host busy/focus boundaries by the confirmed general buffer, and checks elapsed duration. General buffer, route duration and extra travel buffer remain separate. Weekly windows use actual local dates and reject ambiguous/nonexistent boundaries. Nanosecond comparisons avoid rounding away small overlaps. Explicit sampling spacing/caps affect presentation only; a shared exact-interval check remains available for later booking revalidation.

The [backend interval explanation](../../../documentations/technical_specification/01_backend_architecture.md#deterministic-interval-core) records tested boundary/DST examples and the required padded Calendar-read coverage. Provider acquisition, versioned persistence, preference/travel evaluation and proposal UI are still separate unfinished tasks. No time-only result may be presented as a fully feasible candidate.

## Authorized Calendar acquisition (2026-10-07)

`AvailabilityEvaluation` uses a private service-only request snapshot with current browser/guest authority, a superseding five-minute attempt ID and a fingerprint of request/rules, connection generations, selected calendars, requester mode and confirmed local bookings. It refreshes encrypted credentials with optimistic comparison, reads host ranges padded for general buffers, and reads the requester's separately authorized selected calendars only in Calendar mode. Every selected response must be complete; failures invalidate decisions and pause the affected availability. Explicit requester manual replacement does not clear host failures. Full successful reads reauthorize before clearing failure flags or returning the private time-only result.

The browser check exposes a minimal `complete: false` receipt. No time-only windows are persisted or offered as candidates. Task 1.3 still owns durable complete candidate context and stale saves; the travel/ranking tasks still own adjacent events, route context and complete feasibility. Local SQL/Auth/provider/browser fixtures are separate evidence from controlled live Google acceptance.

## Routes and two-leg core (2026-10-07)

The typed Routes adapter and pure adjacent-trip evaluator now preserve precise departure/mode/endpoint context, distinguish unavailable results from zero travel, and check each trip separately. General buffer precedes departure; extra travel buffer follows route duration. Transit timing includes waits and final walking. Past departure contexts require clarification rather than assuming a current host location. A five-minute freshness ceiling and complete-context fingerprint gate reuse; changed context recomputes both trips.

Controlled public-route probes returned transit only for the tested Seoul pair and all four modes for the tested New York pair; these are point-specific observations, not geographic guarantees. Task 2.1 is implemented. Task 2.2 still needs authorized adjacent-event acquisition and integration with actual request evaluation, despite passing pure-core tests. Full candidate persistence (1.3), private manual allowances (2.3/2.4), complete resolution flows and proposal integration remain open.

## Authorized exact-candidate travel (2026-10-07)

The request evaluator now composes interval checks, selected host event acquisition and both Routes trips under its existing authorization/freshness fence. It reads a bounded 31-day margin, conservatively retains unknown boundary context, reconciles unexplained free/busy, includes confirmed local bookings and focus blocks, and hashes minimized event versions with request/rule context. Empty coverage is not proof of a starting location. The browser still receives only `complete: false`; the private intermediate result is available for candidate persistence and later booking revalidation. This implements the acquisition/evaluation portion of task 2.2 without claiming that task 1.3 or proposal integration is complete.

## Private candidate persistence (2026-10-07)

Task 1.3 persists exact interval/time/travel evidence with request/rule versions and the private context used. The service-only ledger rechecks current authority, superseding attempt, expiry and all relevant local context after provider work. Immutable identical retries return one row; changed retries and stale reads/saves fail. Evidence includes sanitized route requests/results and server-derived private rules/context without provider credentials or raw Calendar responses.

The initial ledger explicitly records pending preferences and incomplete feasibility, and does not publish into legacy candidate/proposal state. Task 2.3 owns manual allowances and private exceptions; task 2.4 still needs their records. Tasks 3.1–3.3 must complete filtering/ranking, connect current complete evidence to proposals and reuse evaluation before booking.

## Explicit manual travel decisions (2026-10-07)

The browser-host service now confirms and revokes one private leg allowance against current persisted evidence. A positive duration, mode, explicit endpoint/time and private reason bind to the exact candidate and travel fingerprint. Future known boundaries/locations must match. Missing context is supplied explicitly; past prior departures require a current origin and new available time rather than reusing an old event location. Fresh evaluation applies both buffers and rejects insufficient gaps.

A service-only SQL ledger owns current host/session attribution, immutable confirmation/revocation retries and request invalidation. A stable content fingerprint excludes the confirmation's own revision increment; the ordinary asynchronous basis still fences revision changes. Calendar/context changes prevent reuse. Browser/guest responses contain no private leg details or reasons, and model tools cannot confirm. This advances task 2.3's manual-allowance portion and task 2.4's records; both tasks remain open for private preference exceptions. Task 3.2 owns host controls and complete request/proposal integration.

## Private preference decisions (2026-10-07)

Exact-candidate evaluation now checks configured meeting mode/location deterministically and leaves nonempty free-form preferences unresolved for explicit host review. The authenticated host classifies the item as a preference and either confirms free-form applicability or grants a named exception. Known mode/location mismatches require an exception. Hard constraints are not valid decision keys, and SQL refuses decisions against unresolved/conflicting interval or travel evidence.

The private decision ledger binds host/session, exact candidate, current details/rules and immutable retry identity. Changes and revocation invalidate applicability; guest/model projections expose neither private reasons nor exception authority. New candidate evidence carries preference checks and cannot report all checks passed while preferences remain unresolved. The record still grants no offer/proposal/booking authority. Tasks 2.3/2.4 are implemented at the backend boundary; task 3.2 retains host UI/publication, and task 3.3 retains booking revalidation. Provider coverage/manual-resolution documentation supports task 2.5 without claiming broader live coverage or full physical booking acceptance.

## Structured ranking implementation (2026-10-07)

The authorized evaluator can now sample a bounded batch under one current check and shared free/busy acquisition, preserving each exact interval's travel/preferences evidence. Explicit step/limit parameters and a truncation flag keep presentation sampling distinct from exhaustive feasibility. The private ranking service exposes only fully checked IDs, intervals and requester timezone to the direct OpenAI model; private rules/reasons and provider data are absent. A structured tool response must be an exact permutation, without invented intervals, omissions, duplicates or waivers.

A service-only immutable ordering ledger fences asynchronous persistence against current authority, rules, request revision, the complete evidence manifest and source expiry. Identical saves deduplicate; changed retries conflict, and current saved reads avoid model work. Empty sets require no model. Model refusal/failure/truncation does not advance state. This implements task 3.1's ranking and stale-save boundary; task 3.2 still owns browser controls and publication, and task 3.3 owns booking revalidation. No ranked record is itself a proposal or approval.

## Evidence-backed publication and decisions (2026-10-07)

A bounded evaluation now publishes only a rechecked persisted ranking, with shared candidate IDs/times and a private immutable publication/evidence link. Content fingerprints survive only the revision advances caused by publication and explicit selection/agreement themselves. Source expiry, superseding checks, changed request/rules/grants and stale asynchronous publication remain fenced. Selection creates a new immutable proposal and clears prior decisions; guest agreement is a separate explicit current-version action. Both roles read the same shared-safe state, and concurrent retries retain one outcome.

The old payload-trusting generic candidate/proposal/exception operations and their cached replays are denied. Existing history remains intact. Twelve candidates at fifteen-minute spacing are presentation bounds with explicit truncation, never an exhaustive feasibility rule. These APIs advance task 3.2, but its host exception UI and complete requester negotiation controls remain unfinished. Agreement cannot initiate booking; task 3.3 still owns shared evaluator revalidation before dispatch.
