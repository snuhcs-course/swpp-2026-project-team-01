# Tasks

## 1. Linking on arrival

- [x] 1.1 Bind a host's or guest's sender in `receiveLinkCode` when a valid code arrives, with the commands' lock order, and remove `imessage.link.confirm`, `request.imessage_link.confirm` and the "tap Confirm and link" replies.
- [x] 1.2 Bind a start's recorded sender when the browser or Thyme's sign-in link claims it, and skip the "back from Google" reply when the claim linked.
- [x] 1.3 Show a linked number by its last four digits on the host and guest cards.
- [x] 1.4 Make the agent-led link page say "Linked" once the code arrived, with no confirm action.

## 2. Pages

- [x] 2.1 Remove **Is this you?** and **Is this your Telegram?** from the `/app` link step, the Connect card, the landing and the booking page, and show **Linked** with **Not my number — unlink**.
- [x] 2.2 Move the WhatsApp opt-in and the Telegram privacy sentence to the screen that shows the code.

## 3. Tests

- [x] 3.1 Unit tests for `maskedSender` and the linked screens' copy.
- [x] 3.2 Update the integration and browser tests that pressed **Confirm and link** to expect the link on arrival and the unlink recovery.

## 4. Documents

- [x] 4.1 Update the deltas of `host-imessage-channel`, `host-whatsapp-channel`, `host-telegram-channel`, `guest-flow-completion`, `guest-whatsapp-link`, `guest-telegram-link` and `agent-led-flows` so they do not ask for a confirmation, and the PRD, UX documents, agent configuration, testing baseline and decision log, with their `ko/` mirrors.

## 5. Release

- [ ] 5.1 Run `npm run test:integration` and `npm run test:e2e` on the local stack (not run in the implementing session, which shared the machine).
- [ ] 5.2 With real phones, link iMessage, WhatsApp and Telegram as a host and as a guest, and unlink a wrong number.
- [ ] 5.3 Teammate review.
- [ ] 5.4 After `host-imessage-channel`, `guest-flow-completion` and the channel changes are archived, archive this change.
