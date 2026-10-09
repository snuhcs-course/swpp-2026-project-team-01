# Tasks

## 1. Shared budget and provider cancellation

- [x] 1.1 Implement the invocation-scoped 18-second budget with monotonic timing, disposal and bounded waiting; verify expiry-before-call, boundary expiry, late resolve/reject, non-cooperative promises and independent concurrent invocations. Document its cancellation limits in the owning architecture document.
- [x] 1.2 Thread the shared cancellation signal through Calendar refresh/list/freebusy/adjacent and Routes adapters without resetting narrower timeouts. Verify real installed OAuth transport cancellation, paginated/header/body stalls and zero subsequent provider calls after expiry; update provider test documentation.

## 2. Evaluation and publication integration

- [ ] 2.1 Apply the budget to direct/batch and booking evaluation, keeping authority checks and bounded failure recording. Verify host/guest sequencing, candidate loops, route failure values and no late evidence writes with deterministic service fixtures; document incomplete-result behavior.
- [ ] 2.2 Share the same budget through publication and ranking, including model reservation and persistence boundaries. Verify no fresh deadline, no late/partial publication, retained committed reservations, and unchanged durable recovery after uncertain RPC replies; update architecture and legacy assertion mapping.

## 3. End-to-end verification and rollout

- [ ] 3.1 Run actual local evaluation/publication/booking integrations, post-fixture SQL, full application checks, both builds and runtime smoke. Verify unchanged successful paths plus timeout before Calendar dispatch; record exact commands and evidence in the implementation plan.
- [ ] 3.2 Commit and deploy a scanned clean archive to the verified release project; confirm Ready deployment, independent release alias, health and authorization checks. Record source/deployment identity, then archive only after all required acceptance evidence passes.
