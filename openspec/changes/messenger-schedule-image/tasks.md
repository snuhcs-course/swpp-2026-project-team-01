# Tasks

## 1. Outbox

- [x] 1.1 Add `schedule_image` to `imessage_outbox.kind` in `supabase/schemas/` and generate the migration with pg-delta; add a pgTAP test that it carries no review hash and that `image` still needs one.
- [x] 1.2 Record and open a `schedule_image` row in `lib/server/imessage-outbox.ts` without touching the `image` paths; cover it with unit tests.

## 2. Picture

- [x] 2.1 Lay the Dashboard projection out by local day (`scheduleImageOf`); cover midnight cuts, all-day spans, kinds, the grid and the Google failure with unit tests.
- [x] 2.2 Render it next to the slot image with the shared helpers; cover the PNG, the lanes and the period text with unit tests.

## 3. Sending

- [x] 3.1 Send it on iMessage, WhatsApp and Telegram, sending nothing when it cannot be drawn; cover Telegram with unit tests.
- [x] 3.2 Add `send_schedule_image` to the host setup tools and the instruction to use it; cover the tool list with unit tests.

## 4. Documents and verification

- [x] 4.1 Update H04 M-5, the agent configuration, the user stories and the implementation plan, and regenerate the Korean mirrors.
- [x] 4.2 Run lint, typecheck, unit tests and the documentation check.
- [ ] 4.3 Run `supabase db reset --local` and the pgTAP suite, and send a picture through the local stand-in (left to the owner before merge: the shared local stack was in use).
