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

## 5. Release

- [ ] 5.1 Teammate review.
- [ ] 5.2 Run the appended eval cases with the real model and record the result in documentation 13.
- [ ] 5.3 Check the stickers on the deployed guest page, then archive this change.
