# Tasks

## 1. Decisions

- [x] 1.1 Record D1–D7 in the [decision log](../../../documentations/technical_specification/08_decision_log.md) and its `ko/` mirror.

## 2. Drawings

- [x] 2.1 Add the happy and sorry drawings to `apps/web/public/thyme/` on transparent backgrounds at 128px and 256px, with their paths in `lib/contracts/thyme-cat.ts`.

## 3. Web

- [x] 3.1 Choose a message's cat from its tool parts and `show_cat` calls, in the order of D6, with the previous Thyme message's cat for the no-repeat rule. Verify unit tests for each source, the order, the no-repeat rule and a refused agreement.
- [x] 3.2 Draw the cat as a 48px sticker on the last bubble's bottom-right corner, hidden from assistive technology, and hide `show_cat` from the tool trace. Add the happy cat to the booked notice.
- [x] 3.3 Describe the sticker in `DESIGN.md`.

## 4. Assistant

- [x] 4.1 Add `show_cat` to the requester tools, with no side effect, and tell the requester fragment when to call it.
- [x] 4.2 Append requester eval cases: correcting its own mistake calls `show_cat` with `sorry`; a time no longer free calls none; "show me the happy cat" calls `show_cat` with `happy`; a recorded agreement calls none. Not run here: they call the paid model.
- [x] 4.3 Verify that `turnReplyText` and the messenger outbox text of a turn with `show_cat` are unchanged.

## 5. Telegram

- [x] 5.1 Add the happy and sorry stickers as 512px WEBP to `apps/web/public/thyme/`, with their paths in `lib/contracts/thyme-cat.ts`.
- [x] 5.2 Choose a turn's cat from its recorded `action.result` events, with the session's previous Thyme turn for the no-repeat rule. Verify unit tests for a recorded agreement, a refused one, a failed tool, `show_cat` and the no-repeat rule.
- [x] 5.3 Send the cat with `sendSticker` after a guest's Telegram turn reply, best effort, and never on a host's reply or another channel. Verify that a refused sticker leaves the reply accepted and that a refused text sends no sticker.

## 6. Release

- [ ] 6.1 Teammate review.
- [ ] 6.2 Run the appended eval cases with the real model and record the result in documentation 13.
- [ ] 6.3 Check the stickers on the deployed guest page and in a guest's Telegram chat, then archive this change.
