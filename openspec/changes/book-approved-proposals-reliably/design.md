# Design

## Context

See [proposal.md](proposal.md). Durable jobs, current proposals, agreement, rules and deterministic evaluation are prerequisites to the first event-creation path.

Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md): root `agent/`, Next.js in `apps/web/`, shared contracts and authorized server operations in root `lib/`, and separately built eve/web services composed through root `vercel.ts`. The reconstruction target is `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`. Runtime and provider compatibility require fresh verification.

## Goals / Non-Goals

**Goals:** one recoverable write identity, attributable approval, durable reservations, provider-evidenced completion, independent delivery recovery.

**Non-Goals:** automatic compensation deletes, post-booking rescheduling, client-generated approval, and delivery adapters owned by the channel/delivery slices.

## Decisions

- Host approval is an authenticated web mutation with explicit confirmation of displayed current details, proposalVersion, and expectedRevision. Derive trusted host identity and confirmation source server-side; do not trust arbitrary adapter fields. Store attributable evidence separately from requester agreement.
- Booking preparation takes host reservation then request locks in one consistent order. Check current guards and persist one booking identity per request, attempt, frozen destination, stable provider-valid ID, and payload before dispatch. Use lowercase hex without hyphens (within Google's base32hex character rules).
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
