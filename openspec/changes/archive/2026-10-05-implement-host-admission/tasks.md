# Tasks

## 1. Waitlist and invitation records

- [x] 1.1 Implement validated deduplicated public waitlist commands/API and payload limits; verify repeated email enrollment produces one entry and neutral responses.
- [x] 1.2 Implement operator-only hashed invitation issuance/revocation with verified-email binding and seven-day expiry; verify unauthorized issuance, expired tokens, revoked tokens, and secret-free responses.
- [x] 1.3 Add desired SQL and generated reviewed migration for admission records; verify explicit privileges, local reset, and denied public database reads.
- [x] 1.4 Document operator invitation commands and expiry/revocation behavior in setup documentation; verify examples against controlled local identities.
- [x] 1.5 Issue short readable invitation codes and accept them across CLI email and redemption while preserving legacy token redemption; verify code entropy/format, hash-only RPC and canonicalized input.

## 2. Redemption and resumable host setup

- [x] 2.1 Implement atomic redemption and admission audit; verify same-account retry, recipient mismatch, token reuse, and concurrent account redemption tests.
- [x] 2.2 Add host sign-in and resumable setup with confirmed timezone/rules and stable unique handles; verify missing fields, handle collision, interrupted setup, and owning-host access.
- [x] 2.3 Enforce admission/readiness in shared setup, host connection, and publication commands; verify direct API bypass fails and uninvited requester intake remains allowed.
- [x] 2.4 Document setup requirements and update phase evidence; verify the M1 admitted-host journey once Calendar connection is available and retain explicit gaps if live consent cannot run.

## Verification evidence

2026-10-05: reviewed generated migration rebuilds the full local chain; 66 foundation/onboarding pgTAP checks pass. Scoped API/OAuth/Google/foundation suite passes 18 checks and Deno check/lint pass. Real Google consent, refresh, and M1 remain unchecked; requester consent persistence completes with P3.

Operator CLI verified against actual local RPC: hash-only 256-bit token, seven-day expiry, verified-recipient redemption/retry, recipient mismatch, revocation and denied re-use. No invitation messages sent. Setup guide: documentations/technical_specification/06_host_setup.md.

2026-10-05 code UX update: new invitations use sixteen Crockford Base32 characters grouped as `XXXX-XXXX-XXXX-XXXX` (80 random bits). The API canonicalizes case and separators before hashing and still accepts previously issued long tokens. CLI and route tests cover code generation, hash-only transmission, email copy, and redemption normalization; the prior live token test remains historical evidence.

2026-10-05 live M1: verified controlled invitation redemption, real browser Google consent, authorized calendar listing, selected calendars and public ready profile. Sanitized evidence: scripts/p0/host-setup-live-results-2026-10-05.json. This closes host M1; requester grants and full Calendar lifecycle remain tracked separately.
