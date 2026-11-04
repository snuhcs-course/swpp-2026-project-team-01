# Proposal

Tracking issue: #111

## Why

Phase 9 ([`host-whatsapp-channel`](../host-whatsapp-channel/proposal.md)) gave Android hosts a private WhatsApp conversation. On 2026-11-03 Meta disabled the WhatsApp Business Account behind it, before the line had sent any message, for a "breach of terms of acceptable use". On 2026-11-04 `PHOTON_WHATSAPP_NUMBER` was removed from production, so the card offers iMessage only and Android hosts have only `/app` again ([provider setup](../../../documentations/technical_specification/03_provider_setup.md#whatsapp-business)).

On the same day the user created the Telegram bot `@findmeatime_bot` and asked for the host channel to be set up on Telegram. Telegram runs on Android, iPhone and desktop. A bot needs no business review, has no 24-hour window and sends no paid templates. It can message a user at any time after that user has started it, until the user blocks it. This change specifies a Telegram channel that works like the iMessage and WhatsApp channels.

## What Changes

- **Transport.** The Telegram Bot API, called directly: updates arrive at `POST /telegram/webhook`, and replies go out through `sendMessage` and the other Bot API methods. Photon Spectrum also has a Telegram provider (`@spectrum-ts/telegram` 12.14.0), but it delivers inbound updates only over a persistent WebSocket to Photon's relay (Fusor). Vercel Functions do not keep such a connection, and the in-process stream would lose the receipt-before-acknowledgment rule of iMessage D1.
- **Records.** The four `imessage_*` tables accept a third `channel`, `telegram`. Telegram senders are hashed in their own namespace. The one-active-binding index therefore covers all three channels.
- **Linking.** **Connect Telegram** creates the same `FMAT-` code and opens `https://t.me/findmeatime_bot?start=<code>`. Telegram shows **Start**, which sends `/start <code>` from the host's own account. The browser shows the Telegram name for **Confirm and link**. The bot never writes first.
- **Buttons.** A proposal summary carries inline **Approve** and **Decline** buttons bound to that request and proposal version, and **Show details**. A tap runs the same exact command as typing it. A tap on an older proposal is refused, and the buttons of a message whose proposal is decided or superseded are removed.
- **Telegram extras.** A command menu (`/requests`, `/review`, `/help`, `/stop`), the typing indicator while Thyme works, and silent delivery for updates that need no decision.
- **Reused behavior.** The rest works as on iMessage and WhatsApp: commands and references, approval in the host's own words, forwarding into the shared discussion, summaries, setup over chat, admission limits, ordered receipts, the outbox with uncertain sends, retention and messaging only in production.

## Decisions

The session that wrote this change took these decisions on 2026-11-04 at the user's request to set up the host channel on Telegram. They have had no teammate review yet; task 1.2 covers them. The [design](design.md) records the reasoning and the rejected options; the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-10--host-telegram-channel) lists them with how to change each.

| # | Decision | Choice |
|---|---|---|
| D1 | Transport ([design 1](design.md#1-transport)) | The Telegram Bot API over HTTPS, with no SDK: `fetch` to `https://api.telegram.org/bot<token>/<method>` in a new `lib/server/telegram.ts`, loaded only by the production transport. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` name the bot; `TELEGRAM_API_URL` points tests at a loopback stand-in. Rejected: Spectrum's Telegram provider, whose inbound path is a persistent Fusor WebSocket; eve's chat channels, for the reasons of iMessage D1 |
| D2 | Webhook ([design 2](design.md#2-webhook)) | `POST /telegram/webhook` on the agent service, beside `/photon/webhook`. It accepts a request only when `X-Telegram-Bot-Api-Secret-Token` equals `TELEGRAM_WEBHOOK_SECRET` (compared in constant time), stores a receipt keyed by the bot's `update_id` before answering `200`, and answers `401` otherwise. The webhook is registered with `setWebhook` (`allowed_updates`: `message`, `callback_query`, `my_chat_member`; `max_connections` 10) by `npm run telegram:webhook`, an operator step |
| D3 | Sender identity ([design 3](design.md#3-sender-identity)) | `message.from.id` (or `callback_query.from.id`), the numeric Telegram user ID, as a decimal string. The update counts only when `chat.type` is `private`, `chat.id` equals the sender and `from.is_bot` is false. It is hashed as `telegram:<id>` under the existing key and sealed for replies. The browser shows the sender's first name and `@username`, sealed at the receipt, never a phone number |
| D4 | Records ([design 4](design.md#4-records)) | `telegram` is added to the `channel` checks of `imessage_receipts`, `imessage_links`, `imessage_bindings` and `imessage_outbox`. A receipt's message ID is `update:<update_id>`. The table names stay, as Phase 9 D4 decided |
| D5 | One channel per host ([design 5](design.md#5-one-channel-per-host)) | As Phase 9 D5, across three channels: confirming a sender ends the host's binding on any other channel and suppresses what was queued for it, after the card says so |
| D6 | Deep link ([design 6](design.md#6-linking)) | `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>`, where the `start` payload is the `FMAT-` code (letters, digits and `-`, within Telegram's 64 characters). The bot receives `/start <code>`. A `/start` without a payload gets the unlinked-sender reply. Desktops get **Open Telegram**, the link as a QR code and **Copy**. A code from another channel voids the attempt. No service-sent fallback code |
| D7 | Which device gets which channel ([design 6](design.md#6-linking)) | Telegram is offered on every device. Android gets WhatsApp when it is configured, with **Use Telegram instead**, and Telegram otherwise. iPhone, iPad and Mac get iMessage with **Use Telegram instead** (and **Use WhatsApp instead** when configured). Other computers ask "Which app do you use on your phone?" among the configured channels. The link step after sign-in and `/?flow=telegram` before sign-in follow the same rule |
| D8 | Inline buttons ([design 7](design.md#7-inline-buttons)) | A summary that asks for a decision carries **Approve**, **Decline** and **Show details** as an inline keyboard. Each `callback_data` is `a:<ref>-<version>`, `d:<ref>-<version>` or `s:<ref>` (at most 64 bytes). A tap is parsed into the exact command it names and admitted like a typed command from the bound sender; it is answered with `answerCallbackQuery`. A tap whose version is not current is refused with "This proposal has changed", and approval still checks the proposal at decision time (Phase 4) |
| D9 | Retiring buttons ([design 7](design.md#7-inline-buttons)) | When a proposal is decided, withdrawn or superseded, the outbox removes the buttons from every message that showed them (`editMessageReplyMarkup` with an empty keyboard). A failed edit is not retried past the message's 48-hour edit limit; a stale tap is still refused by D8 |
| D10 | Telegram extras ([design 8](design.md#8-telegram-extras)) | `setMyCommands` registers `requests`, `review`, `help` and `stop` in the bot menu (with the webhook script). A leading `/` is accepted on every command. `sendChatAction` `typing` runs while Thyme works. Notices that need no decision (a requester reply, a booking confirmation) are sent with `disable_notification`. Text is plain, with no `parse_mode`. Not used: Mini Apps, Telegram Login, groups and channels, contact requests, payments, `protect_content` |
| D11 | Delivery outcomes ([design 9](design.md#9-transport-and-outbox)) | The outbox states and the never-resend rule for uncertain sends follow iMessage D9. Bot API errors map: `403` (blocked, deactivated) to `rejected` with category `blocked`, which also ends the binding; `400` "chat not found" to `rejected`; `429` to `unavailable`, retried after `retry_after`; `5xx` and timeouts after the request was written to `uncertain`. At most one message per second per chat |
| D12 | Reused behavior ([design 10](design.md#10-reused-behavior)) | As Phase 9 D11 and D14, with a `[Telegram] …` transcript prefix: exact commands and references, approval in the host's own words, unlinked-sender replies counted per channel, the five summaries, setup over chat, admission and ordering, retention and production-only messaging. No window and no templates apply |
| D13 | Privacy ([design 11](design.md#11-privacy)) | Bot chats are not end-to-end encrypted and pass through Telegram's servers. The card says so in one sentence before **Confirm and link**, and the privacy policy names Telegram as a processor for hosts who link it. `stop`, `/stop` and blocking the bot end the binding |

## Conflicts resolved here

| Conflict | Resolution |
|---|---|
| **PRD non-goals.** Section 3 lists messaging channels other than iMessage and WhatsApp Business as out of scope | The PRD records the 2026-11-04 decision to add Telegram for hosts. Requester messaging, SMS, RCS, KakaoTalk, personal WhatsApp and group conversations stay out |
| **Rendered buttons do not authorize booking (PRD §10).** A rendered button label must not be assumed to authorize booking | An inline button is not a label the model reads: its `callback_data` names one request and proposal version, and the callback carries the bound sender's verified user ID. It is the exact command `approve <ref>-<version>`, checked like the web button. The PRD names this case |
| **The device rule of Phase 9 D7.** Android gets WhatsApp alone | Android gets Telegram when WhatsApp is not configured, and a switch to Telegram when it is (D7) |
| **Photon as the only messaging provider.** Phases 6 and 9 run every channel through Photon | Telegram does not: Photon's Telegram path needs a long-lived WebSocket (D1). The Photon receiver is unchanged |

## Capabilities

### New Capabilities

- `host-telegram-channel`: the Telegram webhook and its secret, Telegram sender identity, linking by a `t.me` start link with browser confirmation, the channel offered by device, one channel across three, inline decision buttons and their retirement, Telegram extras, delivery outcomes, privacy and the behavior reused from the iMessage channel.

### Modified Capabilities

None in `openspec/specs/`. `host-imessage-channel` and `host-whatsapp-channel` are not archived yet, so this change cannot modify them; D5 and D7 are specified here.

| Specification | Closed in this change | Deferred, and where |
|---|---|---|
| [`chat-workspaces`](../../specs/chat-workspaces/spec.md) | "Messaging backpressure" and "Authority expires during delay" for Telegram; redaction of `FMAT-` codes in Telegram text | None |
| [`messaging-environments`](../../specs/messaging-environments/spec.md) | "Preview with copied provider credentials" and "Direct provider adapter invocation" for Telegram | None |
| [`durable-jobs`](../../specs/durable-jobs/spec.md) | Receipt and send jobs for Telegram under the existing fencing | None |

## Archive order

This change depends on `host-imessage-channel` and `host-whatsapp-channel` (their tables, the `channel` column and the device rule) and archives after both.

## Impact

- **New code:**
  - `lib/server/telegram.ts`: the update parser, sender normalization, the Bot API client, the error mapping and the callback parser.
  - `agent/channels/telegram.ts`: the webhook route.
  - `scripts/telegram-webhook.mjs`: `setWebhook` and `setMyCommands`.
  - The Telegram card states in `/app` and the link step.
- **Changed code:**
  - `lib/contracts/messaging-channel.ts`: a third channel and the device rule.
  - The outbox, which gains buttons, retirement, silent delivery and the typing indicator.
  - Links and receipts, which take Telegram's display name.
  - The command parser, which accepts a leading `/`.
  - Host instructions.
  - The stand-in, which answers the Bot API.
- **Schema:** the `channel` checks of the four `imessage_*` tables, generated through pg-delta. Nothing is dropped or recreated.
- **Dependencies:** none.
- **Systems:** the Telegram bot `@findmeatime_bot`. Left to the user (decision log, "Blocked on the user"):
  - the bot's profile;
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` on Vercel Production;
  - registering the webhook;
  - the shared-project migration;
  - the deploy.
- **Documents updated now:** the [PRD](../../../documentations/02_product_requirements.md), the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-10--host-telegram-channel), the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-10--host-telegram-channel) and the [provider setup](../../../documentations/technical_specification/03_provider_setup.md#telegram), with Korean mirrors.
- **Documents updated during implementation:**
  - the page list's *Channel link*;
  - the interfaces;
  - the host onboarding flow;
  - the user journeys;
  - the frontend architecture;
  - the agent configuration;
  - the privacy policy.
