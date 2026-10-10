# Design

## Context

See [proposal.md](proposal.md). Legacy contact challenges and generic commands predate the rebuilt authority/worker boundaries and have no code-attempt budget. New browser behavior must not expose those paths. The Cloudflare transport and transactional booking delivery already demonstrate persist-before-send and conservative unknown outcomes.

## Goals / Non-Goals

Provide request-bound proof and a complete code-delivery/browser path. Do not create host email login, recover request credentials, imply agreement, or accept model assertions as proof. Existing protected-page rules remain: an unauthenticated booking page does not expose recovery controls.

## Decisions

- Use a dedicated service-only verification RPC and private tables instead of allowing browser code to call legacy generic mutations. Require issued guest credentials, current token/lifecycle and exact displayed email/revision when requesting a code. Deny legacy contact_start/contact_confirm once the new operation exists.
- Generate six numeric digits server-side; store a keyed HMAC bound to request/challenge context and an authenticated encrypted delivery copy. Never expose either via browser reads, logs or agent tools. Reuse the existing server encryption secret with explicit domain separation. Keep random generation outside SQL; command replay returns the already stored challenge even if a transport retry proposes a different random secret.
- Codes last ten minutes. Allow five distinct failed guesses, one new challenge per minute and five per request per hour. Wrong guesses commit their counter and safe outcome rather than raising an exception that would roll them back. Confirm command replay does not spend another attempt. Bind challenges to the issuing request token and current email. Rotated tokens and changed emails invalidate proof.
- Request lock serializes start, confirmation, contact edits and closure. Verification updates only the verified address and request revision/history, leaving explicit agreement and host approval untouched. Before every replay recheck current authority/contact; replay cannot restore revoked access.
- Freeze encrypted message/account/sender/recipient before an immutable dispatch grant. Contact jobs use delivery-only lease guards, a private authenticated endpoint and a minute scheduler. Duplicate workers defer while the original sender lease is live; lost acknowledgements/provider results never permit another send. Recheck challenge/token/email/expiry at dispatch. Superseded, consumed or closed challenges suppress unsent mail.
- Show a separate requester contact card with send, code input, confirm and explicit resend. Read state after unknown mutations and retain the same command until its outcome is known. Refresh after contact edits and successful verification. Do not render a secret or recipient hidden from the current request scope.

## Risks / Trade-offs

- [Code guessing and email abuse] → bounded attempts/cooldown/hourly budget and existing intake authority limits; test concurrent requests.
- [Lost send response] → preserve uncertainty; a user-requested new code is a new logical action and invalidates the old code.
- [Legacy bypass] → deny old verification mutations; retain historical records without treating old unbounded challenges as new proof.
- [Live messages] → tests use synthetic transport/local fixtures; production activation inspects pending work and controlled inbox acceptance remains separately recorded.

## Migration Plan

Create private desired schema and generated migration, rebuild local database and verify isolation/replay/races. Deploy the core RPC before browser/delivery activation. Then deploy delivery/browser adapters and provision the scheduler only after inspecting the selected production environment. Application rollback preserves challenges and uncertain delivery evidence; do not delete or resend uncertain records.
