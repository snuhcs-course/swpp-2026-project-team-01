# Tasks

Tasks describe replacement implementation and verification. Completed consent tasks have local evidence in the rebuild ledger; live Calendar acceptance remains pending.

## 1. Bound consent and protected credentials

- [x] 1.1 Implement authorized consent initiation, expiring single-use state, binding cookie, allowlisted returns, and callback validation; verify state replay, swapping, expiry, wrong browser, and denied consent tests.
- [x] 1.2 Implement distinct host/requester scope contracts and AES-GCM protected server tokens; verify requester grants cannot reach host reads/writes and tokens never appear in DTOs/logs/model context.
- [x] 1.3 Add grant/state desired SQL and reviewed migration; verify local reset and service-only secret access.
- [x] 1.4 Document exact callback URL, encryption-key setup, scopes, and Google Testing expiry; verify deployed callback reachability and actual registered URLs without exposing secrets.

## 2. Calendar selection and recovery

- [x] 2.1 Implement calendar list, conflict selection, and writable booking-destination checks; verify read-only destination rejection and no silent primary-calendar fallback.
- [x] 2.2 Implement bounded refresh, invalid-grant/revocation recovery, disconnect, and requester grant closure; verify failed reads never become empty calendars and disconnected grants lose authority.
- [x] 2.3 Add requester consent/resume UI and explicit manual-availability replacement; verify account-free continuation, cross-request rejection, interrupted consent, denial, and reconnect scenarios.
- [ ] 2.4 Record live Calendar/AC-27 evidence with controlled user grants; verify actual consent, refresh, reads, and disconnect separately from deterministic fixtures.

## 3. Guest identity and timezone

- [ ] 3.1 Define identity-only Google adapter/callback and browser-bound intake/request continuation; implement verified name/email prefill, manual/alternate email verification and skip without mandatory product signup. Verify wrong-browser/request rejection, account switching, no email-based request takeover and no implicit Calendar grant or host admission.
- [ ] 3.2 Implement guided inline guest contact actions and a detected/explicit IANA timezone selector; test DST, absent/conflicting context, changed display zones, callback/reload preservation and no redundant confirmation question. Keep optional Calendar connection and manual availability separate and verify both end-to-end paths with controlled accounts.
