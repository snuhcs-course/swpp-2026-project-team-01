# Design

## Context

See [proposal](proposal.md). Existing generic lifecycle SQL has historical contact recovery branches, but the rebuilt adapters do not expose them. Current contact verification and delivery use separate fenced, service-only RPCs. Recovery must use the same durable boundaries without requiring the lost credential.

## Goals / Non-Goals

Recover one known request through its previously verified current email. Do not discover requests by email, create Supabase sessions, or change meeting decisions. Initial email intake remains owned by the email continuity phase.

## Decisions

- Entry uses the existing booking page and request ID. This preserves the one-request destination and works without a separate recovery navigation surface.
- New private recovery records bind the current token hash, verified email, client retry UUID, random 256-bit link proof and expiry. Only a hash authorizes redemption; encrypted proof exists solely for durable delivery. Generic acceptance covers absent/ineligible/rate-limited requests. A resend invalidates earlier pending links, and a request trigger permanently invalidates proofs after relevant authority/contact changes.
- Redemption receives a high-entropy proof, not an email claim. The server derives the replacement credential through a domain-separated HMAC of that proof, request ID and challenge ID. Exact retries after a lost response therefore reproduce the same token; SQL only accepts replay while that new hash remains current. Neither secret is returned by SQL. Encryption-key rotation invalidates pending exact replay and requires a fresh recovery challenge.
- Row locks serialize issuance and redemption. Request time checks use wall-clock time after locking. Rotation increments request revision and writes one history/audit entry; existing credential-bound grants and email links then fail or revoke. The redemption transaction marks its own challenge redeemed before rotating, and invalidates all other pending proofs.
- Delivery uses a distinct outbox/job kind and Cloudflare worker with frozen content and current-contact/proof rechecks before dispatch. A possibly accepted send never retries automatically. No public browser route is enabled until issuance abuse controls and delivery are present.
- Browser exchange removes fragment secrets before network work, uses same-origin mutations and strict inputs, and installs the existing guest cookie only after successful redemption. Explicit redemption prevents passive link scanners from rotating authority. No secret goes to model tools or browser persistence.

## Risks / Trade-offs

- Stolen recovery links are bearer authority → fifteen-minute expiry, one-request binding, explicit exchange and permanent invalidation.
- Public endpoint can solicit email → per-request cooldown/hourly cap plus browser/global abuse controls before exposure; generic response never promises delivery.
- Contacts that were never verified cannot recover → explain the prerequisite without revealing a request's stored contact.
- Delivery may be uncertain → retain the outcome privately and permit a deliberate fresh link after cooldown.

## Migration Plan

Add the private schema and service adapter first, without exposing a public endpoint. Generate and review the additive pg-delta migration, rebuild locally and test isolation/concurrency/replay/expiry. Deploy and verify a rollback-only remote fixture. Then implement fenced delivery and browser controls, followed by controlled live acceptance. Do not remove migration history on rollback; disable public routing while preserving recovery audit records.
