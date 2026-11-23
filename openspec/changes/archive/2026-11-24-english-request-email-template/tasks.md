# Tasks

## 1. Request-link email copy and layout

- [x] 1.1 Force English for `request_creation` and `link_resend`, replace the plain HTML with the shared ink-blue email frame, and retain an equivalent plain-text alternative; update the existing renderer expectations and verify `npm run typecheck` and `npm run lint`.
- [x] 1.2 Inspect a rendered request-creation email with and without the optional confirmation link and a link-resend email at desktop and narrow widths; verify the booking action remains primary and all dynamic copy and URLs remain escaped.

## 2. Booking email UX writing

- [x] 2.1 Review and revise English subject, preheader, body and action copy for booking confirmation (requester and host), new proposals, declined and expired requests, pending calendar booking, cancelled bookings, and changes that do not take effect; make every state and next action accurate.
- [x] 2.2 Use English when rendering booking email templates regardless of saved request language while preserving meeting dates, times and timezone formatting; update existing renderer expectations.

## 3. Account email UX writing

- [x] 3.1 Review and revise English copy for deletion scheduled, deletion cancelled, deletion completed, and host-account-closed guest notifications; use English when rendering regardless of saved language and update existing expectations.

## 4. Verification and documentation

- [x] 4.1 Render representative email cases and inspect for accurate intent, primary action, English copy, HTML/plain-text parity and safe dynamic escaping; run typecheck and lint.
- [x] 4.2 Review product and capability documentation for any language-contract changes and update only the owning documents.

