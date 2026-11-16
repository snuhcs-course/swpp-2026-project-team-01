# Tasks

## 1. Server

- [x] 1.1 Add `request.identify_account` (account name and Google-verified address as the confirmed contact, Calendar step skipped, account link in the same transaction), registered only behind a verified session on the commands route. Cover: success, the request's own host, no session, a suspended account, retry.
- [x] 1.2 Add the booking-link visitor lookup (signed in, own link, latest open linked request with a live link) and the guest-page account check. Cover: other accounts' requests, closed and draft requests, expired links.

## 2. Pages

- [x] 2.1 Booking link: signed-in line, **Continue your request**, own-link note, and **Continue as {name}** on the identity card.
- [x] 2.2 Guest page: **Back to your workspace** for a request linked to the signed-in account.
- [x] 2.3 Browser test: a signed-in host continues as their account on another host's link, returns to `/app` with setup intact and the sent request listed, and resumes from the link.

## 3. Documentation

- [x] 3.1 Update the guest booking flow and regenerate its `ko/` mirror; validate this change.

Unit tests, lint, typecheck, the web build and OpenSpec validation passed locally. The integration suite (`tests/integration/guest-account.test.ts`) and the browser test (`tests/e2e/host-as-guest.test.ts`) need Docker for the local Supabase stack, which was unavailable; CI runs them.

## 4. Archive

- [ ] 4.1 After merge and verification on the shared deployment, archive this change into `meeting-requests`.
