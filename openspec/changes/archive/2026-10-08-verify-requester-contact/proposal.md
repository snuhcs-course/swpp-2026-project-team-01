# Proposal

## Why

The requester can supply an address but cannot yet prove control of it in the rebuilt browser flow. Booking correctly requires verified contact, so this missing step blocks the complete account-free journey.

## What Changes

- Add explicit request-scoped email-code verification with expiry, attempt limits, resend cooldown and immutable command replay.
- Send through the selected Cloudflare transactional transport with durable, fenced dispatch and honest uncertain/failed delivery states.
- Add a protected requester card and preserve separate Google-only host login, request authority and participant agreement.
- Deny legacy contact-verification mutations that bypass the bounded adapter.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: bounded proof of the current requester's contact address before trusted attendee use.

## Impact

Desired SQL/migrations, service-only verification/delivery operations, browser routes/card, scheduler and tests. Follows [PRD](../../../../documentations/02_product_requirements.md), [meeting requests](../../../specs/meeting-requests/spec.md) and [email delivery](../../../specs/email-delivery/spec.md).

Credential recovery, optional requester Google identity and AgentMail conversations remain separately tracked obligations in the full implementation plan. Verification proves the current address only; it does not issue account sessions or replacement request credentials. No unresolved product decision is promoted by this change. Operational defaults (six-digit code, ten-minute expiry, five attempts, one-minute resend cooldown and five sends per request per hour) are recorded in design and verified by tests.
