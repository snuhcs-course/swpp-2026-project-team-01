# Tasks

## 1. Transactional delivery

- [x] 1.1 Implement Cloudflare sender, frozen provider routing, and safe replay handling; verify provider and worker regression tests including legacy AgentMail retries.
- [x] 1.2 Update deployment variables and sender documentation; verify missing configuration fails before deployment and AgentMail configuration is preserved.

## 2. Authentication delivery

- [x] 2.1 Add Cloudflare SMTP setup configuration and helper with target validation; verify preview, apply, readback, and error behavior using fake transport without sending email.
- [x] 2.2 Activate the identified live sender domain and Supabase SMTP when prerequisites are available; verify DNS and redacted Auth settings, otherwise record the exact remaining blocker.

## 3. Integration verification

- [x] 3.1 Run application typecheck, lint, tests, build, and OpenSpec validation; document verified results separately from untested live delivery.

## Verification evidence

2026-10-05: `npm run check` passed typecheck, lint, 113 Deno tests, four SMTP helper tests, and web build. Changed-file formatting, script lint, missing-credential deployment guards, and strict OpenSpec validation passed. The existing web bundle-size warning remains. Cloudflare `mail.findmeatime.com` DNS is ready; an account-scoped Email Sending token authenticated over SMTP/TLS with status 235. Supabase Auth settings were applied and read back for project `anelszynxtvxoxqvzgqt`. Cloudflare runtime secrets and worker version 10 were deployed; unauthorized worker access returns 401 and public API health returns 200. AgentMail credentials/inboxes remain intact. No live message was sent; inbox delivery remains untested.
