# Design

## Context

The guest iMessage link ([`guest-flow-completion`](../guest-flow-completion/design.md) design 1 to 4) already stores its attempt in `app.imessage_links` (owned by `request_id`), binds the confirmed sender in `app.requester_imessage_bindings`, routes the guest's messages by the sender's keyed hash, and sends notices and turn replies through `app.imessage_outbox`. The host WhatsApp channel ([`host-whatsapp-channel`](../host-whatsapp-channel/design.md)) added a `channel` column to links, bindings, receipts and outbox rows, hashed WhatsApp senders in their own namespace, and checks Meta's 24-hour window at dispatch (design 7). Two pieces kept guests on iMessage: the check `imessage_links_request_channel` and a binding table without a channel.

## Goals / Non-Goals

**Goals:** a guest links WhatsApp from the booking page; their messages reach the request's discussion; notices and replies go out on WhatsApp inside the window; every WhatsApp start registers the number with Photon.

**Non-goals:** guest WhatsApp templates; reply buttons for guests; guest Telegram; a guest linking iMessage and WhatsApp on one request at once; renaming `requester_imessage_bindings`.

## 1. Records

`requester_imessage_bindings` gains `channel` (`imessage` default, `whatsapp`). Existing rows are iMessage. The binding's channel decides the outbox row's channel: `recordOutbound` reads it for a row that names a requester binding, as it reads a host binding's. A binding moved to a revised request keeps its channel.

`imessage_links_request_channel` becomes `request_id IS NULL OR channel IN ('imessage', 'whatsapp')`. A new check, `imessage_links_line_number_channel`, keeps `line_number` on iMessage attempts only, since Photon's assigned number is an iMessage pool number.

Rejected: a separate `requester_whatsapp_bindings` table. Routing (`guestRoute`), unlink, the revised-request move, the outbox's unlink suppression, notice enqueueing and the cleanup function would each need a second path, and "one active guest binding per request" would need a cross-table rule. The sender hashes already keep the channels apart: a WhatsApp sender is hashed as `whatsapp:<digits>`, so an iMessage receipt never matches a WhatsApp binding.

## 2. The guest card

`GET /api/requests/{bookingId}/imessage` answers with each configured channel:

- `none` carries `lineNumber` (iMessage, or `""`) and `whatsappNumber` (digits, or null). The card shows **Get updates in iMessage** where `lineNumber` is set and **Get updates in WhatsApp** where `whatsappNumber` is.
- `pending`, `received` and `linked` carry `channel`. A WhatsApp `pending` addresses `whatsappNumber`: on a phone the card opens `wa.me` at once and offers **Open WhatsApp**; elsewhere it shows the number, the message, **Copy**, a QR code of the `wa.me` link and **Open WhatsApp** (WhatsApp Web or the desktop app).
- A WhatsApp `linked` line says "WhatsApp linked" with **Unlink WhatsApp** and no contact card. `request.imessage_contact_card.share` refuses a WhatsApp binding.

`request.imessage_link.create` takes `{ channel?: "imessage" | "whatsapp", number }`. A channel the deployment has not configured is `unavailable_configuration`. Creating a code voids the request's open attempt on either channel, and confirming binds the sender with the attempt's channel, ending the request's earlier binding on either channel (one active binding per request).

The guest link message (`Get Find Me a Time updates: FMAT-…`) and the received reply are the same on both channels.

## 3. The 24-hour window

At dispatch, a row that names a requester binding takes its window from that binding's `last_inbound_at`, as a host row takes it from the host binding (host-whatsapp-channel design 7, 23 hours 50 minutes). Confirming sets `last_inbound_at` to the link message's receipt time, so the welcome goes out inside the window; each routed guest message updates it, and a move to a revised request starts the new binding's window at the move, which a guest message causes.

Outside the window a guest WhatsApp row (notice, turn reply, closed notice) is suppressed with `window_closed`. `queueTemplate` already queues templates only for host bindings, so nothing else is sent. A send Meta still refuses with 131047 ends `failed` with `window_closed` the same way.

Rejected: guest templates. Each template needs Meta's review and a body that carries nothing private; the booking emails ([`requester-email-channel`](../requester-email-channel/proposal.md)) and the booking page already carry every status change, so a template would only say "check your email".

Guests get plain text only: buttons are added only to host rows (`BUTTON_KINDS` with a host binding's command), and guest notices carry none.

## 4. Numbers for WhatsApp

`imessage.link.create` (`{ channel: "whatsapp", number }`), `request.imessage_link.create` and `POST /api/imessage/start` (`{ channel: "whatsapp", number }`) require the number for WhatsApp as for iMessage; Telegram still takes none. After the attempt limits pass, `registeredLineNumber` normalizes and registers it with `photonRegistrar` exactly as for iMessage, and the same outcomes apply: missing or malformed is `invalid_input`, refused or lost is `unavailable_configuration`. The assigned number in Photon's answer is discarded for WhatsApp, and the attempt's `line_number` stays null; the screens address `PHOTON_WHATSAPP_NUMBER`.

Why register for WhatsApp at all: the shared-line rule that drops unregistered senders ([`imessage-number-registration`](../imessage-number-registration/proposal.md#why)) is documented for iMessage. Whether Photon applies the same rule to a WhatsApp Business line on the Free plan is not verified; registering first makes both channels behave the same and costs one project user. This is the reversal of `imessage-number-registration` design 1's "WhatsApp attempts take no number".

The screens reuse `NumberForm`. The heading names the channel ("Which number do you use for WhatsApp?"); each channel's number is kept for the visit, so a new code on the same channel needs no new entry.

## Risks

- Every WhatsApp start now spends a Photon project user, so the Free plan's 10 users run out sooner.
- Whether Photon requires, accepts or ignores a users-API registration for WhatsApp Business senders is unverified.
- A guest who has not written for a day gets nothing on WhatsApp until they write again; the email still arrives.
