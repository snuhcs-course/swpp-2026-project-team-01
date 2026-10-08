# Tasks

## 1. Recovery authority

- [x] 1.1 Implement private recovery issuance/redemption and server adapters; test generic outcomes, limits, concurrent/lost-response replay, permanent contact/credential invalidation, closure, wall-clock expiry and private grants. Update architecture documentation.
- [x] 1.2 Deploy the reviewed migration and adapter, verify remote rollback isolation and production regressions, and record evidence without exposing unfinished recovery routes.

## 2. Delivery and browser continuation

- [x] 2.1 Implement fenced Cloudflare recovery delivery with frozen content and pre-dispatch rechecks; test stale recipient/proof, lease loss, possible-send uncertainty and restart recovery, and document setup.
- [x] 2.2 Add bounded public issuance and explicit fragment redemption on the booking page, HttpOnly replacement cookies and accessible recovery feedback; verify abuse boundaries, CSRF, secret removal, uncertain exchange and old-session revocation in browser tests. Update UX/API documents.
- [ ] 2.3 Deploy the complete flow and verify controlled live delivery, cross-browser redemption and old-credential rejection; record acceptance and archive only after all bounded requirements pass.
