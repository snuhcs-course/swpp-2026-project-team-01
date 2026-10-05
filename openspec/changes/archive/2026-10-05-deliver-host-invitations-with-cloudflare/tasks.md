# Tasks

## 1. Invitation delivery

- [x] 1.1 Implement default Cloudflare delivery for remote invitation issuance with private dispatch evidence and manual/local exclusions; verify success, missing configuration, RPC failure, uncertain/rejected sends, and no-send operations with automated tests.
- [x] 1.2 Update operator documentation and test commands; verify documented CLI help and preserve existing redemption semantics.

## 2. Root-domain sender

- [x] 2.1 Onboard findmeatime.com and update local/runtime sender and Auth SMTP; verify DNS, SMTP sender acceptance without message submission, and Auth readback, while preserving AgentMail and unrelated DNS.
- [x] 2.2 Update sender examples and active documentation, preserving historical rollout evidence; verify stale active sender examples are removed.

## 3. Verification

- [x] 3.1 Run relevant automated checks, code review, and OpenSpec validation; record production configuration evidence separately from actual inbox delivery.
