# Proposal

Tracking issue: #489

## Why

On 2026-11-26 the team brought SMS back into scope ([PRD SMS decision](../../../documentations/02_product_requirements.md#target-users), [decision log](../../../documentations/technical_specification/08_decision_log.md#sms-channel-scope)). Every phone can send and receive SMS without installing or signing up for anything. iMessage reaches only Apple devices, WhatsApp is hidden in production since Meta disabled its account on 2026-11-03, and Telegram needs an app and an account. The Photon 10DLC campaign was started on 2026-11-25, and [#488](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/488) (PR #492, not merged yet) adds the consent checkbox and the policy clauses carriers check. This change specifies the channel itself, for hosts and for guests, working like the iMessage, WhatsApp and Telegram channels.

## What Changes

- **Transport.** SMS goes through Photon's Beta (2.0) API with a project API key, not the Stable Spectrum SDK: Spectrum 12.14.0 has no SMS provider. Inbound SMS arrives at a new `POST /photon/sms/webhook`, signed with Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`). The existing `/photon/webhook` (Spectrum's `X-Spectrum-Signature`) is unchanged.
- **Number.** One Photon US local number, `PHOTON_SMS_NUMBER`. The channel counts as configured only when the number, the API key and the webhook secret are all set.
- **Records.** The `imessage_*` tables, `requester_imessage_bindings`, `channel_usage_days` and the `channel_usage` function accept a fourth `channel`, `sms`. Senders are hashed as `sms:<E.164>`.
- **Linking.** **Connect SMS** (hosts), `/?flow=sms` (before sign-in) and **Get updates by text** (guests) show the SMS consent checkbox from #488, unticked, and **Get my code**, which works only after the box is ticked. Then the same `FMAT-` code opens Messages through the existing `sms:` deep link. The code binds the sender when it arrives (`link-on-code` D1). The service never texts first. No number is asked for and nothing is registered as a Photon shared user.
- **Keywords.** Photon answers HELP, START and STOP itself. The SMS channel never replies to them. An inbound opt-out keyword, or a send that Photon refuses because the recipient opted out, silently ends every SMS binding of that number, host and guest alike.
- **Consent record.** Each SMS binding keeps a consent record (sender hash, consent text version, time, how it ended) for four years after it ends, apart from the 30-day message deletion, so the opt-in can be proven to carriers.
- **Decisions name the reference.** A phone number can be spoofed, so an approval or decline by SMS needs the proposal's reference in the text. Approval in the host's own words stays on the other channels.
- **Device rule.** Android gets SMS when WhatsApp is not configured, instead of Telegram. Every device can switch to SMS. A host still has one messaging channel at a time, now across four.
- **SMS limits.** Plain text only, with no buttons, read marks, typing indicator, tapbacks or contact card. Thyme keeps SMS replies short, and a per-recipient daily cap bounds the cost.
- **Reused behavior.** Everything else works as on the other channels: exact commands and references, approval in the host's own words, summaries, setup over chat, admission, ordered receipts, the outbox with uncertain sends, 30-day retention and messaging only in production.

## Decisions

The session that wrote this change took these decisions on 2026-11-26. The user settled D2, D7 and D11; the rest follow the existing channels. None has had teammate review yet; task 1.1 covers D1–D15. The [design](design.md) records the reasoning and the rejected options.

| # | Decision | Choice |
|---|---|---|
| D1 | Transport ([design 1](design.md#1-transport)) | Photon Beta API over HTTPS with a project API key `PHOTON_SMS_API_KEY` (`pho_sk_…`), called with `fetch` from a new `lib/server/photon-sms.ts`, sender `PHOTON_SMS_NUMBER`, with an `Idempotency-Key` per outbox row. `PHOTON_API_URL` points tests at the loopback stand-in. Rejected: a Spectrum provider (none exists); a second Photon project |
| D2 | Audience (user) | Hosts and guests. SMS is a fourth host channel with the full conversation, and a guest update option on the booking page and through `start_updates_link` |
| D3 | Webhook ([design 2](design.md#2-webhook)) | `POST /photon/sms/webhook` on the agent service. It checks the Standard Webhooks signature under `PHOTON_SMS_WEBHOOK_SECRET` (`whsec_…`) within 300 seconds, keys the receipt by `webhook-id`, and stores it before answering `200` (iMessage D1). A bad signature gets `401`. An event that is not an inbound SMS is acknowledged and ignored |
| D4 | Sender identity ([design 3](design.md#3-sender-identity)) | The sender's E.164 number, compared exactly, hashed as `sms:<E.164>` under the existing key and sealed for replies. The browser shows it masked. Only direct (one-to-one) conversations count; group MMS is ignored |
| D5 | Records ([design 4](design.md#4-records)) | `sms` is added to every `channel` check and to `channel_usage`. Table names stay, as Phase 9 D4 decided |
| D6 | Linking and consent ([design 5](design.md#5-linking-and-consent)) | The card shows the #488 consent checkbox, unticked, and **Get my code**, disabled until it is ticked. The server refuses an SMS attempt without the current consent text version, and the attempt records that version and the time the request was received. After that, **Open Messages**, or on a computer the number, code, **Copy** and QR code, appear. The code is sent with `sms:<PHOTON_SMS_NUMBER>&body=` (iOS, Mac) or `?body=` (Android). A code from another channel voids the attempt. No service-sent fallback code |
| D7 | Countries (user) | Any country code is accepted. Delivery outside US and Canada is not documented by Photon, so each send's outcome is reported truthfully (D10), and the card makes no promise of delivery abroad |
| D8 | Device rule ([design 6](design.md#6-channel-offered-by-device)) | Android: WhatsApp when configured, otherwise SMS; Telegram and SMS as switches. iPhone, iPad, Mac: iMessage, with switches to every other configured channel including SMS. Other computers ask which app the host uses on their phone among the configured channels |
| D9 | Keywords and opt-out ([design 7](design.md#7-keywords-and-opt-out)) | Photon answers HELP, START and STOP. Inbound `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` (any case, whole message) end every SMS binding of that number, host and guest, with no reply. `HELP`, `INFO` and `START` get no reply from the service. A send rejected as opted out maps to category `blocked`, which also ends the binding. The words `stop` and `unlink` keep their meaning, but on SMS they stay silent |
| D10 | Delivery outcomes ([design 8](design.md#8-delivery-outcomes)) | The four outcomes of iMessage D9. Photon problem responses map: `401`/`403` to `provider_authentication`; opted-out recipient to `blocked`; invalid or unsupported number to `invalid_recipient`; other `4xx` to `provider_rejected`; `429` to `unavailable` with `Retry-After`; `5xx` or a lost answer after the request was written to `uncertain`. `accepted` means Photon took it, not that the phone got it |
| D11 | Content (user) | The same content as the other chats: names, times, places and the full Thyme conversation. Before the code is sent, the card says in one sentence that SMS is not end-to-end encrypted and that message and data rates may apply |
| D12 | SMS limits ([design 9](design.md#9-sms-limits)) | Plain text, no markup and no buttons. Thyme's SMS instructions ask for replies under 480 characters (three segments) unless the host asks for more. `PHOTON_SMS_DAILY_LIMIT` (default 40) caps outbound SMS per recipient in any 24-hour window, the limit notice included. The last allowed message becomes a notice pointing to findmeatime.com; later ones are suppressed until the window count drops, with at most one notice per 24 hours. Schedule pictures are answered in words |
| D13 | Reused behavior | As Telegram D12, with an `[SMS] …` transcript prefix and per-channel unlinked-sender counts. No window, no templates, no read marks, typing, tapbacks or contact card |
| D14 | Decisions by SMS ([design 10](design.md#10-decisions-by-sms)) | Caller ID can be spoofed, so an approval or decline by SMS takes effect only when the text contains the current proposal's reference (`approve <ref>-<version>`, alone or in the host's words). Otherwise Thyme replies with the exact text to send |
| D15 | Consent record ([design 4](design.md#4-records)) | A `sms_consents` row per SMS binding: sender hash, host or guest, consent version and time, end time and reason. Kept four years after the binding ends or the number opts out, then deleted. No number is stored |

## Conflicts resolved here

| Conflict | Resolution |
|---|---|
| **Telegram D7 device rule.** Android without WhatsApp gets Telegram | Android without WhatsApp gets SMS, with **Use Telegram instead** (D8). The host-telegram requirement is modified |
| **One messaging channel across three** | Across four (D8). The host-telegram requirement is modified |
| **iMessage and Telegram `stop`/`help` replies** | On SMS the service never answers these keywords, because Photon does (D9). Other channels are unchanged |
| **10DLC opt-in wording.** The campaign draft describes the number forms of #488 with an optional checkbox | SMS linking asks for no number, and the same checkbox gates **Get my code** (D6). Gating SMS on the box is allowed: the product stays usable without it. The campaign's opt-in text is rewritten to describe this card before it is submitted (task 6.2) |
| **Approval in the host's own words** (`host-imessage-channel`) | Not on SMS: decisions there need the reference (D14). Other channels are unchanged |
| **PRD and decision log consent wording.** Both said a person "enters their number and ticks" the box | Updated in this change: the box is ticked to get an SMS code; no number is entered for SMS |

## Capabilities

### New Capabilities

- `host-sms-channel`: the SMS webhook and its signature, SMS sender identity, linking by a texted code behind the consent checkbox, keyword and opt-out handling, delivery outcomes, SMS limits and daily cap, the privacy sentence, and the behavior reused from the other host channels.
- `guest-sms-channel`: guest SMS linking from the booking page and through the requester agent, routing of a guest's texts, and opt-out.

### Modified Capabilities

- `host-telegram-channel`: "Channel offered by device with Telegram" (Android without WhatsApp now gets SMS; SMS is a switch everywhere), and "One messaging channel across three" renamed to "…across four".
- `host-whatsapp-channel`: "Channel offered by device" (SMS among the switches; other devices choose among all configured channels).
- `meeting-requests`: "Agreement notice in the guest's linked chat" (SMS guests get it too, under the SMS limits).
- `host-schedule-lookup`: "Read-only host schedule lookup" (from the SMS chat too) and "Schedule image in the linked chat" (answered in words on SMS).
- `guest-telegram-channel`: "Guest Telegram linking" (one active guest binding across four channels).

## Archive order

This change depends on PR #492 (#488: the consent text and checkbox, `copy.ts` `smsConsent`), which must merge before task group 5, and on `link-on-code` (binding on arrival), after which it archives.

## Impact

- **New code:** `lib/server/photon-sms.ts` (Beta client, webhook verification, event parser, error mapping); `agent/channels/photon-sms.ts` (the route); the SMS states of the linking card, link step, landing start and booking-page card.
- **Changed code:** `lib/contracts/messaging-channel.ts` and `requester-imessage.ts` (a fourth channel, the device rule, the `[SMS] ` prefix); every `Record<StoredChannel>` text map in `channel-texts.ts`; the outbox (SMS transport, daily cap, no extras); links and receipts (consent record, opt-out keywords); `imessage-commands.ts` (silent stop/help on SMS); the agent tools' channel enums; host and requester instructions; the Photon stand-ins in `tests/`.
- **Schema:** the `channel` checks named above, consent columns on `imessage_links`, a new `sms_consents` table with its cleanup, and the `channel_usage` function, through pg-delta. Nothing is dropped.
- **Dependencies:** `standardwebhooks` for signature checks.
- **Systems (left to the user):** buying the Photon SMS number; the 10DLC campaign's approval; creating the project API key and the Beta webhook destination; `PHOTON_SMS_NUMBER`, `PHOTON_SMS_API_KEY` and `PHOTON_SMS_WEBHOOK_SECRET` on Vercel Production; the shared-project migration; the deploy.
- **Documents updated now:** the PRD's SMS decision and the decision log's SMS channel scope row, whose consent wording now matches D6, with Korean mirrors. The scope decision itself is PR #490.
- **Documents updated during implementation:** provider setup (Photon SMS), the PRD channel lists and FR-37, the implementation plan, the decision log, the page list's *Channel link*, interfaces, host onboarding flow, user journeys, frontend architecture, agent configuration, the privacy notice and the testing baseline, with Korean mirrors.
