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
