# Proposal

## Why

The selected sender is Cloudflare Email Service. Authentication currently uses Supabase's default delivery and application notifications use AgentMail; conversational AgentMail support must remain available.

## What Changes

- Send new fixed-template verification, recovery, and booking messages through Cloudflare.
- Configure Supabase Auth to deliver through Cloudflare SMTP while retaining Supabase identity and sessions.
- Preserve AgentMail conversations and the immutable identity of already-dispatched AgentMail deliveries.
- Remove Resend as a proposed alternative from active product documentation.
- Stop automatic retries of uncertain Cloudflare sends because its API has no documented idempotency guarantee.

## Capabilities

### New Capabilities

- `email-delivery`: Provider separation, delivery evidence, and safe uncertain-send handling.

### Modified Capabilities

None. Existing [meeting request authority](../../../specs/meeting-requests/spec.md) and booking contracts are preserved.

## Impact

Email provider adapter, worker delivery handler, environment/deployment configuration, Auth SMTP setup, and [provider documentation](../../../../documentations/technical_specification/03_provider_setup.md). No new library or database migration is required. Cloudflare entitlement, sender-domain verification, and a scoped runtime token are live activation prerequisites; missing prerequisites must be reported rather than worked around with another sender.
