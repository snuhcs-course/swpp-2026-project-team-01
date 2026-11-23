# Proposal

Tracking issue: #227

## Why

Guests follow a request by email, on the booking page, or in iMessage or WhatsApp ([`guest-whatsapp-link`](../guest-whatsapp-link/proposal.md)). WhatsApp through Photon proved too unstable, so #221 hides it on every screen unless `WHATSAPP_OFFERED=1`. A guest without iMessage, such as an Android user, is left with email only. Hosts already link Telegram ([`host-telegram-channel`](../host-telegram-channel/proposal.md)), whose non-goals left "requester messaging" out, and `guest-whatsapp-link` D4 kept Telegram host-only. This change brings guests in on Telegram with the bot, start link, webhook and Bot API transport the host channel already built.

## What Changes

- **Get updates in Telegram.** The booking page's waiting card offers **Get updates in Telegram** wherever Telegram is configured (`TELEGRAM_BOT_USERNAME`), beside the other configured channels. It asks for no number: it makes the `FMAT-` code and opens `telegram.me/<bot>?start=<code>`. On a phone Telegram opens at the bot; on a computer the card shows the link's QR code, **Open Telegram** and **Copy**. The guest's Start links it at once, with no **Confirm and link** (D7); Cancel and **Unlink Telegram** work as for iMessage.
- **Guest Telegram binding.** A guest binding may be on Telegram, and keeps the sender's sealed Telegram name to show in place of a user ID. Guest Telegram messages route to the request's requester discussion with the `[Telegram] ` prefix, and guest notices and replies go out on Telegram.
- **Through the agent.** The requester agent's `start_updates_link` takes `channel: "telegram"` without a number, and its connect-link page shows the bot's start link.
- **Ending.** **Unlink Telegram**, blocking the bot, or a send Telegram refuses as blocked ends the guest's binding.
- **Copy.** The lines that name guest channels mention Telegram.
- **Scope change.** Requester messaging over Telegram, a non-goal of `host-telegram-channel`, is now in scope for guest updates. The PRD and the decision log say so.

## Decisions

Taken on 2026-11-16 in the session that wrote this change, from the user's request to let guests get updates in Telegram after WhatsApp was hidden. They have had no teammate review yet; task 5.1 covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | Records ([design 1](design.md#1-records)) | `requester_imessage_bindings.channel` and the request attempt check `imessage_links_request_channel` accept `telegram`; the binding gains `sender_name_ciphertext`, cleared with the sender by the existing `clear_sender_name` trigger. Rejected: a `requester_telegram_bindings` table, for the reasons of `guest-whatsapp-link` D1 |
| D2 | Guest card ([design 2](design.md#2-the-guest-card)) | **Get updates in Telegram** where `TELEGRAM_BOT_USERNAME` is set. No number is asked or registered, since Telegram never reveals one and Photon is not involved. The pending card names the bot and the code as the host's Telegram card does. One link at a time across the three channels |
| D3 | Linking ([design 3](design.md#3-linking)) | As `host-telegram-channel` D6: `/start <code>` or the bare code from the guest's private chat completes the request's Telegram attempt; a code from another channel voids it. No reply goes out on arrival; the bot's first message is the welcome after **Confirm and link**. D7 binds on arrival instead |
| D4 | Routing ([design 4](design.md#4-routing)) | A Telegram text or `/` command from a sender with an active Telegram guest binding is routed as a guest iMessage is, with the `[Telegram] ` prefix, including the choice between several conversations. A button tap never routes to a guest. A bare `/start` from a guest-linked sender is ignored |
| D5 | Ending ([design 5](design.md#5-ending)) | A blocking update ends every active guest binding of that sender as **Unlink** does, with the queued messages suppressed as `blocked`; a send refused as `blocked` ends the binding it went to the same way |
| D6 | What guests do not get ([design 6](design.md#6-what-guests-do-not-get)) | No inline buttons, typing indicator, thanks reaction, contact card or window on Telegram for guests. Plain text only, as for hosts |
| D7 | Linking on Start (team, 2026-11-23; #383; [design 3](design.md#3-linking)) | As `host-telegram-channel` D14: the team decided that nobody else is likely to take over a guest's code, so `/start <code>` or the bare code from the guest's private chat binds the sender to an open request at once, with no **Is this your Telegram?** step. The welcome is the bot's first message, and the card moves to "Telegram linked" with **Unlink Telegram**. While the code waits, the card says where Telegram keeps the chat. A code for a closed request binds nothing. The connect link from `start_updates_link` says linked once the Start lands. iMessage and WhatsApp guests keep **Confirm and link** |

## Capabilities

### New Capabilities

- `guest-telegram-channel`: a guest links Telegram to a request from the booking page or through their agent, gets notices and replies there, writes back into the request's discussion, and unlinks or blocks the bot to stop.

### Modified Capabilities

None in `openspec/specs/`. `guest-whatsapp-link` and `host-telegram-channel` are not archived yet, so this change cannot modify them; `guest-whatsapp-link` D4's "Telegram stays host-only" is superseded here.

## Impact

- `supabase/schemas/app/tables/requester_imessage_bindings.sql`, `imessage_links.sql`, `triggers/imessage_clear_sender_name.sql` and one generated migration; `supabase/tests/guest_whatsapp.test.sql`.
- `lib/contracts/requester-imessage.ts`; `lib/server/requester-imessage-links.ts`, `requester-imessage-bindings.ts`, `revised-requests.ts`, `imessage-receipts.ts`, `imessage-outbox.ts`, `requester-routes.ts`, `connect-link-routes.ts`, `agent-requester-tools.ts`, `entry-documents.ts`.
- The guest card in `apps/web/app/_components/requester/cards.tsx`.
- The PRD's channel paragraph, the guest UX documents and the decision log, with their `ko/` mirrors.
