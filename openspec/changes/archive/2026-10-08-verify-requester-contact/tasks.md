# Tasks

## 1. Verification authority and proof

- [x] 1.1 Add private challenge/command records and a service-only guest adapter with current authority, contact/revision checks, expiry, attempt budget, cooldown/hourly limits and replay; deny legacy verification bypasses.
- [x] 1.2 Verify correct/incorrect codes, concurrent replay, exhausted attempts, resend/supersession, changed contact, rotated/expired/revoked credentials, closure and service-only grants with a full local migration rebuild.

## 2. Delivery and browser flow

- [x] 2.1 Implement encrypted frozen Cloudflare verification delivery with delivery-only leases, recipient/challenge rechecks, one dispatch grant and conservative uncertain outcomes; test duplicate/crashed/expired workers and provider rejection/lost responses.
- [x] 2.2 Add protected browser read/send/confirm routes and the requester card; verify exact command retry, reload, contact edits, expiry, keyboard/mobile layout and no email-login authority.
- [x] 2.3 Implement the private scheduler/endpoint and complete a local end-to-end request/code/confirmation/host-approval journey using synthetic delivery.

## 3. Deployment and evidence

- [x] 3.1 Update product/UX/setup/technical owning documents, deploy reviewed schema/adapters, verify production guards and inspect pending work before scheduler activation.
- [x] 3.2 Record controlled live inbox acceptance separately from local fixtures; retain full-plan recovery and requester Google identity obligations and archive only after all required evidence exists.
