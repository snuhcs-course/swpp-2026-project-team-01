# Tasks

## 1. Change email after a bounce

- [x] 1.1 Add `contact.change_email` with `contactChangeAllowed`, the creation-email bounds and `issueContactConfirmation`; register it with the requester commands.
- [x] 1.2 Offer **Change email** and its form on the status line when the booking link bounced or was suppressed; unit-test the control.
- [x] 1.3 Integration test: refused while delivered, replaces a bounced address and emails the new one, and is limited like every creation email.

## 2. Replies to the booking confirmation

- [x] 2.1 Reply-To the product inbox on the guest's confirmation, with the line that a reply reaches Thyme; unit-test both copies and the no-inbox fallback.
- [x] 2.2 Route an authenticated reply from the confirmation's recipient into the request's discussion (`confirmationReply` in `email-receipts.ts`).
- [x] 2.3 Update the `email-delivery` specification.
- [x] 2.4 Integration test: a reply is forwarded in a new bound thread; another sender, and a confirmation that replied elsewhere, are ignored.

## 3. Resend from the conversation

- [x] 3.1 Add `contact.resend_link` for the confirmed contact under the resend limits, and accept a booked request in the `link_resend` recipient recheck.
- [x] 3.2 Add the `resend_booking_link` tool and its instruction line.
- [x] 3.3 Integration test: nothing for an unconfirmed contact; one email per call and limited per minute; a booked meeting's guest gets it.

## 4. Agreement notice in linked chats

- [x] 4.1 Add `agreement-notice.ts` with the summary and English text; unit-test the text.
- [x] 4.2 Add `agreement_sent`, queue it on agreement and on linking while the agreement waits, and send it only while current.
- [x] 4.3 Update the `meeting-requests` specification.
- [x] 4.4 Integration test: one notice per agreement without the link, one for a guest who links after agreeing, none for a reopened version.

## 5. Verification and documentation

- [x] 5.1 Run lint, typecheck, unit tests and the documentation check.
- [x] 5.2 Update the owning documents and regenerate their Korean mirrors.
- [ ] 5.3 Run `npm run test:integration` against the local stack (left to the repository owner on `main`).
