# Tasks

## 1. Implementation

- [x] 1.1 Send `prompt=consent` and `include_granted_scopes=true` on a sign-in that carries the iMessage start cookie, the continuation cookie or `return=imessage`.
- [x] 1.2 Read the cause from the stored grant in `linkedText` and add its line to the welcome.
- [x] 1.3 Record a plain sign-in that skipped the consent screen, and redirect its callback to the renewed consent when every Calendar scope is granted but the grant is not usable (D3).

## 2. Tests

- [x] 2.1 Unit test the welcome's cause lines.
- [x] 2.2 Extend `google-sign-in.test.ts` and `imessage-links.test.ts` for the onboarding consent and each cause.

- [x] 2.3 Cover D3 in `google-sign-in.test.ts`: the redirect, the stored token after it, no second redirect, and no redirect for unticked scopes or a usable grant.

## 3. Documents

- [x] 3.1 Update provider setup, the page list, the decision log and the testing baseline, with their `ko/` mirrors.

- [x] 3.2 Update provider setup, the page list, the decision log and the testing baseline for D3 (the `ko/` mirrors are regenerated separately).

## 4. Release

- [ ] 4.1 Run `npm run test:integration` on the local stack (not run in the implementing session).
- [ ] 4.2 With a Google account that authorized the client before, onboard from `/?flow=imessage` and check the welcome skips the Calendar link.
- [ ] 4.3 Check the Google OAuth app's publishing status (Testing expires refresh tokens after seven days).
- [ ] 4.4 Teammate review.
- [ ] 4.5 After `host-imessage-channel` is archived, archive this change.
