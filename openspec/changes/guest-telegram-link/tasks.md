# Tasks

## 1. Records

- [x] 1.1 Let guest attempts and bindings be Telegram, add `sender_name_ciphertext` to the guest binding with its check and clearing trigger, generate the migration with `supabase db schema declarative sync --no-apply`, and verify the pgTAP tests.

## 2. Guest Telegram

- [x] 2.1 Take channel `telegram` without a number in `request.imessage_link.create` and `start_updates_link`, keep the sender's name on the binding (and across a move), and answer the bot in the guest status. Verify integration tests for a guest linking Telegram, a Telegram code from another channel and an agent-started Telegram link.
- [x] 2.2 Route guest Telegram messages with the `[Telegram] ` prefix, ignore a guest's bare `/start`, keep button taps off the guest path, and end guest bindings on a blocking update or a `blocked` send. Verify integration tests for routing, a notice, unlinking and blocking.
- [x] 2.3 Add **Get updates in Telegram** to the guest card, and verify a Playwright guest journey for Telegram on a computer.

## 3. Documents

- [x] 3.1 Update the copy that names guest channels, the PRD's channel paragraph, the guest UX documents and the decision log, and regenerate their `ko/` mirrors (the UX documents have none on `main`).

## 4. Checks

- [x] 4.1 Run `npm run typecheck`, `npm run lint`, `npm test`, the guest link integration tests and the guest Playwright journeys.

## 5. Release

- [ ] 5.1 Teammate review of D1–D6.
- [ ] 5.2 Link a real guest's Telegram on production and record it in the acceptance record.
