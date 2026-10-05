# Design

## Context

See proposal.md. Existing outbox records freeze encrypted content and `providerInboxId` before a network write. AgentMail provides a 24-hour idempotency window; Cloudflare documents no equivalent.

## Goals / Non-Goals

Use Cloudflare for transactional delivery and Auth SMTP, retaining AgentMail for conversations. Preserve request authority, booking isolation, and local email capture. Do not migrate inboxes, purchase plans, send unsolicited tests, or substitute a new authentication system.

## Decisions

- Call Cloudflare's REST API directly from the Deno worker, with a scoped Email Sending token and explicit account/from configuration. No SDK dependency or Worker bridge is needed.
- Freeze the Cloudflare account and sender in a tagged `cloudflare:account:from` identity in the existing provider identity field. Legacy untagged inbox identities remain AgentMail; never move an existing send between providers.
- A persisted Cloudflare dispatch marker forbids automatic redispatch, even if a crash happened before the actual network request. This prefers a visible uncertain delivery over duplicate authority-bearing mail. Operator reconciliation is required; a correlation header does not provide idempotency.
- Require affirmative recipient acceptance and a provider message ID. HTTP success alone, suppression, or bounce does not prove a send.
- Supabase continues issuing and validating login links. Configure custom SMTP at `smtp.mx.cloudflare.net:465`, username `api_token`, password from the scoped Cloudflare token. Keep the local capture service as the development default and supply a checked setup helper for remote Auth.

## Risks / Trade-offs

- Cloudflare sending is beta and requires account entitlement and verified sender DNS → validate prerequisites and report activation separately from local test results.
- A crash before transmission may strand a record → preserve uncertainty, without automatic replay or provider fallback.
- Historical AgentMail sends must finish against their original identity → keep the legacy sender and retry horizon.

## Migration Plan

Verify sending entitlement and domain DNS, provision a scoped runtime token, deploy the changed worker with Cloudflare configuration, and update the identified Supabase project's SMTP settings. Preserve unrelated DNS and AgentMail credentials. Read back settings before claiming activation. If activation is unavailable, finish local implementation and record the specific blocker. Roll back by disabling new delivery; do not run an old worker against Cloudflare-tagged outbox records.
