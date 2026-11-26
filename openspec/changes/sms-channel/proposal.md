# Proposal

Tracking issue: #489

## Why

On 2026-11-26 the team brought SMS back into scope ([PRD SMS decision](../../../documentations/02_product_requirements.md#target-users), [decision log](../../../documentations/technical_specification/08_decision_log.md#sms-channel-scope)). Every phone can send and receive SMS without installing or signing up for anything. iMessage reaches only Apple devices, WhatsApp is hidden in production since Meta disabled its account on 2026-11-03, and Telegram needs an app and an account.

The first draft of this change used Photon's SMS. The [spike of 2026-11-26](../../../documentations/technical_specification/03_provider_setup.md#photon-sms) showed it does not fit:
- Photon sells US numbers only.
- A line cannot send or receive until a US 10DLC campaign is approved, which takes one to several weeks.
- A send to a Korean number was refused (`SMS_CAMPAIGN_NOT_ELIGIBLE`).

Most of the product's people have Korean (`+82`) numbers. The same day the user decided to carry SMS through an Android phone with a Korean SIM, used as a gateway with [SMS Gate](https://docs.sms-gate.app/) (capcom6/android-sms-gateway). The device rule follows: iPhone, iPad and Mac get iMessage, and every other device gets SMS.

## What Changes

- **Transport.** An Android phone with a Korean SIM runs the SMS Gate app in cloud mode. The service sends through SMS Gate's cloud API. The phone delivers each inbound text and delivery update to a new `POST /sms/webhook`, signed with HMAC-SHA256. The phone only calls out, so it works behind mobile NAT.
- **Carrier terms.** Relaying a service's texts over a subscriber SIM may conflict with the carrier's terms or the Telecommunications Business Act. The user accepted that risk on 2026-11-26 because this is a course project with a few test users, so it does not block the transport code. A public launch would need a business line or an SMS API provider.
- **Number.** The phone's number, `SMS_NUMBER`. The channel counts as configured only when the number, the API credentials and the webhook signing key are all set.
- **Gateway health.** The phone's `system:ping` events show whether it is alive. While it has been silent longer than a threshold, new SMS links are not offered and sends wait.
- **Records.** The `imessage_*` tables, `requester_imessage_bindings`, `channel_usage_days` and the `channel_usage` function accept a fourth `channel`, `sms`. Senders are normalized to E.164 and hashed as `sms:<E.164>`. A new `sms_consents` table keeps proof of consent.
- **Linking.** **Connect SMS** (hosts), `/?flow=sms` (before sign-in) and **Get updates by text** (guests) show the SMS consent checkbox from #488, unticked, and **Get my code**, which works only after the box is ticked. The `FMAT-` code then opens Messages through the existing `sms:` deep link. The code binds the sender when it arrives (`link-on-code` D1). The service never texts first, and no number is asked for.
- **Keywords.** No provider answers keywords, so the service does. An opt-out keyword (English or Korean) ends every SMS binding of that number, and one confirmation is sent. `HELP` gets a fixed help text with the support address.
- **Actions name the reference.** A phone number can be spoofed, so a state-changing action by SMS (approve, decline, share or dismiss changes, confirm or change settings) needs the reference of what it acts on. Actions in the host's own words stay on the other channels.
- **Device rule.** iPhone, iPad and Mac get iMessage. Every other device gets SMS when it is configured. The other configured channels remain switches everywhere. A host still has one messaging channel at a time, now across four.
- **SMS limits.** Plain text only, with no buttons, read marks, typing indicator, tapbacks or contact card. Thyme keeps SMS replies short, and per-recipient and per-phone caps bound cost and carrier throttling.
- **Reused behavior.** Everything else works as on the other channels: exact commands and references, summaries, setup over chat, admission, ordered receipts, the outbox with uncertain sends, 30-day retention and messaging only in production.

## Decisions

The session that wrote this change took these decisions on 2026-11-26. The user settled D1, D2, D7, D8 and D11; the rest follow the existing channels. None has had teammate review yet; task 1.1 covers D1–D16. The [design](design.md) records the reasoning and the rejected options.

| # | Decision | Choice |
|---|---|---|
| D1 | Transport (user; [design 1](design.md#1-transport)) | SMS Gate in cloud mode on one Android phone with a Korean SIM. The service calls `POST {SMSGATE_API_URL}/3rdparty/v1/message` (default `https://api.sms-gate.app`) with the gateway's credentials. It uses the outbox row ID as the message ID (the spike confirms whether SMS Gate rejects a repeated ID; until then a lost answer is uncertain and never resent) and asks for delivery reports. The six webhooks are registered through `POST /3rdparty/v1/webhooks`, one event each, by `npm run sms:webhooks`. The client is a `fetch` wrapper in a new `lib/server/sms-gate.ts`, and `SMSGATE_API_URL` points tests at a loopback stand-in. Rejected: Photon SMS (US-only, campaign-gated); Korean SMS APIs (no inbound texts); TextBee and httpSMS (see design) |
| D2 | Audience (user) | Hosts and guests. SMS is a fourth host channel with the full conversation, and a guest update option on the booking page and through `start_updates_link` |
| D3 | Webhook ([design 2](design.md#2-webhook)) | `POST /sms/webhook` on the agent service. It accepts a request only when `X-Signature` equals the hex HMAC-SHA256 of the raw body followed by `X-Timestamp`, under `SMSGATE_WEBHOOK_KEY`, with the timestamp within 300 seconds; otherwise `401`. `sms:received` stores a receipt keyed by the event's `id` before `200`. `sms:sent`, `sms:delivered` and `sms:failed` update the matching outbox row. `system:ping` and `app:started` record gateway health. Other events are acknowledged and ignored |
| D4 | Sender identity ([design 3](design.md#3-sender-identity)) | The `sender` number, normalized to E.164 (a national number is read as Korean), compared exactly, hashed as `sms:<E.164>` and sealed for replies. The browser shows it masked. Only the phone's own SIM counts: an event whose `recipient` is set and is not `SMS_NUMBER` is ignored; a missing `recipient` counts as that SIM |
| D5 | Records ([design 4](design.md#4-records)) | `sms` is added to every `channel` check and to `channel_usage`. `imessage_links` gains the consent version and time. `sms_consents` keeps proof of consent for four years after a binding ends, without the number. Table names stay, as Phase 9 D4 decided |
| D6 | Linking and consent ([design 5](design.md#5-linking-and-consent)) | The card shows the #488 consent checkbox, unticked, and **Get my code**, disabled until it is ticked. The server refuses an SMS attempt without the current consent text version and records the version and the time it received the request. Then come **Open Messages**, or on a computer the number, the code, **Copy** and a QR code. A code from another channel voids the attempt. No service-sent fallback code |
| D7 | Countries (user) | Any country code is accepted. The phone's SIM sends international texts if its plan allows. Each send's outcome is reported truthfully (D10), and the card makes no promise of delivery abroad |
| D8 | Device rule (user; [design 6](design.md#6-channel-offered-by-device)) | iPhone, iPad and Mac: iMessage, with switches to every other configured channel. Every other device (Android, Windows, Linux, unknown): SMS when configured, with switches to the others. When SMS is not configured, the earlier rule applies (WhatsApp, then Telegram on Android; ask on other computers) |
| D9 | Keywords and opt-out ([design 7](design.md#7-keywords-and-opt-out)) | The opt-out keywords are `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `중지`, `수신거부` and `해지`. They are whole-message and case-insensitive, and `stop` and `unlink` are already commands. Each ends every SMS binding of that number, host and guest, suppresses queued messages and sends one fixed confirmation. `HELP` or `도움말` gets a fixed help text with `support@findmeatime.com`. `START` gets a fixed text saying to link again from findmeatime.com. Unlinked senders get the same replies. Each is sent at most once a day per sender, bypasses the per-recipient cap and counts toward the per-phone cap. None reaches the assistant |
| D10 | Delivery outcomes ([design 8](design.md#8-delivery-outcomes)) | The four outcomes of iMessage D9, decided by the send call: `2xx` is accepted; `401`/`403` is `provider_authentication`; `400` is `invalid_recipient` or `provider_rejected`; `429` is unavailable; `5xx` or a lost answer after the request was written is uncertain. Later events refine an accepted row without resending: `sms:delivered` records delivery, and `sms:failed` records the failure and its reason. While the gateway is unhealthy or the phone cap is reached, sends wait in a parked state that spends no send attempts, so an outage of any length loses nothing |
| D11 | Content (user) | The same content as the other chats: names, times, places and the full Thyme conversation. Before the code is sent, the card says that SMS is not end-to-end encrypted and that the carrier's message rates may apply. SMS Gate's end-to-end encryption (RSA-OAEP and AES-GCM keyed to the device, `SMSGATE_DEVICE_ID`) is turned on for sends. That keeps the relay from reading outbound text in normal operation, but SMS Gate's own docs note that the server distributes device keys and could substitute one. Inbound texts and events go from the phone to us directly and never pass through the relay |
| D12 | SMS limits ([design 9](design.md#9-sms-limits)) | Plain text, no markup and no buttons. Thyme's SMS instructions ask for replies under 480 characters unless the host asks for more. `SMS_DAILY_LIMIT` (default 40) caps outbound SMS per recipient in any 24-hour window, the limit notice included. `SMS_PHONE_HOURLY_LIMIT` (default 100) caps the phone's sends per hour, and the excess waits in the outbox. The app's own send-rate limit is also set as an operator step. Schedule pictures are answered in words |
| D13 | Reused behavior | As Telegram D12, with an `[SMS] …` transcript prefix and per-channel unlinked-sender counts. No window, no templates, no read marks, typing, tapbacks or contact card |
| D14 | Actions by SMS ([design 10](design.md#10-decisions-by-sms)) | Caller ID can be spoofed, so a state-changing host action by SMS takes effect only when the text contains the exact current reference of what it acts on, alone or in the host's words. That covers approving or declining, sharing or dismissing changes, and confirming or changing settings. Otherwise Thyme replies with the exact text to send. Forwarding plain words into a shared discussion and `STOP` are not gated, and the design accepts that risk |
| D15 | Consent record ([design 4](design.md#4-records)) | One `sms_consents` row per SMS binding: sender hash, host or guest, consent version and time, end time and reason. It is kept four years after the binding ends, then deleted. No number is stored |
| D16 | Gateway health ([design 11](design.md#11-gateway-health)) | The phone is alive while a `system:ping` or `app:started` arrived within `SMS_GATEWAY_STALE_MINUTES` (default 30). While stale, SMS is not offered for new links, sends are unavailable and wait, and operational diagnostics report it |

## Conflicts resolved here

| Conflict | Resolution |
|---|---|
| **Telegram D7 / WhatsApp device rule.** Android gets WhatsApp, then Telegram; other computers ask | Apple devices get iMessage, and every other device gets SMS when configured (D8). The host-telegram and host-whatsapp requirements are modified |
| **One messaging channel across three** | Across four. The host-telegram requirement is renamed and modified |
| **iMessage and Telegram `stop`/`help` replies** | On SMS the replies are fixed SMS texts that name the brand and the support address, and opt-out ends every SMS binding of the number (D9). Other channels are unchanged |
| **Approval in the host's own words** (`host-imessage-channel`) | Not on SMS: decisions there need the reference (D14). Other channels are unchanged |
| **The Photon 10DLC campaign** (submitted 2026-11-26, in review) | Not needed by this change. If it is approved, it covers US numbers on Photon's line, which this change does not use. Keeping or withdrawing it is the user's call |
| **The earlier draft of this change** (Photon transport, Photon-answered keywords, Android SMS only without WhatsApp) | Replaced by D1, D3, D8, D9, D10 and D16 on 2026-11-26 |

## Capabilities

### New Capabilities

- `host-sms-channel`: the SMS webhook and its signature, gateway health, SMS sender identity, linking by a texted code behind the consent checkbox, the consent record, keyword and opt-out handling, delivery outcomes, SMS limits, decisions by reference, and the behavior reused from the other host channels.
- `guest-sms-channel`: guest SMS linking from the booking page and through the requester agent, routing of a guest's texts, and opt-out.

### Modified Capabilities

- `host-telegram-channel`: "Channel offered by device with Telegram" (Apple devices get iMessage; every other device gets SMS when configured), and "One messaging channel across three", renamed to "…across four".
- `host-whatsapp-channel`: "Channel offered by device" (SMS first on non-Apple devices when configured).
- `guest-telegram-channel`: "Guest Telegram linking" (one active guest binding across four channels).
- `host-whatsapp-channel`: also "One messaging channel per host" (across four).
- `guest-whatsapp-channel`: "Guest WhatsApp linking" (one active guest binding across four channels).
- `operational-diagnostics`: "Counts-only channel usage records" (an SMS row).
- `meeting-requests`: "Agreement notice in the guest's linked chat" (SMS guests get it too, under the SMS limits).
- `host-schedule-lookup`: "Read-only host schedule lookup" (from the SMS chat too) and "Schedule image in the linked chat" (answered in words on SMS).

## Archive order

This change depends on `link-on-code` (binding on arrival) and `channel-actions-in-words` (actions in words, which D14 gates on SMS), and archives after both. The consent checkbox and policy pages of #488 are already on `main`.

## Impact

- **New code:** `lib/server/sms-gate.ts` (client, webhook verification, event parser, number normalization, error mapping); `agent/channels/sms.ts` (the route); the SMS states of the linking card, link step, landing start, booking-page card and agent connect page.
- **Changed code:** `lib/contracts/messaging-channel.ts` and `requester-imessage.ts` (a fourth channel, the device rule, the `[SMS] ` prefix); every `Record<StoredChannel>` text map in `channel-texts.ts`; the outbox (SMS transport, caps, health gate, delivery events); links and receipts (consent record, keywords); `imessage-commands.ts` (SMS keyword replies); the agent tools' channel enums and the decision check; host and requester instructions; operational diagnostics; a new SMS Gate stand-in in `tests/`.
- **Schema:** the `channel` checks named above, consent columns on `imessage_links`, the `sms_consents` table with its cleanup, delivery columns on `imessage_outbox` if the existing ones cannot hold delivery events, a gateway-health row, and the `channel_usage` function, all through pg-delta. Nothing is dropped.
- **Dependencies:** none (HMAC via Node's `crypto`).
- **Systems (left to the user):**
  - an Android phone with a Korean SIM and an unlimited-text plan, kept powered and online;
  - the SMS Gate app in cloud mode with end-to-end encryption, its webhook and signing key, and its send-rate limit;
  - checking the carrier plan's daily send limit and international SMS coverage;
  - `SMS_NUMBER`, `SMSGATE_API_URL`, the SMS Gate credentials, `SMSGATE_DEVICE_ID` and `SMSGATE_WEBHOOK_KEY` on Vercel Production;
  - the shared-project migration;
  - the deploy.
- **Documents updated now:** the PRD's SMS decision, the decision log's SMS channel scope section and provider setup's Photon SMS section, with Korean mirrors.
- **Documents updated during implementation:**
  - provider setup (an SMS Gate section);
  - the PRD channel lists and FR-37;
  - the implementation plan;
  - the page list's *Channel link*, interfaces, host onboarding flow and user journeys;
  - frontend architecture and agent configuration;
  - the privacy notice (SMS Gate's relay, the carrier, the consent record);
  - the testing baseline.
