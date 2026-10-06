# Proposal

## Why

The operator invitation CLI currently creates a credential but does not deliver it. Invitations must use the selected Cloudflare sender, and the user selected the root domain `findmeatime.com` for outgoing mail.

## What Changes

- Remote invitation issuance sends the confirmed invitation through Cloudflare by default; local fixtures and an explicit manual-delivery option remain send-free.
- Persist private delivery evidence before sending, report rejection/uncertainty honestly, and never retry an uncertain invitation automatically.
- Configure authentication, invitations, and new transactional messages to use `no-reply@findmeatime.com`.
- Preserve AgentMail and frozen historical sender identities.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `email-delivery`: Explicit operator invitation delivery and selected sender domain.

## Impact

[Operator invitation CLI and setup guide](../../../../documentations/technical_specification/03_provider_setup.md#host-invitation-operations), sender environment, Cloudflare DNS, and Supabase Auth SMTP. [Existing email authority and delivery requirements](../../../specs/email-delivery/spec.md) remain in force. No schema, public issuance endpoint, or UI change is required.
