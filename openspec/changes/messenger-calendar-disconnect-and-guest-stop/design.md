# Design

## Context

The web disconnect route already deletes the host's provider grant and saved calendar roles in one transaction. Setup tools run only for an authenticated host, and `channelOfTurn` can prove that a setup turn came from a linked messenger. Guest messages are routed in the receipt worker before or into the assistant; requester bindings and the outbox already support unlinking, encrypted recipient cleanup, and suppression of waiting or queued messages.

## Goals / Non-Goals

**Goals:**

- Reuse the web Calendar disconnect effects for a clearly requested action in a linked host messenger.
- Treat guest STOP as a channel-level opt-out for all active guest requests belonging to that sender on that channel, before any assistant turn.
- Keep restart explicit: the guest opens the request link from email and links a messenger again; this creates a new binding under the existing consent flow.
- Keep the implementation within existing tables and outbox states.

**Non-Goals:**

- Add a `START` command that reactivates messaging without another request-page consent.
- Withdraw requests, cancel bookings, delete events, or disable email and other messenger channels when a guest stops one channel.
- Change how hosts connect Calendar or how guests originally link messaging.

## Decisions

- Extract the existing Calendar deletion transaction into a server helper shared by the HTTP route and setup tool. The setup tool will check host/session authorization and require a linked iMessage, WhatsApp, or Telegram turn before calling it. The helper removes the grant, roles, note decisions, and selected-calendar settings in the same transaction, so derived readiness pauses new requests and `approveCommand` refuses a booking without a configured destination. Existing requests and bookings remain stored.
- Intercept guest `STOP` before ambiguous-request selection and assistant forwarding. End every active requester binding matching the sender hash and receipt channel, clear sealed recipient data through the existing unlinked state, and suppress waiting or queued outbox messages. Queue one receipt-keyed confirmation directly to the sender. If a sender also has a host binding, the existing host STOP path will end the host binding and guest bindings on that channel as one channel-wide opt-out.
- Add distinct localized guest-stop copy that says updates on this channel stopped and points to the booking link in the request email for a fresh opt-in. Do not send the booking link itself in the messenger, consistent with the existing linked welcome.
- Keep the web and messenger Calendar disconnection semantics identical. Update the confirmation copy to explain that existing requests remain open and Calendar-dependent work waits for reconnect and setup.

## Risks / Trade-offs

- [A guest may have several requests linked to one channel] → STOP ends all of that sender's guest bindings on that channel; other channels and email continue, and relinking opts a request back in.
- [A STOP sender may also be a host on the same channel] → Treat STOP as a channel-wide opt-out and end both host and guest bindings; the confirmation explains that the channel can be linked again from the appropriate workspace or booking link.
- [Calendar-dependent work on an existing request may be attempted while disconnected] → the existing missing-booking-calendar guard rejects host approval before creating a booking; document that reconnect and setup are required to continue calendar-dependent work.

## Migration Plan

No data migration is needed. Deploy the code and documentation together. The existing web disconnect route remains the rollback path for host Calendar disconnection; no schema change is introduced. Re-linking creates new active guest or host bindings through the existing consent flow.
