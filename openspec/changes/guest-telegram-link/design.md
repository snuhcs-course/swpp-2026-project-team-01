# Design

## Context

The guest iMessage and WhatsApp links ([`guest-flow-completion`](../guest-flow-completion/design.md) design 1 to 4, [`guest-whatsapp-link`](../guest-whatsapp-link/design.md)) store a request's attempt in `app.imessage_links`, bind the confirmed sender in `app.requester_imessage_bindings` with its channel, route the guest's messages by the sender's keyed hash, and send notices and turn replies through `app.imessage_outbox` on the binding's channel. The host Telegram channel ([`host-telegram-channel`](../host-telegram-channel/design.md)) added the webhook, Telegram receipts with the sender's sealed name, the `t.me` start link and the Bot API transport. Three pieces kept guests off Telegram: the check `imessage_links_request_channel`, the binding's channel check, and the receipt job sending every Telegram receipt down the host path.

## Goals / Non-Goals

**Goals:** a guest links Telegram from the booking page or through their agent; their messages reach the request's discussion; notices and replies go out on Telegram; unlinking or blocking the bot ends it.

**Non-goals:** a guest linking two channels on one request at once; guest buttons, typing or reactions; renaming `requester_imessage_bindings`.

## 1. Records

`requester_imessage_bindings.channel` accepts `telegram`. Since `imessage_links.channel` already allows the three channels, `imessage_links_request_channel` would only repeat that column check, so it is dropped.

A Telegram binding keeps the sender's first name and `@username` in a new `sender_name_ciphertext`, sealed with the sender under `requester_imessage_binding:{id}`, as a host binding does (`host-telegram-channel` design 3). The check `requester_imessage_bindings_sender_name` keeps it only beside a sender, and the trigger `requester_imessage_bindings_clear_sender_name` (the existing `app.clear_sender_name`) clears it whenever the sender is cleared: unlinking, ending, a move and the 30-day cleanup. A binding moved to a revised request keeps its channel and its name.

The migration is generated with `supabase db schema declarative sync --no-apply`. It adds one nullable column, one check and one trigger, widens one check and drops one; no row changes.

## 2. The guest card

`GET /api/requests/{bookingId}/imessage` answers `none` with `telegramUsername` (the bot's username, or null) beside `lineNumber` and `whatsappNumber`; the card shows **Get updates in Telegram** where it is set. `unavailable` means none of the three is configured.

**Get updates in Telegram** runs `request.imessage_link.create` with `{ channel: "telegram" }` and no number: nothing is registered with Photon, and the attempt keeps no `line_number`. A Telegram `pending` carries the bot's username as `lineNumber` and the bare code as `message`, as the host's Telegram card reads them (`host-telegram-channel` design 6), so `telegramLinkFor(lineNumber, message)` is the start link. On a phone the card opens it at once and offers **Open Telegram**; elsewhere it shows the bot, the code, a QR code of the link, **Open Telegram** (Telegram Desktop or Telegram Web) and **Copy**.

A Telegram `received` shows the sender's sealed name; before **Confirm and link** the card says where Telegram keeps the chat: "Telegram keeps bot chats on its servers. Find Me a Time sends your request updates here." A Telegram `linked` line says "Telegram linked: updates go to <name>" with **Unlink Telegram** and no contact card.

Creating a code voids the request's open attempt on any channel, and confirming binds the sender with the attempt's channel, ending the request's earlier binding on any channel.

The requester agent's `start_updates_link` takes `{ channel: "telegram" }` without a number; its connect-link page reuses the host's pending Telegram view, which reads the same `lineNumber` and `message`.

## 3. Linking

A guest's Telegram attempt completes exactly as a host's (`host-telegram-channel` design 6): `telegramLinking` finds the code in `/start <code>` or in the text, and `receiveLinkCode` completes the attempt only when its channel is `telegram` and the update came from a private chat, sealing the sender, the chat and the display name. A code arriving on another channel voids the attempt. As for hosts, no reply goes out on arrival; the bot's first message is the welcome after **Confirm and link** (`REQUESTER_LINK_TEXTS.linked`).

A bare `/start` from a sender with no active Telegram binding of either kind still gets the unlinked-sender reply. From a sender with an active Telegram guest binding it does nothing: it is the bot's Start button, pressed again.

## 4. Routing

The receipt job sends a Telegram `text` or `command` receipt through `guestRoute` as it does an iMessage one. The hash namespace (`telegram:<id>`) keeps channels apart, so only Telegram guest bindings match. A sender with both a host binding and guest bindings on Telegram gets the same choice between conversations as on iMessage (#137). A forwarded guest message enters the requester discussion with the `[Telegram] ` prefix, and the turn's reply is queued on the binding's channel.

A `callback` receipt never routes to a guest, since guests get no buttons: it follows the host path, which answers "Not linked" to anyone without a host binding.

## 5. Ending

**Unlink Telegram** ends the binding and suppresses unsent guest messages, as for iMessage. A `my_chat_member` update with status `kicked` (the guest blocked the bot) ends every active guest binding of that sender as unlinked, with its queued messages suppressed as `blocked`, and then follows the host path, which ends a host binding of the same sender. A guest row Telegram refuses with `403` (category `blocked`) ends the binding it went to the same way.

## 6. What guests do not get

Inline buttons are added only to host rows. The typing indicator and the 👍 reaction are host conveniences (`host-telegram-channel` design 8) and stay so: a guest's message starts a turn and gets its reply. Telegram has no window, so a guest's Telegram rows are never suppressed as `window_closed`. The contact card stays iMessage only. Messages are plain text, with no `parse_mode`.

## Risks

- Bot chats are stored on Telegram's servers and are not end-to-end encrypted; the card says so before linking.
- A guest who blocked the bot and starts it again must link again from the booking page.
