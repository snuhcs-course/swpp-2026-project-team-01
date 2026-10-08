# Tasks

## 1. Internal operator contracts

- [x] 1.1 Add strict project/operator/recipient/retry inputs and deterministic private invitation code derivation with a dedicated key; verify fixed vectors, recipient/project/operator/key isolation, invalid inputs and compatibility with browser redemption, and document internal status.

## 2. Durable lifecycle

- [x] 2.1 Add dedicated issuance/status/revocation and delivery intent with database-owned seven-day expiry, exact retry and legacy issuance denial; generate/review the migration, rebuild locally, test authorization/concurrency/expiry and update setup documentation.
- [ ] 2.2 Implement fenced Cloudflare preparation/dispatch/outcome handling with frozen message context and code-hash verification; test lost responses, process interruption, revocation, key mismatch and no automatic resend, and document recovery.

## 3. Operator command and release

- [ ] 3.1 Wire runnable issue/status/revoke/manual-recovery commands with explicit targets, private exclusive output and sanitized JSON; test actual commands, unsafe paths, missing configuration and retained retry identity, and document command examples.
- [ ] 3.2 Run integration/build/browser checks, deploy reviewed schema/worker to identified production, verify controlled issuance/revocation and authorized recipient delivery with cleanup, record implementation-plan evidence and archive only after complete acceptance.
