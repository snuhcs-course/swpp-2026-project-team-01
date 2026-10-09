# Proposal

## Why

Phase 9 of the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md) requires previews to avoid live mail/messages. Current delivery workers and provider transports rely on missing credentials and disabled schedules; copied credentials can enable actual sends.

## What Changes

- Reject messaging in Vercel preview/development/custom environments before delivery claims or provider calls, using server deployment metadata.
- Preserve saved dispatch identities and uncertainty; environment denial is configuration unavailability, never delivery evidence.
- Keep production and standalone local fixture behavior, document required system metadata and separate preview databases/credentials.

## Capabilities

### New Capabilities

- `messaging-environments`: Deployment environment admission for transactional and conversational messaging.

### Modified Capabilities

None. The existing [email delivery](../../specs/email-delivery/spec.md) authority and outcome contracts remain intact.

## Impact

Cloudflare, Photon and AgentMail delivery workers/transports, configuration helper, focused tests and provider setup. No schema migration, provider API change or new credential. Calendar writes, model calls, general database isolation and non-application Supabase SMTP are outside this bounded guard and remain separately configured release obligations.
