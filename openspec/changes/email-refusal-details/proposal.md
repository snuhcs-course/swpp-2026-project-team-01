# Proposal

## Why

From 05:40 to 07:26 UTC on 2026-11-23, Cloudflare Email Sending refused all 10 booking confirmation emails on the shared deployment with HTTP 400 ([#415](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/415)). The delivery evidence kept only `reason: refused` and the status, because `classifySendResponse` dropped the `errors` array of Cloudflare's answer, so the cause could not be read from our records.

A read-only comparison of the production rows (only booleans and lengths were printed) found one difference between the refused and the accepted confirmations: every refused row's frozen From header carried a display name outside printable ASCII (the host's name), and both accepted rows, and every accepted `request_creation` email, had an ASCII name. The attachment type, the Reply-To and the sending address were the same in both groups. The `.ics` content also held non-ASCII text in the refused rows only, but it travels base64-encoded, so the From header is the likely cause. Cloudflare's documentation does not say how it treats a raw UTF-8 display name.

## What Changes

- A rejected or server-error send outcome keeps Cloudflare's `errors[].code` and `errors[].message` as `providerErrors`, at most five, messages kept as Cloudflare returned them, cut at 200 characters by code point, with email addresses masked. The delivery job writes them into the existing `app.email_deliveries.evidence` JSON; no schema change.
- The adapter sends a From header whose display name is outside printable ASCII as RFC 2047 encoded-words (`=?UTF-8?B?…?=`, each word at most 75 characters), so the header Cloudflare receives is ASCII like the accepted ones. An ASCII name holding RFC 5322 specials (`Park, Dohyeon`) is sent as a quoted string. Other ASCII names and the stored, frozen `sender` are unchanged; already queued deliveries are encoded when they are sent.

## Capabilities

### Modified Capabilities

- `email-delivery`: refusal evidence keeps the provider's error code and message; a booking confirmation's non-ASCII sender name is encoded.

## Impact

- Code: `lib/server/cloudflare-email.ts`, `lib/server/email-delivery.ts` and `lib/server/cloudflare-email.test.ts`.
- Documentation: [Cloudflare Email Service](../../../documentations/technical_specification/03_provider_setup.md#cloudflare-email-service) in provider setup and its Korean mirror.
- Confirmation: the fix is confirmed only when a production booking for a host with a non-ASCII name is accepted, or a refusal now names its error code.
- Tracking issue: [#415](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/415).
