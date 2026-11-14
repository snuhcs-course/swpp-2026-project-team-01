# Tasks

## 1. Records

- [x] 1.1 Add `requester_imessage_bindings.channel`, widen `imessage_links_request_channel` to WhatsApp and keep `line_number` on iMessage attempts, generate the migration with `supabase db schema declarative sync --no-apply`, and verify `supabase db reset --local` and `supabase test db`.

## 2. Guest WhatsApp

- [x] 2.1 Take a channel in `request.imessage_link.create`, bind with the attempt's channel, refuse the contact card on WhatsApp, and answer each configured channel in the guest status. Verify integration tests for a guest linking WhatsApp and a WhatsApp code without a number.
- [x] 2.2 Route guest WhatsApp messages with the `[WhatsApp] ` prefix, send guest rows on the binding's channel, keep the channel when a binding moves, and check the window on guest rows. Verify integration tests for routing, a notice inside the window and one suppressed outside it.
- [x] 2.3 Add **Get updates in WhatsApp** to the guest card, and keep the Playwright guest iMessage journeys correct.

## 3. Numbers for WhatsApp

- [x] 3.1 Require and register the number on host, landing and guest WhatsApp starts without storing the assigned number. Verify integration tests for a host WhatsApp start that registers the number and one without a number.
- [x] 3.2 Ask for the number on the WhatsApp link step, Connect WhatsApp card and `/?flow=whatsapp`, and keep the Playwright WhatsApp journeys correct.

## 4. Documents

- [x] 4.1 Update the PRD's channel paragraph, the guest and host UX documents, provider setup and the decision log, and regenerate their `ko/` mirrors.

## 5. Release

- [ ] 5.1 Teammate review.
- [ ] 5.2 After `imessage-number-registration` is archived, archive this change so its MODIFIED requirement applies to the archived spec.
- [ ] 5.3 With a working WhatsApp Business line, link a real guest phone and record whether Photon's users API registration was needed for the WhatsApp sender.
