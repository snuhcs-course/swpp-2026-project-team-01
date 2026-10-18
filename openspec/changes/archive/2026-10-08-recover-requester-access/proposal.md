# Proposal

## Why

Requesters who lose their browser credential cannot recover their request through the rebuilt application. The [implementation plan](../../../../documentations/technical_specification/04_implementation_plan.md) and [request contract](../../../specs/meeting-requests/spec.md) require verified-contact recovery without signup.

## What Changes

- Add bounded, non-enumerating recovery requests for a known request ID and its previously verified email.
- Deliver a short-lived recovery link through Cloudflare; redeem it into a replacement request-specific HttpOnly credential, invalidating old authority.
- Preserve exact retries after uncertain responses and reject expired, superseded, changed-contact and closed-request recovery.
- Add accessible recovery controls to the existing booking destination. This is a request-continuation feature, not email login; host login remains Google-only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: bounded verified-contact recovery, credential rotation and private browser resumption.

## Impact

New private schema/migration, service-only recovery adapter, Cloudflare delivery worker, protected browser exchange and booking-page controls. Owning architecture/API/setup documents and automated/live acceptance evidence will be updated. Entry is the existing request URL; discovery of forgotten request IDs and new scheduling-inbox intake remain separate scope. No unresolved product decision is promoted into main specs before verified completion.
