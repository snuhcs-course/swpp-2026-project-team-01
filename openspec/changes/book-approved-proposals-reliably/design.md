# Design

## Context

See [proposal.md](proposal.md). Durable jobs, current proposals, agreement, rules and deterministic evaluation are prerequisites to the first event-creation path.

Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md): root `agent/`, Next.js in `apps/web/`, shared contracts and authorized server operations in root `lib/`, and separately built eve/web services composed through root `vercel.ts`. The reconstruction target is `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`. Runtime and provider compatibility require fresh verification.

## Goals / Non-Goals

**Goals:** one recoverable write identity, attributable approval, durable reservations, provider-evidenced completion, independent delivery recovery.

**Non-Goals:** automatic compensation deletes, post-booking rescheduling, client-generated approval, and delivery adapters owned by the channel/delivery slices.

## Decisions

- Host approval is an authenticated web mutation with explicit confirmation of displayed current details, proposalVersion, and expectedRevision. Derive trusted host identity and confirmation source server-side; do not trust arbitrary adapter fields. Store attributable evidence separately from requester agreement.
- Replacement booking evaluation takes the job lease, request, host, Auth account, Calendar connections, attempt and reservation locks in that order. Request-before-host matches the existing browser evaluation/approval/consent paths and avoids introducing a reservation-before-request inversion. Retained commands and operator recovery also acquire the request and host before attempts/reservations. Check current guards and persist one booking identity per request, attempt, frozen destination, stable provider-valid ID, and payload before dispatch. Use lowercase hex without hyphens (within Google's base32hex character rules).
- Final revalidation re-reads grants/calendars, rules, requester availability, and travel using the shared feasibility evaluator, then fenced database dispatch records the exact attempt. Provider calls happen outside transactions. Only conclusively noncreating attempts permit a new creation attempt.
- Insert with the persisted ID and `sendUpdates=all` for verified attendees, using the confirmed host-supplied HTTPS online link. Retrieve the exact calendar/event ID after any possible-dispatch timeout/crash. Verify association, payload/details, and noncancelled status; duplicate-ID response alone is insufficient.
- Preserve host reservation while uncertain even if worker lease expires. Recovery owner may change, but identity/payload cannot. Not-found is an observation, not proof that an earlier write cannot still complete. Use bounded reconciliation and operational escalation rather than blind replacement.
- Confirm booking, release reservation, and create participant-specific outbox records in one transaction. Outbound work carries its own identity and status. Unavailable channel adapters remain pending/unsupported; host/guest web status and Google attendee delivery remain visible.
- Audited operator actions permit reconnect, reconcile, and retry conclusively failed attempts under current guards. They cannot override approval, forge booked state, or release an uncertain reservation merely to clear backlog.

## Risks / Trade-offs

- [No distributed transaction with Google] → Persist-before-dispatch, stable ID, reconciliation, and explicit uncertainty; final-read external races still exist.
- [Reservation blocks later work] → Visible pending reason and bounded operational recovery; freeing it without evidence would risk overlap.
- [Browser approval falsely attributed to agent] → Separate human web confirmation from client/model operations and exercise direct bypass tests.
- [Delivery provider unavailable] → Keep booking independent and record actual delivery status; do not fabricate sent outcomes.

## Migration Plan

Add approval evidence, booking attempts, reservations, and confirmation records to desired SQL; generate/review migrations and rebuild local schema. Deploy read/reconciliation paths and run fault fixtures before enabling inserts. Run one controlled live Calendar booking case with lost-response recovery evidence. Roll back application versions without erasing uncertain attempts or deleting created events.

## Browser approval adapter

The current browser RPC derives its host/session attribution from verified Auth credentials, accepts only the exact request revision/proposal/confirmation/retry identity, and checks the current proposal evidence context plus requester agreement and verified contact. An immutable web decision supplements historical approvals. It atomically queues the existing saved booking attempt, while provider success remains a separate worker responsibility. Read-only pending status and exact retry recovery stay available without granting transcript or provider authority. The UI displays the exact proposal in a separate confirmation card and treats unknown responses as status-recovery work.


## Lease-authorized booking evaluation

`fmat_booking_evaluation` is a service-only entrypoint for a current booking-job lease. It calls the same private evaluator as the browser RPC while deriving worker authority from persisted job/attempt/approval records. Browser credentials remain required on the browser path; the worker does not impersonate a host or depend on the approving browser session remaining live. Current host admission/account, request authority, agreement, saved web approval, rule/grant/destination/proposal context and reservation are still required.

`booking_checks` binds each fresh evaluation to an attempt, job, lease token and check ID. The server reads the Calendar catalog and verifies the explicit frozen destination is writable before recording its check time and reading busy intervals. A new lease must start a new check. Only the frozen candidate can be assessed. Shared token refresh, interval, travel and preference logic persists private evidence; revoked authority or changed context during network reads cannot save stale results. A definitive pre-dispatch read failure blocks that prepared attempt, releases its reservation and clears obsolete proposal decisions. This path cannot evaluate dispatched/uncertain attempts; reconciliation must preserve their identity and reservation.

Fresh evaluation supplies lease-bound evidence to the dispatch cutoff. The worker below composes evaluation, dispatch and recovery; an evaluation receipt alone does not authorize Calendar insertion.


## Saved-evidence dispatch cutoff

The dedicated dispatch RPC rechecks current booking authority/context and consumes the exact lease/check/basis-bound candidate evidence. Both the evidence and writable-destination check have a 30-second dispatch freshness limit. The attempt, job, lease token, check and evaluation are recorded in immutable `booking_dispatches` before the frozen attempt becomes dispatched. Exactly one transaction returns a positive dispatch receipt; replay or another owner cannot receive a second insertion grant. A lost response requires lookup of the saved event identity. The generic feasibility-boolean dispatch path is denied for rebuilt web approvals. This gate remains separate from provider execution, reconciliation and completion.


## Bounded worker execution

The authenticated internal route claims one web-approved job and executes the shared evaluator, current host credential access, dispatch gate and frozen transport. Recovery of any dispatched/uncertain/conflicting attempt performs lookup only. Atomic outcome persistence acknowledges the lease with booked state, reservation release and audience-separated outbox records; expiry rolls back all local completion changes. Original-dispatch ownership is required for definitive noncreation. Operator recovery obtains the host lock before attempts/reservations, matching worker order. A real blocked-lock regression checks that an operator waiting for the host has not locked the attempt.

The private minute scheduler reads a separately provisioned booking URL and existing dispatch secret from Vault. It is inert without configuration and wakes only eligible due work. Unknown lookup results keep reservations through bounded reconciliation; conflicts and exhausted jobs require audited recovery. Delivery execution, complete operator retry coverage and controlled live provider acceptance remain open.


## Protected receipt projection

The receipt read locks the request before current host authority or guest token checks. Closed-state guest authority is limited to the receipt until the token expires; rotation denies the old token. Projection requires matching confirmed attempt/provider/request event association and reads immutable payload/proposal details rather than mutable request drafts. It excludes all private scheduling evidence and transcript data, returning only the viewing audience's email status. A shared host/requester card refreshes status, distinguishes uncertainty from confirmation, clears details on denial, and permits HTTPS join links without URL credentials. Calendar links are restricted to the saved Google Calendar destination. Full delivery and actual organizer presentation remain task 3.2.


## Transactional booking email

Persist a separate encrypted message and receipt-token hash per participant outbox record. Freeze the Cloudflare account, fixed service sender, recipient, subject, HTML and plain text before a fenced dispatch. Recheck the confirmed snapshot and recipient authority while holding request/host locks. A changed prepared basis suppresses the message. Only the transaction that first persists dispatch returns permission to send; a lost acknowledgement never grants a second send. A duplicate job defers while the original sender lease is live, then preserves uncertainty if acceptance cannot be established. Email outcomes never update booking state or enqueue Calendar work.

Use the organizer returned in matching Google event evidence; never substitute the host's primary address or the service sender. HTML and text share the frozen meeting fields. Host View booking links retain the single `/app` workspace and select the request; requester links open the canonical booking route with an independent receipt-only fragment token. The receipt credential is bound to the current parent token, verified recipient and original expiry, and cannot authorize chat, scheduling changes or provider consent.

The private delivery scheduler requires its own Vault URL and the existing dispatch secret. Deployment acceptance must inspect pending work before activation, verify private-route guards, and distinguish synthetic transport evidence from real inbox receipt.


## Closure competing with dispatch

Retire the earlier blanket prohibition on closing a prepared booking. The request lock is the serialization boundary: closure takes request, host and attempt locks, confirms there is no possible dispatch, blocks prepared work and releases its reservation atomically with the closure record. It deliberately takes no job lock, because dispatch owns the job before waiting for the request. Workers acknowledge blocked attempts without provider access. Host/guest authority is rechecked after waits.

If dispatch wins, closure preserves the saved event identity and reservation and reports pending reconciliation. Missing/inconsistent booking evidence remains conservative. The UI relies on server `canWithdraw`/`canDecline` flags rather than treating every booking status as nonclosable; same-input recovery survives a still-prepared booking response. Deterministic integration races exercise both lock orders and withdrawal during provider reads.


## Operator command adapter and approval continuity

The service-key CLI pins an explicit Supabase project and permits only retry/reconcile with an operator audit identity and stable command UUID. Lost responses replay the existing database command; success acknowledges recovery scheduling, not Calendar creation. Host reconnection remains an authenticated consent action. No browser or model tool receives operator authority.

Retry can advance a request revision while retaining the immutable human approval for the unchanged proposal. Final evaluation checks the attempt against the current request revision, the approval decision against its original approved revision, current agreement/approval versions, and current proposal context. It does not require a recovery revision to equal the historical approval revision and does not manufacture a new decision. All normal feasibility and dispatch checks still apply.


## Retained worker lock ordering

The retained `fmat.booking_command` worker branches also acquire the host before the attempt and reservation, matching the current worker and evaluator. A four-connection regression holds the host, observes the worker waiting, and proves the attempt remains available with `FOR UPDATE NOWAIT`. Load, dispatch and outcome branches reject the lease after it expires during the wait; no dispatch or outcome is committed. This closes the retained host/attempt ordering gap without changing human approval or provider evidence requirements. The overlapping-request integration holds the first provider response pending, proves the second request cannot steal the reservation, then verifies its next evaluation rejects the confirmed overlap even while the provider read remains empty. Stable identity, immutable snapshot, duplicate approval and fenced-owner assertions complete task 1.2.


## Booking revalidation acceptance

A worker-level matrix creates each proposal through the actual publication, requester agreement and authenticated host approval services before changing the final prerequisite. It covers host/requester busy intervals and revoked grants, changed rules/approval/destination, missing/read-only booking calendars, fresh travel conflict/unavailability, and revocation/rule changes during external reads. Each negative leaves a blocked attempt, no dispatch receipt, no reservation, no insert and no confirmation outbox. Successful requester-Calendar and in-person controls each confirm one event. Both route legs use current adjacent events and fresh estimates; requester reads use their own read-only credential. Catalog-read failures may already block the attempt inside evaluation; the worker acknowledges that terminal job without claiming a booked result. These controlled provider fixtures complete task 2.1, not live Calendar acceptance.
