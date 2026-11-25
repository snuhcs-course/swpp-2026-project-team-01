# Design

## Context

Change agreement increments the request revision and invalidates its current evaluation while immutable proposals and agreements remain. Booking change similarly reopens a standing event. Existing command outcomes are requester-scoped, retry-safe and retained for 30 days; actionable changes last at most seven days. See proposal.md for motivation.

## Goals / Non-Goals

Restore scheduling terms under the existing request lock while keeping immutable history and independent contact/notification choices. Calendar event cancellation is a separate operation and is not part of abandoning an edit.

## Decisions

- Save an additive scheduling rollback snapshot in requester-owned change command results. Reuse the existing command-outcome lifetime and deletion path instead of introducing a table or migration. Host-owned outcomes do not receive requester snapshots.
- Capture the original agreed proposal, scheduling details and expiry. A legacy outcome can use current details only when its saved revision still matches the request, proving there were no intervening detail updates.
- Cancelling a pending request creates a fresh immutable proposal and agreement with the original terms, advances the request revision, supersedes pending reviews, and returns to awaiting_host_approval. This makes stale host approvals fail without deleting history or rewinding revisions.
- Cancelling a standing booking uses the existing drop-change lifecycle and retains the provider event. Restore scheduling fields while preserving contact, notification preferences, language and exclusions.
- A newer agreement or host-shared change invalidates the rollback opportunity. Future-start, expiry, authority and expected-revision checks remain mandatory.
- The requester projection exposes rollback availability, not the stored snapshot. The new operation is exposed through the authenticated requester command route.

## Risks / Trade-offs

- Old edits with intervening updates lack a complete snapshot: do not offer unsafe restoration.
- Command outcomes expire: actionable change lifetime is shorter, and request closure guards still apply.
- Docker and the full local Supabase stack are unavailable: use an isolated PostgreSQL 17 instance with the actual relevant table definitions to verify SQL, transactions, lifecycle cleanup and the host projection. Stub notification transport only; report the full-stack coverage gap separately.

## Migration Plan

No schema migration. Deploy server and web together; existing result consumers tolerate additive fields. Removing the new UI/operation leaves the existing edit flow intact, with rollback snapshots eventually cleaned by existing retention.
