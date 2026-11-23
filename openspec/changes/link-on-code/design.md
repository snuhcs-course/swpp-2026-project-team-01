# Design

## Context

See [proposal.md](proposal.md). Linking used to be two steps: the code's message recorded the sender (`imessage_links.state = 'received'`) and the browser's **Confirm and link** bound it ([`host-imessage-channel` design 4](../host-imessage-channel/design.md#4-linking-by-a-host-sent-code), [`guest-flow-completion` design 1](../guest-flow-completion/design.md)). This change makes the first step bind.

## Goals / Non-Goals

**Goals:** one trip for the person: send the code, and both the messenger and the page say it is linked; the same behavior for hosts and guests on all three channels; a visible, one-tap recovery for a wrong number.

**Non-goals:** the fallback six-digit code (it is typed into the browser, so it already binds without a second step); a link notification by email (D2); changing the code format, its 15 minutes or the hourly limits.

## Decisions

### 1. Linking on arrival

`receiveLinkCode` (`lib/server/imessage-links.ts`), called by the receipt job for iMessage, WhatsApp and Telegram, looks the code up and takes the locks the commands take for the same rows, in their order: a host's account share lock (`lockActiveHost`) and then the host's link lock; a request's row (`lockOpenRequest`) and then its link lock; a start's starter lock alone. The attempt is usable when it is `pending`, unexpired, made for the arriving channel, the conversation is direct, its owner can still link (an active host, an open request), and for a host's attempt no other host holds the sender. Then:

- a host's attempt records the arrival (`sender_hash`, `received_by_receipt_id`, so WhatsApp's window starts at this message) and calls `bind`, which ends the host's earlier binding on any channel, inserts the binding, marks the attempt `linked`, and queues the linked message: "Linked. Send help for what I can do here." for a ready host, the welcome into setup otherwise (D19). The receipt job first reads the host's live calendar list (`arrivalOptions` in `lib/server/imessage-receipts.ts`), as the setup commands already do in that job, so a host without saved calendar roles gets the writable primary calendar as the default and the welcome names it, as **Confirm and link** did; a failed read only means the welcome asks for the roles;
- a guest's attempt records the arrival and calls `bindRequester`, which queues "Linked. You'll get updates about your request with … here …", and marks the attempt `linked`;
- a start's attempt (no host yet) is recorded as `received` as before (design 5).

Anything else voids the attempt the code names and sends at most one fixed refusal a day. A retried job finds its own receipt on the attempt, and the same sender sending the code again after it linked changes nothing and gets no refusal.

The outcome recorded on the receipt stays `link_received`, so the receipts table needs no change. Telegram's first bot message is now the linked welcome, as `host-telegram-channel` design 6 intended for after confirmation.

### 2. Recovery: Not my number

The pages that showed the code poll while it is pending (`/app` link step and Connect card every 2 seconds, the landing popup, the booking page's card, the agent-led page every 3 seconds) and so move to **Linked** by themselves. The host's linked screen names the sender (design 4) and offers **Not my number — unlink** (**Not my Telegram — unlink** on Telegram); the guest card names the sender beside its existing **Unlink iMessage**, **Unlink WhatsApp** or **Unlink Telegram**. It runs `imessage.unlink` for a host and `request.imessage_link.unlink` for a guest, which end the binding in the database and suppress anything still queued for it, then shows the channel choice or the card's start again so a new code can be made. The agent-led page only says it linked; unlinking is in `/app` or on the booking page.

### 3. Safeguards and remaining risk

The confirmation let the person check the sender before it was bound. What stands in for it:

- **Single-use.** A code links once. A used, voided, expired or replaced code (a newer code ends the older one) never links again and voids nothing else.
- **Short-lived.** 15 minutes (`IMESSAGE_LINK_LIMITS.validMinutes`).
- **Bound to the session that showed it.** A host's code is created by and belongs to the signed-in account that showed it; a guest's to the request whose booking page showed it; a start's to the browser holding its HttpOnly cookie, and its sender is bound only by a Google sign-in in that browser or from the sign-in link Thyme sent that sender. A code can never link another account or request.
- **Rate-limited.** 5 codes per host, per request or per start source address per hour (100 starts across the service); one refusal a day per sender and 200 per line, so code guessing gets no feedback. A code has ten characters from a 32-character alphabet.
- **Refused out of place.** A code from a group, from another channel than the one it was made for, or from a sender another host holds voids the attempt.

Remaining risk: a code that leaks before its owner sends it (a shoulder-surfed screen, a forwarded screenshot, a copied start link or QR code) links whoever sends it first. For a guest, that sender gets the request's updates and can reply as the guest, which a holder of the booking link can already do on the web. For a host, that sender can act for the host in the messenger, including approving meetings, until the host unlinks. The person sees the wrong sender on the page at once, since the page moves to **Linked** with the sender's digits or name, and **Not my number — unlink** ends it; the host's own message with the code then gets the refusal, and a new code links the right number. This is recorded in the decision log.

### 4. The sender on screen

`maskedSender` (`lib/contracts/imessage.ts`) shows a number as `•••• 1234` and an Apple ID email in full; a Telegram sender keeps their first name and @username (`telegramDisplayName`). The host card (`readImessageStatus`) and the guest card (`readRequesterImessageStatus`) use it for the linked state. The iMessage start's `received` screen, before sign-in, still shows the sender in full, since the browser has no account yet.

### 5. The iMessage start before sign-in

A start's attempt has no host, so an arriving code records the sender as `received` and Thyme replies with the sign-in link (D19): "Got it. To finish linking, sign in with Google and connect your calendar: …". `claimStartedLink` (the same browser's sign-in) and `claimContinuedLink` (the sign-in from that link) give the attempt to the host and call `bindReceivedAttempt` with the live calendar list the callback read, which binds the recorded sender as an arriving code would; a sender another host linked meanwhile voids the attempt. A start whose code had not arrived yet becomes the host's pending attempt and binds on arrival. When a claim linked the conversation, the sign-in callback does not also send "You're back from Google", since the welcome says what comes next.

## Risks / Trade-offs

- [A leaked code links the wrong sender] → Short-lived single-use codes, the sender on the linked screen and **Not my number — unlink** (design 3).
- [The receipt job waits on Google's calendar list while it holds the receipt] → One read per arriving host code, bounded by the calendar client's timeout; a failure only means the welcome asks for the roles.
- [Attempts left `received` by the old flow at deploy time] → The cards ignore them and they expire within 15 minutes; the person makes a new code.
