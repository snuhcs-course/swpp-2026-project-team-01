# Tasks

## Guest screen

- [x] Open a one-time success dialog after a recorded agreement, then focus the waiting card on dismissal.
- [x] Add the waiting card's status and destination copy, plus a conditional sent-agreement line.
- [x] Show a short failure alert after a refused agreement, with a specific next step for an unavailable time or uncertain result.
- [x] Cover successful and failed dialogs and waiting copy in the guest browser journey, and the conditional line in a component test.

## Integration and review

- [x] Apply the reviewed English waiting copy and add persisted **Email updates only** with a saved receipt and fixed Thyme acknowledgment, without a **Change** action.
- [x] Update the component and browser checks; add integration coverage for persisted preference, cancelled link attempts and suppressed messaging.
- [ ] Run the email-only integration and browser checks against a running local Supabase stack.

- [ ] Wire #178's confirmed agreement email delivery and recipient into `agreementEmailSentTo`; verify the line against a delivered email and ensure queued, failed and uncertain sends never claim success.
- [ ] Update the owning guest UX document and regenerate its Korean mirror after the email behavior and copy are settled.
- [ ] Review the prototype with the issue owner, run the full guest journey, and archive the change after its requirements are complete.
