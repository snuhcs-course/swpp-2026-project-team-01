# Tasks

## 1. Registration and records

- [x] 1.1 Add `photonRegistrar` to `lib/server/photon.ts` behind the messaging gate, and `POST /users` to the stand-in. Verify unit tests for registered, refused and unavailable answers, the production URL and credentials, and the preview refusal.
- [x] 1.2 Add `imessage_links.line_number`, generate the migration with `supabase db schema declarative sync --no-apply`, and verify `supabase db reset --local`.
- [x] 1.3 Register the number in the host, landing and guest create paths and show the assigned number in their statuses. Verify integration tests for registration, the assigned number, a missing or malformed number, a refused registration and WhatsApp without a number.

## 2. Screens

- [x] 2.1 Restore the phone field as `NumberForm` and use it in the `/app` link step, the Connect iMessage card, the landing start and the guest card. Verify Playwright runs of the iMessage, guest and WhatsApp journeys at 390 and 1280 pixels.

## 3. Release

- [ ] 3.1 Teammate review.
- [ ] 3.2 After merge and deploy, link a real iPhone that is not yet a Photon user, and record the assigned number and the sender identifier.
