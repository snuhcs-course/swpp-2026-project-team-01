# Proposal

## Why

Transactional emails use multiple copy paths, and the request-creation email can imply that a meeting is already accepted when it only links the guest back to an active request. The user wants the user-facing email writing reviewed across every transactional email scenario, in English, with a calm, professional design that follows Find Me a Time's ink-blue palette.

## What Changes

- Render all transactional email templates in English, regardless of the request or account language.
- Rewrite each email's subject, preheader, body and action labels to describe its actual trigger and next step, including distinguishing a request being ready from a meeting being accepted or booked.
- Replace the plain request-link email markup with one responsive, table-based HTML frame using the product's paper, white surface and ink-blue colors, clear hierarchy, a primary booking action and an optional, visually secondary email-confirmation action.
- Keep the plain-text alternative, safe escaping, private-link behavior and the rule that scheduling does not wait for address confirmation. Preserve existing localized date/time formatting only where it represents meeting data, not email copy.

## Capabilities

### Modified Capabilities

- `email-delivery`: define English copy and presentation for all transactional email templates.

## Impact

- Code: `lib/server/email-templates.ts`, `lib/server/booking-emails.ts`, `lib/server/account-emails.ts`, and existing renderer expectations.
- Documentation: this proposal, the email-delivery delta spec, and implementation tasks.
- Tracking issue: [#351](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/351).

