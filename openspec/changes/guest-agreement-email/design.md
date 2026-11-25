# Design

Record an `agreement_receipt` delivery in the `request.agree` transaction, after the agreement row is inserted. Use the agreed proposal's existing `readAgreementSummary` data, freeze its version and display fields in parameters, and seal the private booking link as the existing email outbox does. Key the delivery by request ID and proposal version. The outbox renders a new copy in the creation email's 600px navy and white layout, with a 15px greeting, one continuous explanatory paragraph, compact meeting-detail rows and **View request**. Preserve `request_creation` behavior and copy.

For a change to an already booked meeting, the same command queues a receipt whose copy says the existing booking remains confirmed. The outbox checks that the contact and agreed version are current before dispatch. The guest projection reads the email delivery's accepted state and stored recipient for the current agreement, never a queued or uncertain record. The waiting card already renders the conditional line. Cover the template, transaction deduplication, stale recipient and accepted-only projection with focused tests.

The kind-check migration is hand-authored from the existing constraint because pg-delta requires Docker, which is unavailable in this workspace. Reconcile it with the declarative generator and rebuild the disposable local database before archive.
