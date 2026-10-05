# Design

## Context

See proposal.md and `scripts/backend-contract.md`. P2 supplies ready hosts and optional request-scoped grants. P3 adds request state while P4 remains the only Calendar creation path.

## Goals / Non-Goals

**Goals:** one persisted lifecycle, version-bound decisions, explicit guest recovery, responsive shared web flows.

**Non-Goals:** P5 personal-agent adapters, P6 messaging intake, automatic post-booking changes, or guest accounts.

## Decisions

- Generate a 256-bit continuation token at creation; store only its hash and return it once. The browser keeps it out of ordinary query/logging paths and uses `X-Request-Token`. Bind to exactly one request and cap TTL at thirty days. Terminal state revokes mutation, OAuth, and recovery authority; the existing unexpired credential retains only minimal terminal status and confirmed-booking receipt reads, excluding private discussion and historical provider context.
- Verify original contact before issuing/rotating replacement guest credentials and invalidate previous authority. A submitted email or matching name is not verification. Intake may gather details before verified recovery exists, but attendee invitations require verified contacts.
- PostgreSQL locks current request state and checks expected revision/idempotency. Each material revision inserts immutable proposal details, advances version/revision, and invalidates old agreement/approval. Responses are projected for host or guest at the boundary; do not delete private keys after serializing a generic entity.
- Expire still-actionable requests at the earlier of seven days or the last requested window end. Booking uncertainty is never expired into false noncreation. Decline/withdraw/expiry are terminal; later contact starts a new or explicit refresh journey.
- AI uses OpenAI strict schema extraction over public requester context, English/Korean input, and explicit extracted-value confirmation. Deterministic validation checks dates, intervals, contact, length limits, and allowed fields. Stale results cannot commit.
- Web controls show proposal version, time in relevant timezone, duration, participants, mode/location, next action, and pending/error text. Use the requested shadcn preset with keyboard-accessible labeled controls and mobile layouts.

## Risks / Trade-offs

- [Guest credential loss] → Verified recovery and rotation; no identity-by-email lookup shortcut.
- [DTO optional private fields] → Explicit allowlisted audience projection with tests over messages, notes, exceptions, and errors.
- [Concurrent editing] → Expected revision and immutable proposal version guards with database race tests.

## Migration Plan

Add request, proposal, decision, guest credential, contact verification, and history desired SQL. Deploy read/create commands before web intake, then negotiation commands and expiry sweeps. Verify lifecycle fixtures and real browser continuation. P4 enables booking only after its own guards deploy.
