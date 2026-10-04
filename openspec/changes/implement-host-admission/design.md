# Design

## Context

See proposal.md. P1 supplies service-only transactional commands; Supabase Auth supplies verified host sessions. The public requester boundary must remain independent of admission.

## Goals / Non-Goals

**Goals:** one admission guard across HTTP/database paths, atomic recipient-bound redemption, and resumable setup.

**Non-Goals:** public host signup, invitation delivery automation, agent OAuth consent, and requester signup.

## Decisions

- Normalize waitlist emails, enforce uniqueness, and return the same neutral pending response on retries. Limit payloads and rate-limit public intake instead of exposing applicant lookup.
- Restrict issuance/revocation to configured operator identities verified by the server. Generate 256-bit random invitation secrets, store hashes, and bind recipient email plus a seven-day expiry. Token possession alone is insufficient.
- Lock the invitation during redemption; check verified Supabase email, expiry, revocation, and consumption, then admit and audit atomically. Same-account retries return saved setup; mismatched accounts cannot alter consumption.
- Store host setup independently of invitation redemption so interrupted setup resumes. Require confirmed rules/timezone and verified conflict/booking selections for public readiness. Admission checks sit inside shared commands rather than only route middleware.
- Assign lowercase validated unique handles to stable host IDs. Initial handles are immutable, so a cached link cannot become another host's identity; later rename requires its own alias/tombstone policy.

## Risks / Trade-offs

- [Email claim mismatch or unverified account] → Server verification and invitation-bound checks; no client actor claims.
- [Concurrent redemption] → Row lock and consumption uniqueness tested in a real database.
- [Setup-only UI guard bypass] → Direct command tests reject unadmitted hosting operations.

## Migration Plan

Add waitlist, invitation, admission, setup, and audit desired SQL with explicit privileges. Generate/review pg-delta migration and rebuild local schema. Deploy commands before web setup controls, then test admitted and unadmitted users against actual routes. Roll back app code without rewriting consumed-invitation history.
