## Implementation

- [x] Add the agreement receipt template, English HTML and text, and its focused rendering checks.
- [x] Queue one frozen, version-keyed receipt from the successful agreement transaction and guard stale recipients.
- [x] Expose the accepted delivery's actual recipient to the guest waiting view, with delivery-state checks.
- [ ] Run the local database migration and agreement-delivery integration checks when Docker is available, then reconcile the pending behavior into the owning guest UX document at archive time.
