# Proposal

Tracking issue: #117

## Why

Guests can follow a request only by email, on the booking page, or in iMessage ([`guest-flow-completion`](../guest-flow-completion/proposal.md) D1). A guest without iMessage, such as an Android user, has no messaging option. Hosts already link WhatsApp ([`host-whatsapp-channel`](../host-whatsapp-channel/proposal.md)), whose non-goals left "requester WhatsApp" out. Issue #117 asks to bring guests in on WhatsApp with the pieces the host channel already built.

[`imessage-number-registration`](../imessage-number-registration/proposal.md) made every iMessage link start ask for the person's number and register it as a Photon project user, because Photon's shared lines deliver only registered users' messages. It kept WhatsApp without a number. This change asks for the number on every WhatsApp start too, so both channels register the person the same way before a link code.

## What Changes

- **Get updates in WhatsApp.** The booking page's waiting card offers **Get updates in WhatsApp** wherever WhatsApp is configured (`PHOTON_WHATSAPP_NUMBER`), beside **Get updates in iMessage** where iMessage is. It asks for the guest's number, registers it, makes the `FMAT-` code and opens `wa.me` with the guest link message. Confirm and link, This isn't me, Cancel and Unlink WhatsApp work as for iMessage.
- **Guest WhatsApp binding.** A guest binding records its channel. Guest WhatsApp messages route to the request's requester discussion with the `[WhatsApp] ` prefix, and guest notices and replies go out on WhatsApp.
- **24-hour window for guests.** Inside Meta's window the guest gets plain text. Outside it, the guest's WhatsApp notice or reply is suppressed with `window_closed`, as a host's is, and no template is queued: there are no guest templates. Booking emails and the booking page still carry every update. No reply buttons go to guests.
- **Numbers for WhatsApp everywhere.** The host's `/app` link step, the Connect WhatsApp card, the landing's `/?flow=whatsapp` start and the guest's **Get updates in WhatsApp** ask for the number first and register it with Photon. The WhatsApp line number stays `PHOTON_WHATSAPP_NUMBER`; Photon's assigned iMessage number is not stored for a WhatsApp attempt.
- **Scope change.** Requester messaging over WhatsApp, a non-goal of `host-whatsapp-channel`, is now in scope for guest updates. The PRD and the decision log say so.

## Decisions

Taken on 2026-11-04 in the session that wrote this change, from the user's request on issue #117. They have had no teammate review yet; the tasks' **Teammate review** box covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | Guest binding record ([design 1](design.md#1-records)) | A `channel` column (`imessage` default, `whatsapp`) on `requester_imessage_bindings`, and `imessage_links_request_channel` widened to allow `whatsapp` on a request's attempt. Rejected: a `requester_whatsapp_bindings` copy, which would duplicate the routing, unlink, move and cleanup paths, and could not keep "one active guest binding per request" in one index |
| D2 | Guest window ([design 3](design.md#3-the-24-hour-window)) | Inside 23 hours 50 minutes of the guest's last message (the link message counts), plain text. Outside it, the notice or reply is suppressed with `window_closed` and nothing else is sent. Rejected: guest templates, which need Meta review and would duplicate what booking emails already carry |
| D3 | Numbers for WhatsApp ([design 4](design.md#4-numbers-for-whatsapp)) | Every WhatsApp link start (host link step, Connect WhatsApp card, landing start, guest card) asks for the number and registers it with `photonRegistrar` before the code, as iMessage does. A missing or malformed number is `invalid_input`; a refused or lost registration is `unavailable_configuration`, shown as "could not register". The attempt keeps no `line_number`; the screens address `PHOTON_WHATSAPP_NUMBER`. This reverses `imessage-number-registration`'s "WhatsApp attempts take no number" |
| D4 | Guest card channels ([design 2](design.md#2-the-guest-card)) | One card, one link at a time: **Get updates in iMessage** and **Get updates in WhatsApp** where each is configured. A new code or binding on one channel replaces the other's. Telegram stays host-only. No contact card on WhatsApp |

## Capabilities

### New Capabilities

- `guest-whatsapp-channel`: a guest links WhatsApp to a request, gets notices and replies there inside the 24-hour window, and writes back into the request's discussion.

### Modified Capabilities

- `imessage-number-registration`: the number is asked and registered before every WhatsApp link code too.

## Impact

- `supabase/schemas/app/tables/requester_imessage_bindings.sql`, `imessage_links.sql` and one generated migration.
- `lib/server/requester-imessage-links.ts`, `requester-imessage-bindings.ts`, `imessage-receipts.ts`, `imessage-outbox.ts`, `revised-requests.ts`, `requester-routes.ts`, `imessage-links.ts`, `imessage-start.ts`, `imessage-routes.ts`; `lib/contracts/requester-imessage.ts`.
- The guest card in `apps/web/app/_components/requester/cards.tsx`; the link step, Connect card and landing start number screens.
- The PRD's channel paragraph, the guest and host UX documents, provider setup and the decision log, with their `ko/` mirrors.
- Each WhatsApp link start now spends one Photon project user (Free plan: 10).
