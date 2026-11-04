# Design

## Context

The host channel has two transports today:
- **iMessage** ([`host-imessage-channel`](../host-imessage-channel/design.md)), through Photon Spectrum.
- **WhatsApp Business** ([`host-whatsapp-channel`](../host-whatsapp-channel/design.md)), also through Photon Spectrum.

Both share one signed webhook, one receipt and job pipeline, one outbox and the four `imessage_*` tables with a `channel` column.

WhatsApp is out of action:
- On 2026-11-03 Meta disabled the WhatsApp Business Account.
- On 2026-11-04 the WhatsApp number was removed from production.

On 2026-11-04 the user created the bot `@findmeatime_bot` and put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in the local `.env`.

This design read these sources on 2026-11-04:
- Photon's Telegram provider pages;
- `@spectrum-ts/telegram` 12.14.0 (MIT) from its npm tarball;
- `@spectrum-ts/core` 12.14.0;
- the Telegram Bot API reference.

No Telegram update has reached the service yet.

## Goals / Non-Goals

**Goals:**
- A host on any device can link a private Telegram chat with the bot. They can then use it as they use iMessage: summaries, discussion, revision, decisions and setup.
- Linking keeps the iMessage rule: the host writes first from their own account, and the browser confirms.
- Decisions get buttons bound to the exact proposal.

**Non-Goals:**
- Requester messaging.
- Groups, channels and Telegram Business connected bots.
- Mini Apps.
- Telegram Login.
- Payments.
- Phone-number collection.
- Replacing iMessage or WhatsApp.

## Decisions

### 1. Transport

The service calls the Bot API directly: `POST {TELEGRAM_API_URL ?? "https://api.telegram.org"}/bot{TELEGRAM_BOT_TOKEN}/{method}` with a JSON body. Each call has a 10-second timeout. A response is accepted when `ok` is true; otherwise its `error_code`, `description` and `parameters.retry_after` are read (design 9). The client lives in `lib/server/telegram.ts` and is reached only through the messaging transport, so the messaging gate of Phase 6 still decides whether anything is sent.

`@spectrum-ts/telegram` was the first candidate, since every other channel runs through Spectrum. It was rejected because of how its updates arrive. In cloud mode its `createClient` registers the bot's webhook at Photon's relay (`https://<project-slug>.spctrm.dev/telegram`). The relay then hands each update to the application over a WebSocket that `Spectrum()` holds open (`wss://fusor-ws.spectrum.photon.codes/v1/subscribe`). That doesn't fit our runtime, for two reasons:
- A Vercel Function cannot hold the socket between requests.
- An update consumed from the in-process stream has no durable receipt before it is acknowledged, which is the property iMessage D1 kept the application-owned adapter for.

Running a long-lived worker just for Telegram was also rejected. The application has no such process, and the Bot API's own webhook already gives retries.

The Bot API itself needs no SDK. A dependency would add only types, which the parser defines for the fields it reads.

### 2. Webhook

`agent/channels/telegram.ts` serves `POST /telegram/webhook` on the agent service, as `agent/channels/photon.ts` serves the Photon webhook. A request is processed only when all of these hold:
1. `TELEGRAM_WEBHOOK_SECRET` is set, and the `X-Telegram-Bot-Api-Secret-Token` header equals it, compared in constant time. Otherwise the answer is `401`.
2. The body is at most 256 KB of JSON with a numeric `update_id`. Otherwise the answer is `400`, and Telegram drops it.
3. The receipt is stored. Otherwise the answer is `500`, and Telegram retries.

The secret is 32 or more URL-safe characters, generated once by the operator. Telegram echoes it in that header and sends no other signature.

Only `message` and `callback_query` updates are stored; every other update (`edited_message`, `my_chat_member` …) is answered `200` with nothing stored, except `my_chat_member` with status `kicked`, which is stored so blocking the bot ends the binding (design 9). Telegram keeps undelivered updates for 24 hours and retries with backoff; a duplicate `update_id` meets the receipt's unique key and is answered `200` with no new job, as a duplicate Photon delivery is.

`scripts/telegram-webhook.mjs` (`npm run telegram:webhook`) calls:
- `setWebhook` with `url` `https://findmeatime.com/telegram/webhook`, `secret_token`, `allowed_updates` `["message", "callback_query", "my_chat_member"]` and `max_connections` 10;
- then `setMyCommands` (design 8);
- then `getWebhookInfo`, and prints the result without the token.

It refuses to run unless the URL's host is the identified production host. Registering is an operator step, like registering the Photon webhook.

### 3. Sender identity

For a `message` update, the sender is `message.from.id`. For a `callback_query`, it is `callback_query.from.id`. Either way it is a positive integer, stored as its decimal string. The update counts only when all of these hold:
- `chat.type` is `private` (for a callback, the chat of `callback_query.message`);
- `chat.id` equals the sender;
- `from.is_bot` is false.

Anything else, including groups, supergroups, channels and messages from other bots, gets no receipt.

The ID is hashed as `telegram:<id>` under the existing sender key, so it never matches an iMessage or WhatsApp hash, and sealed for replies.

Telegram does not reveal a user's phone number to a bot, and this channel never asks for it. What the browser shows for confirmation is the sender's `first_name` and, when present, `@username`. They are sealed with the receipt and shown as the host's own profile, for example "Dohyeon (@dohyeon)". A text message's body is never parsed for an identity.

### 4. Records

The `channel` checks of `imessage_receipts`, `imessage_links`, `imessage_bindings` and `imessage_outbox` become `IN ('imessage', 'whatsapp', 'telegram')`. The constraints the WhatsApp change added stay as they are:
- a fallback attempt is iMessage;
- a template row is WhatsApp;
- a guest's attempt is iMessage.

A Telegram receipt's `message_id` is `update:<update_id>`, unique per bot, since a callback has no message of its own. Its `content_type` is `text`, `command` or `callback`. A binding adds nothing new: its `sender_ciphertext` holds the user ID, and the display name lives on the link attempt that confirmed it.

The migration is generated with `supabase db schema declarative sync --no-apply`. It replaces three check constraints and drops no table, column or row.

### 5. One channel per host

Unchanged from Phase 9 D5, across three channels. The binding index is per host, so a second active binding cannot exist. **Confirm and link** ends the earlier binding in the same transaction, and whatever was still waiting or queued for it becomes `suppressed` with category `replaced`. Before the tap, the card names the channel being replaced: "This replaces your iMessage link."

### 6. Linking

**Connect Telegram** creates an attempt with channel `telegram` and the same `FMAT-` code, expiry, attempt limits and confirmation window as iMessage D5. It then opens `https://t.me/findmeatime_bot?start=<code>` in the same tab, where `<code>` is the code as created; Telegram allows 64 characters of `A–Z a–z 0–9 _ -`.

- **On a phone,** the link opens Telegram at the bot with **Start**. The tap sends `/start <code>` from the host's account.
- **On a computer,** the card shows **Open Telegram** (the same link), a QR code of it and **Copy**. A host who opens the bot without the link can send the code as text, which links the same way.

A receipt whose text is `/start <code>` or the bare code, from a private chat, completes the pending attempt with that code only when the attempt's channel is `telegram`. A code arriving on another channel voids the attempt, as Phase 9 D6 does. The sender and their display name are then shown in the browser for **Confirm and link**. Until the tap, the sender has no host authority, and the linking message never reaches the model or a transcript.

After confirmation, the welcome is the bot's first message. It is a reply in a chat the host started, so Telegram delivers it. `/start` with no payload, or from a sender with no attempt, gets the unlinked-sender reply (counted per channel), which points to `findmeatime.com/app`.

**The device rule (D7)** extends `channelOffer` and `shownChannel` in `lib/contracts/messaging-channel.ts` to a list of configured channels. Telegram is configured when `TELEGRAM_BOT_USERNAME` is set.

| Device | First channel | Switches offered |
|---|---|---|
| Android | WhatsApp if configured, else Telegram | The other of the two, if configured |
| iPhone, iPad, Mac | iMessage | Telegram, then WhatsApp, each if configured |
| Other computers | The host's answer to "Which app do you use on your phone?" | The others |

A switch reads "Use Telegram instead". The question lists only configured channels; with one configured, it is skipped. `/?flow=telegram` picks Telegram on the landing.

### 7. Inline buttons

A summary that asks the host to decide carries an inline keyboard. These are the summaries "proposal waiting" and "agreed proposal", and the setup review. As implemented, the reply to `request <ref>`, `review` or **Show details** carries the same keyboard while that request has an agreed proposal awaiting approval, and the settings review carries **Confirm settings** only when it ends with its confirm command.

| Button | `callback_data` | Command it names |
|---|---|---|
| **Approve** | `a:<ref>-<version>` | `approve <ref>-<version>` |
| **Decline** | `d:<ref>-<version>` | `decline <ref>-<version>` |
| **Show details** | `s:<ref>` | `request <ref>` |

The setup review's single button is **Confirm settings**, with `c:<settingsRef>`. Every value stays under 64 bytes.

A `callback_query` receipt follows the same steps as a typed command:
- it is admitted only from the bound sender;
- it is parsed into the command it names, never from the button's label;
- it runs through the same command path, which checks the request, the version and the proposal's current state.

The service answers every callback with `answerCallbackQuery` within the receipt job, so Telegram stops its spinner:
- an empty answer on success;
- "This proposal has changed. Here is the current one." for a stale version, followed by the current summary;
- "Not linked" for any other sender.

Approval in the host's own words (iMessage D23) also works on Telegram. Buttons only add a third way, beside typing the command and saying it.

**Retiring buttons.** The outbox records the Telegram `message_id` of each message it sends with buttons, against the request and version. When that proposal is decided, withdrawn or superseded, it queues an `edit_markup` row that removes the keyboard. Telegram allows edits for 48 hours, and a failed edit is not retried past that, because a stale tap is still refused. The message text is not edited: the conversation keeps what was said.

### 8. Telegram extras

- **Command menu.** `setMyCommands` registers `requests`, `review`, `help` and `stop` with short descriptions. The parser accepts every command with or without a leading `/` and an optional `@findmeatime_bot` suffix, so a menu tap and typed text both work. `help` lists the same text as `HELP_TEXT`, with Telegram's buttons mentioned.
- **Typing.** While a receipt's agent turn runs, the dispatcher sends `sendChatAction` `typing` once at the start and every 5 seconds until the reply is queued, at most 12 times. A failure is ignored.
- **Reaction.** A message that only says thanks gets a 👍 `setMessageReaction` and starts no turn, as an iMessage thanks gets a tapback. A bot cannot mark a message read, so no other message gets a signal.
- **Silent delivery.** The outbox sends with `disable_notification: true` for notices that need nothing from the host: a requester's reply that needs no decision, a booking confirmation and setup progress. Summaries that need a decision, and every reply to the host's own message, notify normally.
- **Plain text.** Messages are sent without `parse_mode`, so text from requesters can never inject formatting or links. References stay readable as plain words.
- **Not used:** Mini Apps (`/app` already serves this), Telegram Login (Google stays the identity), groups and channels, `request_contact`, payments, and `protect_content`, since a host may want to forward a summary to themself.

### 9. Transport and outbox

The outbox states, the per-recipient ordering and the never-resend rule for `uncertain` follow iMessage D9. Telegram's results map as follows.

| Bot API result | Outbox outcome |
|---|---|
| `ok: true` | `accepted`, with Telegram's `message_id` kept for button retirement |
| `403` (blocked by the user, user deactivated) | `rejected` with category `blocked`; the binding ends as if the host sent `stop`, and its queue is suppressed |
| `400` "chat not found", "message is too long" | `rejected` |
| `429` | `unavailable`, retried after `parameters.retry_after` seconds |
| `5xx`, a reset or a timeout after the body was sent | `uncertain`, never resent |
| A network error before the request was written | `unavailable` |

A `my_chat_member` update with `new_chat_member.status` `kicked` ends the binding the same way. Telegram limits a bot to about one message per second in one chat, so the dispatcher spaces consecutive sends to one chat by at least one second. Text over 4,096 characters is split at paragraph boundaries into ordered rows.

The loopback stand-in (`tests/integration/support/fake-photon.ts`, or a sibling `fake-telegram.ts`) answers `sendMessage`, `editMessageReplyMarkup`, `answerCallbackQuery`, `sendChatAction`, `setWebhook`, `setMyCommands` and `getWebhookInfo`. It also has switches for `403`, `429` and a dropped connection.

### 10. Reused behavior

These work as in iMessage and Phase 9 D11:
- commands and request references;
- forwarding into the shared discussion, with a `[Telegram] …` transcript prefix;
- the five summaries, with no window to respect;
- setup over chat, with the welcome and the Calendar link;
- unlinked-sender replies, counted per channel;
- admission and ordering;
- retention (D14);
- messaging only from the identified production deployment.

The host channel's instruction fragment names Telegram's prefix and its buttons. **Add to contacts** is not offered, since a bot is opened by its username.

### 11. Privacy

Bot chats use Telegram's client–server encryption, not end-to-end encryption, and are stored on Telegram's servers. Before **Confirm and link**, the card says: "Telegram keeps bot chats on its servers. Find Me a Time sends your request summaries here." The privacy policy gains Telegram as a processor for hosts who link it, beside Photon. `stop`, `/stop`, unlinking in `/app` or blocking the bot ends the binding. The service never deletes Telegram's copy of the chat, since a bot cannot delete messages older than 48 hours; the policy says so.

## Risks / Trade-offs

- **The bot token is a single credential.** Anyone holding it can send as the bot and read updates. It goes only into Vercel Production and the operator's local `.env`, and @BotFather's `/revoke` rotates it. The webhook secret is separate, so a leaked webhook URL alone cannot inject updates.
- **No webhook signature beyond the secret header.** Telegram does not sign bodies, so the secret is the only check. It is long, random, compared in constant time and never logged.
- **Buttons invite quick taps.** A one-tap **Approve** could be pressed by mistake. It approves only the version shown, which the host has already reviewed, and the web keeps the same one-click approval. No confirmation step is added.
- **Telegram is unfamiliar to some hosts.** It stays an option beside iMessage, and the web works without any channel.
- **Separate transport.** Telegram does not share Photon's receiver, so there are two webhook routes to monitor. They share everything after the receipt.

## Open Questions

- Whether iPhone hosts should see **Use Telegram instead** at all, or only Android and other computers.
- The bot's profile text and picture, set by the user in @BotFather.
- Whether the setup review should get buttons for each section or only **Confirm settings**.
